import St from "gi://St";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import {
  ThemeEngine,
  ThemeContext,
  ThumbContext,
} from "../core/ThemeEngine.js";
import { setSourcePixbuf } from "../core/pixbufSurface.js";

const THUMB_SIZE = 32;
const THUMB_R = THUMB_SIZE / 2;
const TRACK_MARGIN = THUMB_R + 2;
const ANIM_INTERVAL_MS = 33;
const POSITION_POLL_MS = 1000;
const RESUME_DELAY_MS = 200;
const MIN_GIF_DELAY_MS = 20;
const DEFAULT_GIF_DELAY_MS = 80;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const ProgressSlider = GObject.registerClass(
  {
    Signals: {
      seek: { param_types: [GObject.TYPE_DOUBLE] },
      "drag-begin": {},
      "drag-end": {},
      "slider-ratio-changed": { param_types: [GObject.TYPE_DOUBLE] },
    },
  },
  class ProgressSlider extends St.BoxLayout {
    _init(settings, extensionDir = null) {
      super._init({
        orientation: Clutter.Orientation.VERTICAL,
        style: "spacing: 10px; margin-bottom: 20px;",
      });

      this._settings = settings;
      this._extensionDir = extensionDir;

      this._updateInterval = null;
      this._resumeTimeout = null;
      this._animTimeout = null;
      this._gifFrameTimeout = null;
      this._gifCancellable = null;

      this._sliderDragging = false;
      this._thumbDragging = false;
      this._thumbPressX = 0;
      this._thumbPressRatio = 0;
      this._pointerGrab = null;

      this._currentPosition = 0;
      this._trackLength = 0;
      this._isPlaying = false;
      this._playerName = null;
      this._trackId = null;
      this._canSeek = true;
      this._hasLength = true;
      this._playerCache = new Map();

      this._animOffset = 0;
      this._currentThumbPixbuf = null;
      this._gifAnimation = null;
      this._gifFrameIter = null;

      this._settingsIds = [];

      this._themeEngine = new ThemeEngine(extensionDir);
      globalThis._themeGdk = { Gdk: { cairo_set_source_pixbuf: setSourcePixbuf } };

      this._readSettings();
      this._connectSettings();
      this._buildUI();
      this._loadGif();
      this._startAnim();
    }

    _readSettings() {
      const s = this._settings;
      this._gifEnabled = s.get_boolean("progress-gif-enabled");
      this._trackColor = s.get_string("progress-bar-color");
      this._useSystemColor = s.get_boolean("progress-bar-use-system-color");
      this._activeThemeId = s.get_string("progress-theme-id");
      this._useNativeSlider = s.get_boolean("progress-use-native-slider");
      this._themeEngine.setActiveTheme(this._activeThemeId);
    }

    _connectSettings() {
      const watch = (key, callback) => {
        this._settingsIds.push(
          this._settings.connect(`changed::${key}`, callback),
        );
      };

      watch("progress-gif-enabled", () => {
        this._gifEnabled = this._settings.get_boolean("progress-gif-enabled");
        this._loadGif();
        this._syncSliderVisibility();
      });
      watch("progress-gif-path", () => this._loadGif());
      watch("progress-bar-color", () => {
        this._trackColor = this._settings.get_string("progress-bar-color");
        this._applyBarStyle();
      });
      watch("progress-bar-use-system-color", () => {
        this._useSystemColor = this._settings.get_boolean(
          "progress-bar-use-system-color",
        );
        this._applyBarStyle();
      });
      watch("progress-theme-id", () => {
        this._activeThemeId = this._settings.get_string("progress-theme-id");
        this._themeEngine.setActiveTheme(this._activeThemeId);
        this._autoLoadThemeGif();
        this._syncSliderVisibility();
      });
      watch("progress-use-native-slider", () => {
        this._useNativeSlider = this._settings.get_boolean(
          "progress-use-native-slider",
        );
        this._syncSliderVisibility();
        this._applyBarStyle();
      });
    }

    _buildUI() {
      this._sliderWrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        style: `min-height: ${THUMB_SIZE + 8}px;`,
      });

      const sliderContainer = new St.BoxLayout({
        style: `margin: 0 ${THUMB_R}px;`,
        x_expand: true,
      });

      this._positionSlider = new Slider.Slider(0);
      this._positionSlider.accessible_name = "Position";
      this._positionSlider.x_expand = true;

      this._sliderChangedId = this._positionSlider.connect(
        "notify::value",
        () => {
          if (this._sliderDragging) this._onDragMove();
          if (this._canvasArea.visible) this._canvasArea.queue_repaint();
        },
      );
      this._positionSlider.connect("drag-begin", () => {
        this._sliderDragging = true;
        this.stopPositionUpdate();
        this.emit("drag-begin");
      });
      this._positionSlider.connect("drag-end", () => {
        if (!this._sliderDragging) return;
        this._sliderDragging = false;
        this.emit(
          "seek",
          (this._positionSlider.value * this._trackLength) / 1_000_000,
        );
        this.emit("drag-end");
        this._saveCacheForCurrentPlayer();
        this._scheduleResume();
      });
      sliderContainer.add_child(this._positionSlider);

      this._canvasArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        reactive: true,
        visible: false,
      });
      this._canvasArea.connect("repaint", (area) => this._drawCanvas(area));
      this._canvasArea.connect("button-press-event", (_a, event) =>
        this._onCanvasPress(event),
      );
      this._canvasArea.connect("motion-event", (_a, event) =>
        this._onCanvasMotion(event),
      );
      this._canvasArea.connect("button-release-event", () =>
        this._onCanvasRelease(),
      );

      this._sliderWrapper.add_child(sliderContainer);
      this._sliderWrapper.add_child(this._canvasArea);
      this._sliderWrapper.connect("notify::allocation", () => {
        if (this._canvasArea.visible) this._canvasArea.queue_repaint();
      });
      this.add_child(this._sliderWrapper);

      const timeBox = new St.BoxLayout({ style: "margin: 0 8px;" });
      this._currentTimeLabel = new St.Label({
        text: "0:00",
        y_align: Clutter.ActorAlign.CENTER,
        style:
          "font-size: 12px; font-weight: 600; color: color-mix(in srgb, currentColor 70%, transparent);",
      });
      this._totalTimeLabel = new St.Label({
        text: "0:00",
        y_align: Clutter.ActorAlign.CENTER,
        style:
          "font-size: 12px; font-weight: 600; color: color-mix(in srgb, currentColor 50%, transparent);",
      });
      this._timeCenter = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      timeBox.add_child(this._currentTimeLabel);
      timeBox.add_child(this._timeCenter);
      timeBox.add_child(this._totalTimeLabel);
      this.add_child(timeBox);

      this._syncSliderVisibility();
      this._applyBarStyle();
      this._syncSeekVisibility();
    }

    setCenterChild(actor) {
      if (this._timeCenter.get_child() === actor) return;
      this._timeCenter.set_child(null);
      actor?.get_parent()?.remove_child(actor);
      this._timeCenter.set_child(actor);
      this._syncSeekVisibility();
    }

    _syncSeekVisibility() {
      const timed = this._hasLength;
      this._sliderWrapper.visible = timed;
      this._currentTimeLabel.visible = timed;
      this._totalTimeLabel.visible = timed;
      this.visible = timed || this._timeCenter.get_child() !== null;
    }

    get _usesCanvas() {
      return (
        !this._useNativeSlider &&
        (this._gifEnabled || this._activeThemeId !== "default")
      );
    }

    _syncSliderVisibility() {
      this._positionSlider.visible = !this._usesCanvas;
      this._canvasArea.visible = this._usesCanvas;
    }

    _applyBarStyle() {
      if (this._useNativeSlider) {
        this._positionSlider.style = null;
      } else if (this._usesCanvas) {
        this._positionSlider.style = "-slider-handle-radius: 0px; opacity: 0;";
      } else if (this._useSystemColor || !this._trackColor?.trim()) {
        this._positionSlider.style = null;
      } else {
        const color = this._trackColor.trim();
        this._positionSlider.style = `-barlevel-active-background-color: ${color}; -barlevel-active-border-color: ${color};`;
      }
    }

    _startAnim() {
      this._animTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        ANIM_INTERVAL_MS,
        () => {
          this._animOffset = (this._animOffset + 2) % 10000;
          if (this._canvasArea.visible) this._canvasArea.queue_repaint();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _removeSource(name) {
      if (this[name]) {
        GLib.source_remove(this[name]);
        this[name] = null;
      }
    }

    _drawCanvas(area) {
      const cr = area.get_context();
      try {
        const theme = this._themeEngine.getActiveTheme();
        if (theme) this._paintTheme(cr, area, theme);
      } catch (e) {
        console.error(
            _('Progress theme failed to draw: %s').format(e.message)
        );
      } finally {
        cr.$dispose();
      }
    }

    _paintTheme(cr, area, theme) {
      const W = area.allocation.get_width();
      const H = area.allocation.get_height();
      const ratio = this._positionSlider.value;
      const trackY = H / 2;

      theme.drawTrack(
        new ThemeContext(
          cr,
          W,
          H,
          ratio,
          this._animOffset,
          this._isPlaying,
          trackY,
          TRACK_MARGIN,
        ),
      );

      if (typeof theme.drawThumb !== "function") return;

      const thumbX = TRACK_MARGIN + clamp01(ratio) * (W - TRACK_MARGIN * 2);
      cr.save();
      cr.translate(thumbX - THUMB_R, trackY - THUMB_R);
      theme.drawThumb(
        new ThumbContext(
          cr,
          THUMB_SIZE,
          ratio,
          this._animOffset,
          this._isPlaying,
          this._currentThumbPixbuf,
        ),
      );
      cr.restore();
    }

    _canvasGeometry() {
      const [left] = this._canvasArea.get_transformed_position();
      const trackW = this._canvasArea.allocation.get_width() - TRACK_MARGIN * 2;
      return { left, trackW };
    }

    _onCanvasPress(event) {
      if (!this._canSeek) return Clutter.EVENT_PROPAGATE;

      const [x] = event.get_coords();
      const { left, trackW } = this._canvasGeometry();
      const thumbX = left + TRACK_MARGIN + this._positionSlider.value * trackW;

      if (Math.abs(x - thumbX) <= THUMB_R + 6) {
        this._thumbDragging = true;
        this._thumbPressX = x;
        this._thumbPressRatio = this._positionSlider.value;
        this._sliderDragging = true;
        this.stopPositionUpdate();
        this.emit("drag-begin");
        this._pointerGrab = global.stage.grab(this._canvasArea);
        return Clutter.EVENT_STOP;
      }

      const ratio = clamp01((x - left - TRACK_MARGIN) / trackW);
      this._sliderDragging = false;
      this._applyRatio(ratio);
      this.emit("seek", (ratio * this._trackLength) / 1_000_000);
      this._saveCacheForCurrentPlayer();
      return Clutter.EVENT_STOP;
    }

    _onCanvasMotion(event) {
      if (!this._thumbDragging) return Clutter.EVENT_PROPAGATE;

      const [x] = event.get_coords();
      const { trackW } = this._canvasGeometry();
      this._applyRatio(
        clamp01(this._thumbPressRatio + (x - this._thumbPressX) / trackW),
      );
      return Clutter.EVENT_STOP;
    }

    _onCanvasRelease() {
      if (!this._thumbDragging) return Clutter.EVENT_PROPAGATE;

      this._releaseGrab();
      this._thumbDragging = false;
      this._sliderDragging = false;
      this.emit(
        "seek",
        (this._positionSlider.value * this._trackLength) / 1_000_000,
      );
      this.emit("drag-end");
      this._saveCacheForCurrentPlayer();
      this._scheduleResume();
      return Clutter.EVENT_STOP;
    }

    _releaseGrab() {
      this._pointerGrab?.dismiss();
      this._pointerGrab = null;
    }

    _setSliderValue(value) {
      this._positionSlider.block_signal_handler(this._sliderChangedId);
      this._positionSlider.value = value;
      this._positionSlider.unblock_signal_handler(this._sliderChangedId);
    }

    _applyRatio(ratio) {
      this._setSliderValue(ratio);
      this._currentPosition = ratio * this._trackLength;
      this._currentTimeLabel.text = this._formatTime(
        this._currentPosition / 1_000_000,
      );
      this._emitRatio(ratio);
      if (this._canvasArea.visible) this._canvasArea.queue_repaint();
    }

    _autoLoadThemeGif() {
      const entry = this._themeEngine.getThemeEntry(this._activeThemeId);
      if (!entry || entry.builtin || !entry.thumbFile) return;
      if (this._settings.get_string("progress-gif-path") === entry.thumbFile)
        return;

      this._settings.set_string("progress-gif-path", entry.thumbFile);
      this._settings.set_boolean("progress-gif-enabled", true);
    }

    _scaledFrame(pixbuf) {
      return (
        pixbuf?.scale_simple(
          THUMB_SIZE,
          THUMB_SIZE,
          GdkPixbuf.InterpType.BILINEAR,
        ) ?? null
      );
    }

    _loadGif() {
      this._removeSource("_gifFrameTimeout");
      this._gifCancellable?.cancel();
      this._gifCancellable = null;
      this._gifAnimation = null;
      this._gifFrameIter = null;
      this._currentThumbPixbuf = null;

      const path = this._settings.get_string("progress-gif-path");
      if (!this._gifEnabled || !path) return;

      let stream;
      try {
        stream = Gio.File.new_for_path(path).read(null);
      } catch (e) {
        console.warn(`Cannot read animated thumb ${path}: ${e.message}`);
        return;
      }

      const cancellable = new Gio.Cancellable();
      this._gifCancellable = cancellable;

      GdkPixbuf.PixbufAnimation.new_from_stream_async(
        stream,
        cancellable,
        (_src, result) => {
          let animation;
          try {
            animation =
              GdkPixbuf.PixbufAnimation.new_from_stream_finish(result);
          } catch (e) {
            if (!cancellable.is_cancelled())
              console.warn(
                `Cannot decode animated thumb ${path}: ${e.message}`,
              );
            return;
          } finally {
            stream.close(null);
          }

          if (cancellable.is_cancelled()) return;

          if (animation.is_static_image()) {
            this._currentThumbPixbuf = this._scaledFrame(
              animation.get_static_image(),
            );
            return;
          }

          this._gifAnimation = animation;
          this._gifFrameIter = animation.get_iter(null);
          this._advanceGifFrame();
        },
      );
    }

    _advanceGifFrame() {
      const iter = this._gifFrameIter;
      if (!iter) return;

      this._currentThumbPixbuf =
        this._scaledFrame(iter.get_pixbuf()) ?? this._currentThumbPixbuf;

      const delay = Math.max(
        MIN_GIF_DELAY_MS,
        iter.get_delay_time() || DEFAULT_GIF_DELAY_MS,
      );
      this._gifFrameTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        delay,
        () => {
          this._gifFrameTimeout = null;
          iter.advance(null);
          this._advanceGifFrame();
          return GLib.SOURCE_REMOVE;
        },
      );
    }

    _scheduleResume() {
      this._removeSource("_resumeTimeout");
      this._resumeTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        RESUME_DELAY_MS,
        () => {
          this._resumeTimeout = null;
          if (this._isPlaying) this.startPositionUpdate();
          return GLib.SOURCE_REMOVE;
        },
      );
    }

    setPlayerName(name) {
      if (this._playerName === name) return;

      this._saveCacheForCurrentPlayer();
      this._playerName = name;
      this._restoreCacheForCurrentPlayer();
    }

    updatePlaybackState(isPlaying, metadata, _status) {
      this._isPlaying = isPlaying;

      if (metadata) {
        const length = Number(metadata["mpris:length"]) || 0;
        const trackId = metadata["mpris:trackid"]
          ? String(metadata["mpris:trackid"])
          : null;

        if (length !== this._trackLength || trackId !== this._trackId) {
          this._currentPosition = 0;
          this._setSliderValue(0);
          this._currentTimeLabel.text = "0:00";
        }

        this._trackLength = length;
        this._trackId = trackId;
        this._totalTimeLabel.text = this._formatTime(
          this._trackLength / 1_000_000,
        );

        this._hasLength = this._trackLength > 0;
        this._canSeek = this._hasLength && Boolean(this._trackId);
        this._positionSlider.reactive = this._canSeek;
        this._syncSeekVisibility();
        if (!this._hasLength) {
          this.stopPositionUpdate();
          return;
        }
      }

      if (isPlaying) {
        this.startPositionUpdate();
      } else {
        this.stopPositionUpdate();
        this._updateSliderPosition();
      }
    }

    startPositionUpdate() {
      this.stopPositionUpdate();
      this._updateSliderPosition();
      this._updateInterval = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        POSITION_POLL_MS,
        () => {
          if (!this._sliderDragging && this._isPlaying)
            this._updateSliderPosition(true);
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    stopPositionUpdate() {
      this._removeSource("_updateInterval");
    }

    onSeeked(position) {
      this._currentPosition = position;
      if (!this._sliderDragging) {
        this._applyPosition(position);
        this._saveCacheForCurrentPlayer();
      }
    }

    _updateSliderPosition(tick = false) {
      if (this._sliderDragging || !this._playerName || !this._trackLength)
        return;

      const position = this._readPlayerPosition(this._playerName);
      if (position !== null) this._currentPosition = position;
      else if (tick) this._currentPosition += POSITION_POLL_MS * 1000;

      this._applyPosition(this._currentPosition);
      this._saveCacheForCurrentPlayer();
    }

    _applyPosition(position) {
      position = Math.min(Math.max(0, position), this._trackLength);
      const ratio = this._trackLength > 0 ? position / this._trackLength : 0;

      this._setSliderValue(ratio);
      this._currentTimeLabel.text = this._formatTime(position / 1_000_000);
      this._emitRatio(ratio);
      if (this._canvasArea.visible) this._canvasArea.queue_repaint();
    }

    // short blocking call, players can vanish from the bus at any time
    _readPlayerPosition(busName) {
      try {
        const reply = Gio.DBus.session.call_sync(
          busName,
          "/org/mpris/MediaPlayer2",
          "org.freedesktop.DBus.Properties",
          "Get",
          new GLib.Variant("(ss)", [
            "org.mpris.MediaPlayer2.Player",
            "Position",
          ]),
          null,
          Gio.DBusCallFlags.NONE,
          50,
          null,
        );
        const value = Number(reply.recursiveUnpack()[0]);
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    }

    _onDragMove() {
      if (!this._trackLength) return;

      const ratio = this._positionSlider.value;
      this._currentTimeLabel.text = this._formatTime(
        (ratio * this._trackLength) / 1_000_000,
      );
      this._emitRatio(ratio);
    }

    _emitRatio(ratio) {
      this.emit("slider-ratio-changed", ratio);
    }

    _saveCacheForCurrentPlayer() {
      if (!this._playerName) return;

      this._playerCache.set(this._playerName, {
        position: this._currentPosition,
        length: this._trackLength,
        trackId: this._trackId,
        sliderValue: this._positionSlider.value,
        currentTimeText: this._currentTimeLabel.text,
        totalTimeText: this._totalTimeLabel.text,
      });
    }

    _restoreCacheForCurrentPlayer() {
      const cached = this._playerCache.get(this._playerName);
      if (!cached) {
        this._hardReset();
        return;
      }

      this._currentPosition = cached.position;
      this._trackLength = cached.length;
      this._trackId = cached.trackId;
      this._setSliderValue(cached.sliderValue);
      this._currentTimeLabel.text = cached.currentTimeText;
      this._totalTimeLabel.text = cached.totalTimeText;
      this._emitRatio(cached.sliderValue);
    }

    _hardReset() {
      this.stopPositionUpdate();
      this._currentPosition = 0;
      this._sliderDragging = false;
      this._setSliderValue(0);
      this._currentTimeLabel.text = "0:00";
      this._totalTimeLabel.text = "0:00";
    }

    _formatTime(seconds) {
      if (!seconds || seconds < 0) return "0:00";

      const total = Math.floor(seconds);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = String(total % 60).padStart(2, "0");

      return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
    }

    get currentPosition() {
      return this._currentPosition;
    }

    get trackLength() {
      return this._trackLength;
    }

    set trackLength(v) {
      this._trackLength = v;
    }

    get sliderValue() {
      return this._positionSlider.value;
    }

    destroy() {
      this._releaseGrab();
      for (const name of [
        "_updateInterval",
        "_resumeTimeout",
        "_animTimeout",
        "_gifFrameTimeout",
      ])
        this._removeSource(name);

      this._gifCancellable?.cancel();
      this._gifCancellable = null;

      this._settingsIds.forEach((id) => this._settings.disconnect(id));
      this._settingsIds = [];

      this._themeEngine.destroy();
      this._themeEngine = null;

      this._gifAnimation = null;
      this._gifFrameIter = null;
      this._currentThumbPixbuf = null;
      this._playerCache.clear();

      delete globalThis._themeGdk;

      super.destroy();
    }
  },
);