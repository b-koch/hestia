import GLib from "gi://GLib";
import {
  Extension,
  InjectionManager,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Mpris from "resource:///org/gnome/shell/ui/mpris.js";

import { MediaIndicator } from "./utils/indicator.js";
import { installDefaultThemesIfNeeded } from "./utils/DefaultThemeInstaller.js";

const REPOSITION_DELAY_MS = 150;

export default class MediaExtension extends Extension {
  enable() {
    this._themeInstallCancellable = installDefaultThemesIfNeeded();

    this._settings = this.getSettings();
    this._indicator = new MediaIndicator(this._settings, this);
    this._addToPanel();

    this._settings.connectObject(
      "changed::hide-default-player",
      () => this._syncDefaultPlayer(),
      "changed::panel-position",
      () => this._queueReposition(),
      "changed::panel-index",
      () => this._queueReposition(),
      this,
    );

    this._syncDefaultPlayer();
  }

  disable() {
    this._themeInstallCancellable?.cancel();
    this._themeInstallCancellable = null;

    this._clearRepositionTimeout();
    this._settings.disconnectObject(this);

    this._setDateMenuMediaVisible(true);
    this._restoreNativePlayers();

    this._indicator.destroy();
    this._indicator = null;
    this._settings = null;
  }

  get _statusAreaKey() {
    return `media-controls-${this.uuid}`;
  }

  _addToPanel() {
    const { position, index } = this._panelPlacement();
    Main.panel.addToStatusArea(
      this._statusAreaKey,
      this._indicator,
      index,
      position,
    );
  }

  _panelPlacement() {
    const boxes = {
      left: Main.panel._leftBox,
      center: Main.panel._centerBox,
      right: Main.panel._rightBox,
    };
    const position = this._settings.get_string("panel-position");
    const rawIndex = this._settings.get_int("panel-index");
    const box = boxes[position] ?? boxes.right;
    const index =
      rawIndex === -1 ? 0 : Math.min(rawIndex, box.get_n_children());

    return { position, index };
  }

  _queueReposition() {
    this._clearRepositionTimeout();
    this._repositionId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      REPOSITION_DELAY_MS,
      () => {
        this._repositionId = null;
        this._repositionIndicator();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _clearRepositionTimeout() {
    if (!this._repositionId) return;
    GLib.Source.remove(this._repositionId);
    this._repositionId = null;
  }

  _repositionIndicator() {
    const { container } = this._indicator;
    container.get_parent()?.remove_child(container);
    delete Main.panel.statusArea[this._statusAreaKey];
    this._addToPanel();
  }

  _syncDefaultPlayer() {
    if (this._settings.get_boolean("hide-default-player")) {
      this._setDateMenuMediaVisible(false);
      this._suppressNativePlayers();
    } else {
      this._setDateMenuMediaVisible(true);
      this._restoreNativePlayers();
    }
  }

  
  _nativeMediaSections() {
    const { dateMenu, quickSettings } = Main.panel.statusArea;
    const messageList = dateMenu?._messageList;

    return [
      messageList?._messageView?._mediaSource ?? messageList?._mediaSection,
      quickSettings?._mediaSection,
    ].filter(Boolean);
  }

  _setDateMenuMediaVisible(visible) {
    if (Mpris.MprisSource) return;

    const section = Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
    if (section) section.visible = visible;
  }

  _suppressNativePlayers() {
    const MprisSource = Mpris.MprisSource ?? Mpris.MediaSection;
    if (this._injectionManager || !MprisSource) return;

    this._injectionManager = new InjectionManager();
    this._injectionManager.overrideMethod(
      MprisSource.prototype,
      "_addPlayer",
      () => function () {},
    );

    for (const section of this._nativeMediaSections()) {
      for (const player of section._players?.values() ?? []) {
        const busName = player._busName ?? player.busName;
        if (busName)
          section._onNameOwnerChanged?.(null, null, [busName, busName, ""]);
      }
    }
  }

  _restoreNativePlayers() {
    if (!this._injectionManager) return;

    this._injectionManager.clear();
    this._injectionManager = null;

    for (const section of this._nativeMediaSections())
      section._onProxyReady?.();
  }
}
