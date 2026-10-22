import St from "gi://St";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GdkPixbuf from "gi://GdkPixbuf";
import Pango from "gi://Pango";
import Cairo from "cairo";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { setSourcePixbuf } from "../core/pixbufSurface.js";

import { ControlButtons } from "./ControlButtons.js";
import { AlbumArt } from "./AlbumArt.js";
import { ProgressSlider } from "./ProgressSlider.js";
import { PlayerTabs } from "./PlayerTabs.js";
import { ScrollingLabel } from "./ScrollingLabel.js";
import { LyricsClient } from "../../Lyrics/client/_LyricsClient.js";
import { LyricsWidget } from "../../Lyrics/widgets/_LyricsWidget.js";

const LOOP_PAUSE_MS = 1200;
const BASE_PX_PER_SEC = 50;
const LYRICS_POLL_MS = 250;
const MIN_POPUP_WIDTH = 280;
const BACKDROP_WIDTH = 512;
const BACKDROP_RATIO = 2.4;
const FADE_START = 0.6;
const ART_OVERLAP = 0.18;

const APPEARANCE_KEYS = [
  "popup-title-font-family",
  "popup-title-font-size",
  "popup-title-font-bold",
  "popup-title-font-color",
  "popup-artist-font-family",
  "popup-artist-font-size",
  "popup-artist-font-bold",
  "popup-artist-font-color",
];

const popupWidth = (s) => Math.max(MIN_POPUP_WIDTH, s.get_int("popup-width"));
const titleWidth = (s) => Math.round(popupWidth(s) * 0.88);
const artistWidth = (s) => Math.round(popupWidth(s) * 0.82);

const infoAlign = (s) =>
  s.get_boolean("info-align-center")
    ? Clutter.ActorAlign.CENTER
    : Clutter.ActorAlign.START;

const trackKey = (info) =>
  `${info.title || ""}||${(info.artists || []).join(",")}`;

function textStyle(s, kind, defaults) {
  const size = s.get_int(`popup-${kind}-font-size`) || defaults.size;
  const bold = s.get_boolean(`popup-${kind}-font-bold`);
  const family = s.get_string(`popup-${kind}-font-family`).trim();
  const color = s.get_string(`popup-${kind}-font-color`).trim();

  let style = `font-size: ${size}px; font-weight: ${bold ? "700" : defaults.weight};`;
  if (family) style += ` font-family: ${family};`;
  if (color) style += ` color: ${color};`;
  return style;
}

const popupTitleStyle = (s) =>
  textStyle(s, "title", { size: 16, weight: "normal" });
const popupArtistStyle = (s) =>
  textStyle(s, "artist", { size: 13, weight: "500" });

