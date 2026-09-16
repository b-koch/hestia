import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import { ScrollingLabel } from "../ui/ScrollingLabel.js";
import { resolveGicon, applyMonochromeToIcon } from "../icon/IconResolver.js";
import { playerConstant } from "../ui/playerConstant.js";

const BASE_SCROLL_PX_PER_SEC = 50;
const LOOP_PAUSE_MS = 1200;
// Crossfade duration when the panel icon switches apps
const ICON_FADE_MS = 120;

function _isDarkTheme() {
  try {
    const s = new Gio.Settings({ schema_id: playerConstant.INTERFACE_SCHEMA });
    const keys = s.list_keys();
    if (keys.indexOf(playerConstant.INTERFACE_KEY) !== -1)
      return s.get_string(playerConstant.INTERFACE_KEY) === "prefer-dark";
    if (keys.indexOf(playerConstant.GTK_THEME_KEY) !== -1)
      return s
        .get_string(playerConstant.GTK_THEME_KEY)
        .toLowerCase()
        .includes("dark");
  } catch (_) {}
  return true;
}

function _labelWidth(settings) {
  try {
    return Math.max(60, settings.get_int("panel-label-width"));
  } catch (_) {
    return 160;
  }
}
/** Build a CSS style string for the panel label from appearance settings. */
function _panelLabelStyle(settings) {
  try {
    const size   = settings.get_int("panel-font-size") || 13;
    const bold   = settings.get_boolean("panel-font-bold");
    const family = (settings.get_string("panel-font-family") || "").trim();
    const color  = (settings.get_string("panel-font-color") || "").trim();
    const w      = _labelWidth(settings);

    let style = `font-size: ${size}px; font-weight: ${bold ? "bold" : "normal"};`;
    if (family) style += ` font-family: ${family};`;
    if (color)  style += ` color: ${color};`;
    style += ` max-width: ${w}px;`;
    return style;
  } catch (_) {
    return `font-size: 13px; max-width: ${_labelWidth(settings)}px;`;
  }
}

/** Panel app-icon size from settings, defaulting to 18. */
function _panelIconSize(settings) {
  try {
    const v = settings.get_int("panel-icon-size");
    return v >= 12 ? v : 18;
  } catch (_) {
    return 18;
  }
}

/**
 * Read panel-element-order setting.
 * Valid ids: "icon", "label", "controls"
 * Returns ordered array, filling in any missing ids at the end.
 */