export const MediaControls = GObject.registerClass(
  {
    Signals: {
      "play-pause": {},
      next: {},
      previous: {},
      shuffle: {},
      repeat: {},
      seek: { param_types: [GObject.TYPE_DOUBLE] },
      "player-changed": { param_types: [GObject.TYPE_STRING] },
      "pin-toggled": {
        param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING],
      },
    },
  },
  class MediaControls extends St.BoxLayout {
    _init(settings, extensionDir = null) {
      const w = popupWidth(settings);

      super._init({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: "media-controls-modern",
        style: `min-width: ${w}px; max-width: ${w}px;`,
      });

      this._settings = settings;
      this._extensionDir = extensionDir;
      this._currentPlayerName = null;
      this._currentManager = null;
      this._playerSliderPositions = new Map();
      this._playerArtCache = new Map();

      this._titleScrollLabel = null;
      this._artistScrollLabel = null;

      this._lyricsClient = null;
      this._lyricsView = null;
      this._playerLyricsState = new Map();
      this._lyricsCache = new Map();
      this._currentTrackInfo = null;
      this._lyricsSyncTimer = null;

      this._signalIds = [];
      this._immersive = false;
      this._frameStyles = new Map();
      this._coverUri = null;
      this._backdropUri = null;
      this._backdropColor = "#000";
      this._gradient = null;
      this._lyricsGradient = false;
      this._coverAspect = 1;
      this._repinId = 0;

      this._connect(settings, "changed::popup-width", () =>
        this._applyPopupWidth(),
      );
      this._connect(settings, "changed::popup-button-order", () =>
        this._rebuildControlButtons(),
      );
      this._connect(settings, "changed::info-align-center", () =>
        this._applyInfoAlignment(),
      );
      this._connect(settings, "changed::lyrics-gradient-background", () =>
        this._syncLyricsBackdrop(),
      );

      for (const key of APPEARANCE_KEYS) {
        this._connect(settings, `changed::${key}`, () => {
          if (!this._currentTrackInfo) return;
          this._stopTitleLabel();
          this._stopArtistLabel();
          this._refreshLabels();
        });
      }

      this._buildUI();
    }

    _connect(source, signal, callback) {
      const id = source.connect(signal, callback);
      this._signalIds.push({ source, id });
    }

    _refreshLabels() {
      const info = this._currentTrackInfo;
      this._updateTitleLabel(info.title || "Unknown", info.status);
      if (info.artists?.length)
        this._updateArtistLabel(info.artists.join(", "), info.status);
    }

    _frameActors() {
      const chain = [];
      for (
        let a = this.get_parent();
        a && chain.length < 8;
        a = a.get_parent()
      ) {
        chain.push(a);
        if (a instanceof St.Widget && a.has_style_class_name("popup-menu-content"))
          return chain;
      }
      return [];
    }

    _pointerActor(frame) {
      let a = frame[frame.length - 1]?.get_parent();
      for (let i = 0; a && i < 3; i++, a = a.get_parent()) {
        if (
          a instanceof St.Widget &&
          a.has_style_class_name("popup-menu-boxpointer")
        )
          return a;
      }
      return null;
    }

    _saveFrameStyle(actor) {
      if (this._frameStyles.has(actor)) return;

      const destroyId = actor.connect("destroy", () =>
        this._frameStyles.delete(actor),
      );
      this._frameStyles.set(actor, { style: actor.style ?? "", destroyId });
    }

    _resetFrame() {
      for (const [actor, { style, destroyId }] of this._frameStyles) {
        actor.disconnect(destroyId);
        actor.style = style;
      }
      this._frameStyles.clear();
    }

    _sidePadding(actor) {
      const node = actor.get_theme_node();
      return [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT].map(
        (side) => node.get_padding(side),
      );
    }

    _applyRootStyle() {
      const w = popupWidth(this._settings);
      let style = `min-width: ${w}px; max-width: ${w}px;`;
      let contentStyle = "";

      this._resetFrame();

      if (this._immersive) {
        this._lyricsGradient = this._lyricsGradientOn();
        const backdropCss = (width) => {
          if (!this._backdropUri) return "";
          if (this._lyricsGradient && this._gradient) {
            const [from, to] = this._gradient;
            return (
              ` background-gradient-direction: vertical;` +
              ` background-gradient-start: ${from};` +
              ` background-gradient-end: ${to};`
            );
          }
          const uri = this._backdropUri.replace(/'/g, "%27");
          const bgWidth = Math.ceil(width) + 2;
          const bgHeight = Math.round(bgWidth * BACKDROP_RATIO);
          return (
            ` background-image: url('${uri}');` +
            ` background-size: ${bgWidth}px ${bgHeight}px;` +
            ` background-position: 0px 0px;` +
            ` background-repeat: no-repeat;` +
            ` background-color: ${this._backdropColor};`
          );
        };

        let radiusStyle = " border-radius: 18px;";
        const frame = this.mapped ? this._frameActors() : [];
        if (frame.length) {
          this.style = "";
          const pad = [0, 0, 0, 0];
          for (const actor of [this, ...frame])
            this._sidePadding(actor).forEach((v, i) => (pad[i] += v));

          const node = frame[frame.length - 1].get_theme_node();
          const radius = node.get_border_radius(St.Corner.TOPLEFT);
          radiusStyle = ` border-radius: ${radius}px;`;

          const extra = pad[1] + pad[3];
          const bg = backdropCss(w + extra);

          frame.forEach((actor, i) => {
            this._saveFrameStyle(actor);
            actor.style =
              "padding: 0; margin: 0; border: none; box-shadow: none;" +
              (i === frame.length - 1
                ? ` border-radius: ${radius}px;${bg}`
                : " background: none; border: none;");
          });

          const pointer = this._pointerActor(frame);
          if (pointer) {
            this._saveFrameStyle(pointer);
            pointer.style =
              "-arrow-background-color: transparent;" +
              " -arrow-border-color: transparent;" +
              " -arrow-border-width: 0; -arrow-shadow: none;";
          }

          style = `min-width: ${w + extra}px; max-width: ${w + extra}px; padding: 0;`;
          contentStyle = `padding: ${pad[0]}px ${pad[1]}px ${pad[2]}px ${pad[3]}px;`;
        } else {
          style += ` border-radius: 18px;${backdropCss(w)}`;
        }

        contentStyle += `${radiusStyle} color: #fff;`;
      }

      this.style = style;
      this._content.style = contentStyle;

      this._infoBox.style = this._immersive
        ? "spacing: 4px; margin-top: 8px; margin-bottom: 8px;"
        : "spacing: 4px; margin-top: 16px; margin-bottom: 16px;";

      this._placeHeader();
      this._refitArtSlot();
    }

    _placeHeader() {
      const header = this._header;

      if (this._immersive) {
        this._progressSlider.setCenterChild(header);
      } else if (header.get_parent() !== this._content) {
        this._progressSlider.setCenterChild(null);
        this._content.insert_child_at_index(header, 0);
      }

      header.x_expand = !this._immersive;
      header.style = this._immersive
        ? "spacing: 8px;"
        : "margin-bottom: 20px; spacing: 8px;";
    }

    _artSlotStyle() {
      if (!this._immersive || !this._coverUri || !this._artSlot) return "";
      const room =
        Math.round(this._content.width * this._coverAspect) -
        this._artSlot.y -
        Math.round(this._content.width * ART_OVERLAP);
      return room > 0 ? `max-height: ${room}px;` : "";
    }

    _refitArtSlot() {
      if (!this._artSlot || this._artSlot.get_child() !== this._albumArt)
        return;
      const style = this._artSlotStyle();
      if ((this._artSlot.style ?? "") !== style) this._artSlot.style = style;
    }

    _setCover(uri) {
      this._coverUri = uri || null;
      this._backdropUri = this._coverUri
        ? this._composeBackdrop(this._coverUri)
        : null;
    }

    _lyricsGradientOn() {
      return (
        this._immersive &&
        this._artSlot?.get_child() === this._lyricsView &&
        this._settings.get_boolean("lyrics-gradient-background")
      );
    }

    _syncLyricsBackdrop() {
      if (this._lyricsGradientOn() === this._lyricsGradient) return;
      this._applyRootStyle();
    }

    _tone(pixbuf, from, to) {
      const small = pixbuf.scale_simple(16, 16, GdkPixbuf.InterpType.BILINEAR);
      const px = small.get_pixels();
      const step = small.get_n_channels();
      const stride = small.get_rowstride();
      const rgb = [0, 0, 0];
      let count = 0;

      for (let y = from; y < to; y++) {
        for (let x = 0; x < 16; x++) {
          const i = y * stride + x * step;
          for (let c = 0; c < 3; c++) rgb[c] += px[i + c];
          count++;
        }
      }
      return rgb.map((v) => v / count / 255);
    }

    _composeBackdrop(uri) {
      try {
        const src = Gio.File.new_for_uri(uri).get_path();
        const cover = GdkPixbuf.Pixbuf.new_from_file(src);
        this._coverAspect = cover.get_height() / cover.get_width();

        const base = this._tone(cover, 10, 16).map((v) => v * 0.55);
        const end = base.map((v) => v * 0.6);
        const top = this._tone(cover, 0, 6).map((v) => v * 0.7);
        const css = (rgb) =>
          `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})`;
        this._backdropColor = css(end);
        this._gradient = [css(top), css(end)];

        const name = GLib.compute_checksum_for_string(
          GLib.ChecksumType.SHA1,
          uri,
          -1,
        );
        const dir = GLib.build_filenamev([
          GLib.get_user_cache_dir(),
          "mpris-covers",
          "backdrop",
        ]);
        GLib.mkdir_with_parents(dir, 0o755);
        const out = GLib.build_filenamev([dir, `${name}-v3.png`]);
        if (GLib.file_test(out, GLib.FileTest.EXISTS)) return `file://${out}`;

        const width = BACKDROP_WIDTH;
        const height = Math.round(width * BACKDROP_RATIO);
        const artHeight = Math.min(
          Math.round(width * this._coverAspect),
          height,
        );
        const art = cover.scale_simple(
          width,
          artHeight,
          GdkPixbuf.InterpType.BILINEAR,
        );

        const surface = new Cairo.ImageSurface(
          Cairo.Format.ARGB32,
          width,
          height,
        );
        const cr = new Cairo.Context(surface);

        const floor = new Cairo.LinearGradient(0, artHeight, 0, height);
        floor.addColorStopRGBA(0, ...base, 1);
        floor.addColorStopRGBA(1, ...end, 1);
        cr.setSource(floor);
        cr.rectangle(0, artHeight, width, height - artHeight);
        cr.fill();

        setSourcePixbuf(cr, art, 0, 0);
        cr.rectangle(0, 0, width, artHeight);
        cr.fill();

        const fadeTop = artHeight * FADE_START;
        const fade = new Cairo.LinearGradient(0, fadeTop, 0, artHeight);
        fade.addColorStopRGBA(0, ...base, 0);
        fade.addColorStopRGBA(0.55, ...base, 0.5);
        fade.addColorStopRGBA(1, ...base, 1);
        cr.setSource(fade);
        cr.rectangle(0, fadeTop, width, artHeight - fadeTop);
        cr.fill();

        surface.writeToPNG(out);
        cr.$dispose();
        return `file://${out}`;
      } catch (e) {
        console.error(
            _('Cover backdrop failed: %s').format(e.message)
        );
        return null;
      }
    }

    _applyPopupWidth() {
      const w = popupWidth(this._settings);
      this._applyRootStyle();
      this._titleSlot.style = `min-height: 28px; max-width: ${titleWidth(this._settings)}px;`;
      this._artistSlot.style = `min-height: 22px; max-width: ${artistWidth(this._settings)}px;`;

      if (this._currentTrackInfo) this._refreshLabels();

      this._lyricsView?.setSize?.(w, w);

      if (this._artSlot?.get_child() === this._lyricsView) {
        this._artSlot.style = "";
        this._repinId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this._repinId = 0;
          this._showInArtSlot(this._lyricsView);
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    _applyInfoAlignment() {
      const align = infoAlign(this._settings);
      this._infoBox.x_align = align;
      this._titleSlot.x_align = align;
      this._artistSlot.x_align = align;
    }

    _buildUI() {
      const settings = this._settings;
      const align = infoAlign(settings);

      this._content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
      });
      this.add_child(this._content);

      this._header = new St.BoxLayout({
        style: "margin-bottom: 20px; spacing: 8px;",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      this._playerTabs = new PlayerTabs();
      this._playerTabs.setSettings(settings);
      this._connect(this._playerTabs, "player-changed", (_tabs, name) =>
        this.emit("player-changed", name),
      );
      this._connect(this._playerTabs, "pin-toggled", (_tabs, pinned, name) =>
        this.emit("pin-toggled", pinned, name),
      );
      this._header.add_child(this._playerTabs);
      this._content.add_child(this._header);

      this._artSlot = new St.Bin({
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });

      this._connect(this._artSlot, "notify::allocation", () =>
        this._refitArtSlot(),
      );

      this._albumArt = new AlbumArt(settings, null, null);
      this._connect(this._albumArt, "single-click", () =>
        this._onAlbumArtTripleClick(),
      );
      this._connect(this._albumArt, "cover-changed", (_art, uri) => {
        this._setCover(uri);
        if (this._immersive) this._applyRootStyle();
      });
      this._connect(this._albumArt, "immersive-changed", (_art, on) => {
        this._immersive = on;
        this._applyRootStyle();
      });

      const w = popupWidth(settings);
      this._lyricsView = new LyricsWidget(w, w, settings);
      this._connect(this._lyricsView, "dismiss", () =>
        this._hideLyricsForPlayer(this._currentPlayerName),
      );

      this._artSlot.set_child(this._albumArt);
      this._lyricsView.y_align = Clutter.ActorAlign.START;
      this._content.add_child(this._artSlot);

      this._infoBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style: "spacing: 4px; margin-top: 16px; margin-bottom: 16px;",
        x_align: align,
        x_expand: true,
      });

      this._titleSlot = new St.BoxLayout({
        x_align: align,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: `min-height: 28px; max-width: ${titleWidth(settings)}px;`,
      });
      this._artistSlot = new St.BoxLayout({
        x_align: align,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: `min-height: 22px; max-width: ${artistWidth(settings)}px;`,
      });
      this._infoBox.add_child(this._titleSlot);
      this._infoBox.add_child(this._artistSlot);
      this._content.add_child(this._infoBox);

      this._progressSlider = new ProgressSlider(settings, this._extensionDir);
      this._connect(this._progressSlider, "seek", (_s, position) =>
        this.emit("seek", position),
      );
      this._connect(this._progressSlider, "drag-begin", () =>
        this.stopPositionUpdate(),
      );
      this._connect(this._progressSlider, "drag-end", () => {
        if (!this._currentPlayerName) return;
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: this._progressSlider.currentPosition,
          length: this._progressSlider.trackLength,
          value: this._progressSlider.sliderValue,
        });
      });
      this._connect(
        this._progressSlider,
        "slider-ratio-changed",
        (_s, ratio) => {
          this._albumArt?.syncRotationToPosition?.(ratio);
        },
      );
      this._content.add_child(this._progressSlider);

      this._controlButtons = new ControlButtons(settings);
      this._wireControlButtons();
      this._content.add_child(this._controlButtons);

      this._connect(this, "notify::mapped", () => {
        if (this._immersive && this.mapped) this._applyRootStyle();
      });

      this._immersive = this._albumArt.immersive;
      this._setCover(this._albumArt.coverUri);
      this._applyRootStyle();
    }

    _wireControlButtons() {
      for (const signal of [
        "play-pause",
        "next",
        "previous",
        "shuffle",
        "repeat",
      ])
        this._connect(this._controlButtons, signal, () => this.emit(signal));
    }

    _rebuildControlButtons() {
      this._signalIds = this._signalIds.filter(({ source, id }) => {
        if (source !== this._controlButtons) return true;
        source.disconnect(id);
        return false;
      });

      this._content.remove_child(this._controlButtons);
      this._controlButtons.destroy();

      this._controlButtons = new ControlButtons(this._settings);
      this._wireControlButtons();
      this._content.add_child(this._controlButtons);

      if (this._currentTrackInfo)
        this._controlButtons.updateButtons(this._currentTrackInfo);
    }

    _calcSpeed(speedPref, status) {
      const effective =
        status === "Paused"
          ? Math.max(1, Math.floor(speedPref / 3))
          : speedPref;
      return Math.round((BASE_PX_PER_SEC * effective) / 5);
    }

    _updateSlotLabel(
      slot,
      existing,
      text,
      scrollEnabled,
      viewWidth,
      speedPref,
      status,
      style,
    ) {
      if (!scrollEnabled) {
        existing?.destroy();
        slot.destroy_all_children();

        const label = new St.Label({
          text,
          y_align: Clutter.ActorAlign.CENTER,
          style: `${style} max-width: ${viewWidth}px;`,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.single_line_mode = true;
        slot.add_child(label);
        return null;
      }

      const speed = this._calcSpeed(speedPref, status);
      if (existing) {
        existing.setScrollSpeed(speed);
        existing.setTextStyle(style);
        existing.setText(text);
        return existing;
      }

      slot.destroy_all_children();
      const widget = new ScrollingLabel({
        text,
        viewportWidth: viewWidth,
        isScrolling: true,
        initPaused: false,
        scrollSpeed: speed,
        scrollPauseTime: LOOP_PAUSE_MS,
        textStyle: style,
      });
      slot.add_child(widget);
      return widget;
    }

    _updateTitleLabel(text, status) {
      const s = this._settings;
      this._titleScrollLabel = this._updateSlotLabel(
        this._titleSlot,
        this._titleScrollLabel,
        text,
        s.get_boolean("enable-title-scroll"),
        titleWidth(s),
        s.get_int("title-scroll-speed"),
        status,
        popupTitleStyle(s),
      );
    }

    _updateArtistLabel(text, status) {
      const s = this._settings;
      this._artistScrollLabel = this._updateSlotLabel(
        this._artistSlot,
        this._artistScrollLabel,
        text,
        s.get_boolean("enable-artist-scroll"),
        artistWidth(s),
        s.get_int("artist-scroll-speed"),
        status,
        popupArtistStyle(s),
      );
    }

    _stopTitleLabel() {
      this._titleScrollLabel?.destroy();
      this._titleScrollLabel = null;
      this._titleSlot?.destroy_all_children();
    }

    _stopArtistLabel() {
      this._artistScrollLabel?.destroy();
      this._artistScrollLabel = null;
      this._artistSlot?.destroy_all_children();
    }

    update(info, playerName, manager) {
      if (!info) return;

      const playerChanged = this._currentPlayerName !== playerName;
      this._currentPlayerName = playerName;
      this._currentManager = manager;
      this._currentTrackInfo = info;

      this._progressSlider.setPlayerName(playerName);

      if (playerChanged) {
        this._albumArt.setPlayer(manager, playerName);
        if (info.artUrl) this._albumArt.loadCover(info.artUrl, true);
        else this._albumArt.setDefaultCover();
      } else if (
        info.artUrl &&
        this._playerArtCache.get(playerName) !== info.artUrl
      ) {
        this._albumArt.loadCover(info.artUrl);
      }
      this._playerArtCache.set(playerName, info.artUrl);

      this._updateTitleLabel(info.title || "Unknown", info.status);

      if (info.artists?.length) {
        this._updateArtistLabel(info.artists.join(", "), info.status);
        this._artistSlot.show();
      } else {
        this._stopArtistLabel();
        this._artistSlot.hide();
      }

      this._controlButtons.updateButtons(info);

      this._progressSlider.updatePlaybackState(
        info.status === "Playing",
        this._getMetadata(playerName, manager),
        info.status,
      );

      if (info.status === "Playing") this._albumArt.startRotation(true);
      else if (info.status === "Paused") this._albumArt.pauseRotation();
      else this._albumArt.stopRotation();

      if (!this._settings.get_boolean("enable-lyrics")) {
        if (this._playerLyricsState.get(playerName)?.visible)
          this._hideLyricsForPlayer(playerName);
        return;
      }

      const state = this._getPlayerLyricsState(playerName);

      if (playerChanged) {
        this._stopLyricsSyncTimer();
        this._applyLyricsState(playerName, state);
        return;
      }

      if (!state.visible) return;

      const key = trackKey(info);
      if (key !== state.lastKey) {
        state.lastKey = key;
        this._lyricsView.clear();
        this._fetchLyricsForCurrentTrack();
      }
      this._pushLyricsPosition();
    }

    _getMetadata(playerName, manager) {
      const metadata = manager?._proxies
        ?.get(playerName)
        ?.get_cached_property("Metadata");
      return metadata?.recursiveUnpack() ?? null;
    }

    updateTabs(players, currentPlayer, manager) {
      this._playerTabs.updateTabs(players, currentPlayer, manager);
    }

    startPositionUpdate() {
      this._progressSlider.startPositionUpdate();
      this._titleScrollLabel?.resumeScrolling();
      this._artistScrollLabel?.resumeScrolling();

      if (this._playerLyricsState.get(this._currentPlayerName)?.visible)
        this._startLyricsSyncTimer();
    }

    stopPositionUpdate() {
      this._progressSlider.stopPositionUpdate();
      this._titleScrollLabel?.pauseScrolling();
      this._artistScrollLabel?.pauseScrolling();
      this._albumArt?.pauseRotation();
      this._stopLyricsSyncTimer();
    }

    onSeeked(position) {
      const slider = this._progressSlider;
      slider.onSeeked(position);

      if (this._currentPlayerName) {
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: slider.currentPosition,
          length: slider.trackLength,
          value: slider.currentPosition / slider.trackLength,
        });
      }

      if (this._playerLyricsState.get(this._currentPlayerName)?.visible)
        this._lyricsView?.setPosition(position * 1000);
    }

    onMenuClosed() {
      this._stopLyricsSyncTimer();
    }

    _startLyricsSyncTimer() {
      this._stopLyricsSyncTimer();
      this._lyricsSyncTimer = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        LYRICS_POLL_MS,
        () => {
          if (!this._playerLyricsState.get(this._currentPlayerName)?.visible) {
            this._lyricsSyncTimer = null;
            return GLib.SOURCE_REMOVE;
          }
          this._pushLyricsPosition();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _stopLyricsSyncTimer() {
      if (this._lyricsSyncTimer) {
        GLib.source_remove(this._lyricsSyncTimer);
        this._lyricsSyncTimer = null;
      }
    }

    _pushLyricsPosition() {
      if (
        !this._playerLyricsState.get(this._currentPlayerName)?.visible ||
        !this._lyricsView
      )
        return;

      this._lyricsView.setPosition(
        (this._progressSlider?.currentPosition || 0) / 1000,
      );
    }

    _showInArtSlot(child) {
      if (!this._artSlot) return;
      if (child === this._lyricsView) {
        const [, natural] = this._albumArt.get_preferred_height(-1);
        this._artSlot.style = `min-height: ${Math.ceil(natural)}px;`;
      } else {
        this._artSlot.style = this._artSlotStyle();
      }
      this._artSlot.set_child(child);
      this._syncLyricsBackdrop();
    }

    _getPlayerLyricsState(playerName) {
      if (!this._playerLyricsState.has(playerName))
        this._playerLyricsState.set(playerName, {
          visible: false,
          lastKey: null,
        });
      return this._playerLyricsState.get(playerName);
    }

    _applyLyricsState(_playerName, state) {
      if (!state.visible) {
        if (this._artSlot?.get_child() === this._lyricsView)
          this._showInArtSlot(this._albumArt);
        this._stopLyricsSyncTimer();
        return;
      }

      this._showInArtSlot(this._lyricsView);

      const info = this._currentTrackInfo;
      const key = info ? trackKey(info) : null;
      if (key && key !== state.lastKey) {
        state.lastKey = key;
        this._lyricsView.clear();
        this._fetchLyricsForCurrentTrack();
      }
      this._pushLyricsPosition();
      this._startLyricsSyncTimer();
    }

    _onAlbumArtTripleClick() {
      if (!this._settings.get_boolean("enable-lyrics")) return;

      if (this._getPlayerLyricsState(this._currentPlayerName).visible)
        this._hideLyricsForPlayer(this._currentPlayerName);
      else this._showLyricsForPlayer(this._currentPlayerName);
    }

    _showLyricsForPlayer(playerName) {
      const state = this._getPlayerLyricsState(playerName);
      state.visible = true;
      this._showInArtSlot(this._lyricsView);

      const info = this._currentTrackInfo;
      if (!info) {
        this._lyricsView.clear();
        return;
      }

      state.lastKey = trackKey(info);
      if (!this._lyricsCache.has(state.lastKey)) this._lyricsView.clear();
      this._fetchLyricsForCurrentTrack();
      this._startLyricsSyncTimer();
    }

    _hideLyricsForPlayer(playerName) {
      this._getPlayerLyricsState(playerName).visible = false;
      this._stopLyricsSyncTimer();
      this._showInArtSlot(this._albumArt);
    }

    async _fetchLyricsForCurrentTrack() {
      const info = this._currentTrackInfo;
      const playerName = this._currentPlayerName;
      if (!info || !playerName) return;

      const key = trackKey(info);
      const stillShowing = () =>
        this._getPlayerLyricsState(playerName).visible &&
        this._currentPlayerName === playerName;

      if (this._lyricsCache.has(key)) {
        if (stillShowing()) {
          this._lyricsView.setLyrics(this._lyricsCache.get(key));
          this._pushLyricsPosition();
        }
        return;
      }

      const client = (this._lyricsClient ??= new LyricsClient());

      try {
        const lines = await client.getLyrics(
          info.title || "",
          (info.artists || []).join(", "),
          info.album || "",
          info.length > 0 ? info.length / 1_000_000 : 0,
        );
        if (client !== this._lyricsClient) return;
        this._lyricsCache.set(key, lines ?? null);

        if (!stillShowing()) return;

        this._lyricsView.setLyrics(lines);
        this._pushLyricsPosition();
      } catch (e) {
        console.warn(`Lyrics lookup failed: ${e.message}`);
        if (client === this._lyricsClient && stillShowing())
          this._lyricsView.setLyrics(null);
      }
    }

    updateLyricsPosition(positionUs) {
      if (this._playerLyricsState.get(this._currentPlayerName)?.visible)
        this._lyricsView?.setPosition(positionUs / 1000);
    }

    destroy() {
      this._resetFrame();

      this._signalIds.forEach(({ source, id }) => source.disconnect(id));
      this._signalIds = [];

      this._stopTitleLabel();
      this._stopArtistLabel();
      this._progressSlider?.stopPositionUpdate();
      this._stopLyricsSyncTimer();

      this._playerSliderPositions.clear();
      this._playerArtCache.clear();
      this._playerLyricsState.clear();
      this._lyricsCache.clear();

      this._lyricsClient?.destroy();
      this._lyricsClient = null;

      if (this._repinId) {
        GLib.Source.remove(this._repinId);
        this._repinId = 0;
      }

      this._artSlot?.set_child(null);
      this._artSlot = null;

      this._lyricsView?.destroy();
      this._lyricsView = null;

      this._albumArt?.destroy();
      this._albumArt = null;

      PlayerTabs.clearIconCache();

      super.destroy();
    }
  },
);