function _panelElementOrder(settings) {
  const DEFAULT = ["icon", "label", "controls"];
  if (!settings) return DEFAULT;
  try {
    const raw = settings.get_string("panel-element-order");
    if (!raw) return DEFAULT;
    const VALID = new Set(DEFAULT);
    const seen = new Set();
    const out = [];
    for (const id of raw.split(",").map(t => t.trim()).filter(Boolean)) {
      if (VALID.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
    }
    for (const id of DEFAULT) { if (!seen.has(id)) out.push(id); }
    return out;
  } catch (_e) {
    return DEFAULT;
  }
}

export class PanelUI {
  constructor(indicator) {
    this._indicator = indicator;
    this._scrollLabel = null;
    this._settings = null;
    this._status = "Stopped";

    this._dark = _isDarkTheme();
    this._themeSettings = null;
    this._themeSettingsId = 0;
    this._extSettings = indicator._settings || null;
    this._orderChangedId = 0;
    this._labelWidthChangedId = 0;

    this._playingPlayer = null;
    this._currentPlayer = null;
    this._manager = null;

    this._lastIconSource = null;
    this._iconFadeTid = 0;

    // Cache last scroll params so we can re-apply on width change
    this._lastScrollText = null;
    this._lastScrollStatus = "Stopped";

    this._buildUI();
    this._watchTheme();

    if (this._extSettings) {
      // Live-reorder panel elements when the setting changes
      this._orderChangedId = this._extSettings.connect(
        "changed::panel-element-order",
        () => this._reorderPanelElements(),
      );

      // Live-update label viewport when panel-label-width changes
      this._labelWidthChangedId = this._extSettings.connect(
        "changed::panel-label-width",
        () => this._onLabelWidthChanged(),
      );

      // Live-update when any appearance setting changes
      const APPEARANCE_KEYS = [
        "panel-font-family", "panel-font-size", "panel-font-bold",
        "panel-font-color", "panel-icon-size", "monochrome-icons",
      ];
      this._appearanceChangedIds = APPEARANCE_KEYS.map((key) =>
        this._extSettings.connect(`changed::${key}`, () => {
          this._applyPanelIconSize();
          this._applyMonochrome();
          if (this._lastScrollText && this._lastScrollStatus) {
            this.startScrolling(
              this._lastScrollText,
              this._settings || this._extSettings,
              this._lastScrollStatus,
            );
          }
        }),
      );
    }
  }

  _onLabelWidthChanged() {
    if (
      this._lastScrollText &&
      (this._lastScrollStatus === "Playing" ||
        this._lastScrollStatus === "Paused")
    ) {
      this.startScrolling(
        this._lastScrollText,
        this._settings || this._extSettings,
        this._lastScrollStatus,
      );
    }
  }

  _applyPanelIconSize() {
    if (!this._icon || !this._extSettings) return;
    this._icon.icon_size = _panelIconSize(this._extSettings);
  }

  _watchTheme() {
    try {
      this._themeSettings = new Gio.Settings({
        schema_id: playerConstant.INTERFACE_SCHEMA,
      });
      const keys = this._themeSettings.list_keys();
      const key =
        keys.indexOf(playerConstant.INTERFACE_KEY) !== -1
          ? playerConstant.INTERFACE_KEY
          : playerConstant.GTK_THEME_KEY;
      this._themeSettingsId = this._themeSettings.connect(
        `changed::${key}`,
        () => {
          this._dark = _isDarkTheme();
          this._applyButtonTheme();
        },
      );
    } catch (_) {
      this._themeSettings = null;
      this._themeSettingsId = 0;
    }
  }

  _applyButtonTheme() {
    if (this._panelPrevBtn)
      this._panelPrevBtn.style = _panelButtonStyle(this._dark);
    if (this._panelPlayBtn)
      this._panelPlayBtn.style = _panelButtonStyle(this._dark);
    if (this._panelNextBtn)
      this._panelNextBtn.style = _panelButtonStyle(this._dark);
  }

  _buildUI() {
    this._box = new St.BoxLayout({
      style_class: "panel-status-menu-box panel-button-box",
      style: "spacing: 6px;",
    });
    this._indicator.add_child(this._box);

    // Build all three panel elements unconditionally; ordering happens below.
    this._icon = new St.Icon({
      gicon: Gio.ThemedIcon.new("audio-x-generic-symbolic"),
      icon_size: _panelIconSize(this._extSettings || {}),
      y_align: Clutter.ActorAlign.CENTER,
      style: "icon-style: requested;",
    });
    this._icon.set_pivot_point(0.5, 0.5);

    this._panelControlsBox = new St.BoxLayout({
      style_class: "panel-controls-box",
      style: "spacing: 2px;",
    });

    this._panelPrevBtn = this._makeButton("media-skip-backward-symbolic");
    this._panelControlsBox.add_child(this._panelPrevBtn);

    this._panelPlayBtn = this._makeButton("media-playback-start-symbolic");
    this._panelControlsBox.add_child(this._panelPlayBtn);

    this._panelNextBtn = this._makeButton("media-skip-forward-symbolic");
    this._panelControlsBox.add_child(this._panelNextBtn);

    this._labelContainer = new St.BoxLayout({
      y_align: Clutter.ActorAlign.CENTER,
      style: "margin-left: 0;",
    });
    this._labelContainer.hide();

    // Insert children in the configured order
    this._reorderPanelElements();
  }

  /** Map an element id to its top-level widget in the panel box. */
  _elementForId(id) {
    switch (id) {
      case "icon":     return this._icon;
      case "label":    return this._labelContainer;
      case "controls": return this._panelControlsBox;
      default:         return null;
    }
  }

  /** Re-add panel box children in the order specified by the setting. */
  _reorderPanelElements() {
    // Remove all children; they are re-parented below so nothing is destroyed.
    this._box.remove_all_children();
    const order = _panelElementOrder(this._extSettings);
    for (const id of order) {
      const child = this._elementForId(id);
      if (child) this._box.add_child(child);
    }
  }

  _makeButton(iconName) {
    const btn = new St.Button({
      style_class: "panel-media-button",
      style: _panelButtonStyle(this._dark),
      can_focus: true,
      track_hover: true,
      reactive: true,
    });
    btn.set_child(new St.Icon({ icon_name: iconName, icon_size: 14 }));
    return btn;
  }

  // Accessors

  get box() {
    return this._box;
  }
  get icon() {
    return this._icon;
  }
  get panelPrevBtn() {
    return this._panelPrevBtn;
  }
  get panelPlayBtn() {
    return this._panelPlayBtn;
  }
  get panelNextBtn() {
    return this._panelNextBtn;
  }

  get label() {
    if (!this._labelShim) {
      this._labelShim = {
        show: () => this._labelContainer.show(),
        hide: () => {
          this._labelContainer.hide();
          this.stopScrolling();
        },
      };
    }
    return this._labelShim;
  }

  // Track label / scrolling

  startScrolling(fullText, settings, status = "Playing") {
      if (!fullText) {
        this.stopScrolling();
        return;
      }

      this._settings = settings;
      this._status = status;
      this._lastScrollText = fullText;
      this._lastScrollStatus = status;

      const labelW = _labelWidth(settings);
      const isPlaying = status === "Playing";
      const isActiveMedia = status === "Playing" || status === "Paused";
      const enabled = settings.get_boolean("enable-panel-scroll");
      const textStyle = _panelLabelStyle(this._settings || this._extSettings || {});

      if (!isActiveMedia) {
        this.stopScrolling();
        return;
      }

      const testLbl = new St.Label({ text: fullText, style: textStyle });
      const [, natW] = testLbl.clutter_text.get_preferred_width(-1);
      testLbl.destroy();

      if (!isPlaying || !enabled || natW <= labelW) {
        if (this._scrollLabel) {
          this._scrollLabel.destroy();
          this._scrollLabel = null;
        }
        this._labelContainer.destroy_all_children();

        const lbl = new St.Label({
          text: fullText,
          y_align: Clutter.ActorAlign.CENTER,
          style: textStyle,
        });
        lbl.clutter_text.ellipsize = 3;
        lbl.clutter_text.single_line_mode = true;
        this._labelContainer.add_child(lbl);
        this._labelContainer.show();
        return;
      }

      const speed = this._calcSpeed(settings);

      if (this._scrollLabel) {
        if (this._scrollLabel._viewW !== labelW) {
          this._scrollLabel.destroy();
          this._scrollLabel = null;
          this._labelContainer.destroy_all_children();
        } else {
          this._scrollLabel.setScrollSpeed(speed);
          this._scrollLabel.setTextStyle(textStyle);
          this._scrollLabel.setText(fullText);
          this._labelContainer.show();
          return;
        }
      }

      this._labelContainer.destroy_all_children();
      this._scrollLabel = new ScrollingLabel({
        text: fullText,
        viewportWidth: labelW,
        isScrolling: true,
        initPaused: false,
        scrollSpeed: speed,
        scrollPauseTime: LOOP_PAUSE_MS,
        textStyle,
      });
      this._labelContainer.add_child(this._scrollLabel);
      this._labelContainer.show();
    }

  _calcSpeed(settings) {
    const pref = settings.get_int("scroll-speed");
    return Math.round(BASE_SCROLL_PX_PER_SEC * (pref / 5));
  }

  stopScrolling() {
    if (this._scrollLabel) {
      this._scrollLabel.destroy();
      this._scrollLabel = null;
    }
    this._labelContainer.destroy_all_children();
    this._settings = null;
    this._lastScrollText = null;
    this._lastScrollStatus = "Stopped";
  }

  // App icon updaters

  /**
   * @param {string|null} playerName  MPRIS bus name of the playing app, or null
   * @param {object}      manager     MprisManager instance
   */
  setPlayingPlayer(playerName, manager) {
    if (this._indicator._state._sessionChanging) return;

    const next = playerName || null;
    this._playingPlayer = next;
    this._manager = manager;

    this._lastIconSource = undefined;
    this._refreshIcon();
  }

  /**
   * @param {string|null} playerName  MPRIS bus name the popup is focused on
   * @param {object}      manager     MprisManager instance
   */
  setCurrentPlayer(playerName, manager) {
    if (this._indicator._state._sessionChanging) return;
    this._currentPlayer = playerName || null;
    this._manager = manager;
    // Only re-render when nothing is playing
    if (!this._playingPlayer) this._refreshIcon();
  }

  // Back-compat shim
  updateAppIcon(manager, currentPlayer) {
    this.setCurrentPlayer(currentPlayer, manager);
  }

  _refreshIcon() {
    if (!this._icon) return;

    const source = this._playingPlayer || this._currentPlayer;

    if (source === this._lastIconSource) return;
    this._lastIconSource = source;

    const newGicon = source
      ? resolveGicon(source, this._manager)
      : Gio.ThemedIcon.new("audio-x-generic-symbolic");

    this._crossfadeIcon(newGicon);
  }

  _applyMonochrome() {
    if (!this._icon || !this._extSettings) return;
    const mono = this._extSettings.get_boolean("monochrome-icons");
    applyMonochromeToIcon(
      this._icon,
      this._lastColourGicon || this._icon.gicon,
      this._lastIconSource,
      this._manager,
      mono,
    );
  }

  _crossfadeIcon(newGicon) {
    if (!this._icon) return;

    this._lastColourGicon = newGicon;

    if (this._iconFadeTid) {
      GLib.source_remove(this._iconFadeTid);
      this._iconFadeTid = 0;
    }

    _easeOpacity(this._icon, 0, ICON_FADE_MS);

    this._iconFadeTid = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      ICON_FADE_MS,
      () => {
        this._iconFadeTid = 0;
        if (!this._icon) return GLib.SOURCE_REMOVE;
        const mono = this._extSettings &&
          this._extSettings.get_boolean("monochrome-icons");
        if (mono) {
          applyMonochromeToIcon(
            this._icon,
            newGicon,
            this._lastIconSource,
            this._manager,
            true,
          );
        } else {
          this._icon.gicon = newGicon;
        }
        _easeOpacity(this._icon, 255, ICON_FADE_MS);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  destroy() {
    if (this._orderChangedId && this._extSettings) {
      try { this._extSettings.disconnect(this._orderChangedId); } catch (_) {}
      this._orderChangedId = 0;
    }

    if (this._labelWidthChangedId && this._extSettings) {
      try { this._extSettings.disconnect(this._labelWidthChangedId); } catch (_) {}
      this._labelWidthChangedId = 0;
    }

    if (this._appearanceChangedIds && this._extSettings) {
      for (const id of this._appearanceChangedIds) {
        try { this._extSettings.disconnect(id); } catch (_) {}
      }
      this._appearanceChangedIds = [];
    }

    if (this._themeSettings && this._themeSettingsId) {
      try {
        this._themeSettings.disconnect(this._themeSettingsId);
      } catch (_) {}
      this._themeSettingsId = 0;
      this._themeSettings = null;
    }

    if (this._iconFadeTid) {
      GLib.source_remove(this._iconFadeTid);
      this._iconFadeTid = 0;
    }

    this.stopScrolling();
    this._playingPlayer = null;
    this._currentPlayer = null;
    this._lastIconSource = null;
    this._lastColourGicon = null;
    this._manager = null;
    this._labelShim = null;
    this._extSettings = null;
    this._indicator = null;
  }
}

function _panelButtonStyle(_dark) {
  return "padding: 2px 4px; border-radius: 5px;";
}

function _easeOpacity(actor, target, ms) {
  if (!actor) return;
  actor.save_easing_state();
  actor.set_easing_duration(ms);
  actor.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
  actor.opacity = target;
  actor.restore_easing_state();
}