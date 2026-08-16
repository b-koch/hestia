import * as Main from "resource:///org/gnome/shell/ui/main.js";

const BROWSER_MPRIS_PREFIXES = [
  "firefox",
  "chromium",
  "chrome",
  "google-chrome",
  "brave",
  "opera",
  "vivaldi",
  "microsoft-edge",
  "epiphany",
  "falkon",
  "midori",
  "waterfox",
  "librewolf",
  "floorp",
];

export class IndicatorUIUpdater {
  constructor(indicator) {
    this._indicator = indicator;
  }

  _isBrowserPlayer(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return BROWSER_MPRIS_PREFIXES.some((prefix) => lower.includes(prefix));
  }

  _browserIsIdle(name, manager) {
    if (!this._isBrowserPlayer(name)) return false;
    try {
      const info = manager.getPlayerInfo(name);
      if (!info) return true;
      if (info.status === "Playing" || info.status === "Paused") return false;
      if (info.status === "Stopped" && info.title) return false;
      return true;
    } catch (_) {
      return true;
    }
  }

  _findBestFallback(players, exclude, manager) {
    let paused = null;
    let stoppedWithTitle = null;
    let stoppedAny = null;

    for (const name of players) {
      if (name === exclude) continue;
      try {
        const pInfo = manager.getPlayerInfo(name);
        if (!pInfo) continue;
        if (pInfo.status === "Playing") return name;
        if (pInfo.status === "Paused" && !paused) paused = name;
        if (pInfo.status === "Stopped") {
          if (pInfo.title && !stoppedWithTitle) stoppedWithTitle = name;
          if (!stoppedAny && !this._isBrowserPlayer(name)) stoppedAny = name;
        }
      } catch (_) {}
    }

    return paused ?? stoppedWithTitle ?? stoppedAny ?? null;
  }

  updateVisibility() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._isInitializing ||
      this._indicator._state._sessionChanging ||
      !this._indicator._state._managerInitialized
    )
      return;

    try {
      const isLocked = Main.sessionMode.isLocked || false;
      const isUnlockDialog = Main.sessionMode.currentMode === "unlock-dialog";

      if (isLocked || isUnlockDialog) {
        this._indicator.hide();
        return;
      }

      const manager = this._indicator._manager;
      if (!manager) {
        this._indicator.hide();
        return;
      }

      const players = manager.getPlayers();
      if (players.length === 0) {
        this._indicator.hide();
        return;
      }

      this._indicator._state.refreshMultiPlayingState(manager);

      const currentPlayer = this._indicator._state._currentPlayer;
      const info = currentPlayer ? manager.getPlayerInfo(currentPlayer) : null;

      const currentHasMedia =
        info && (info.status === "Playing" || info.status === "Paused");
      const currentIsStopped = info && info.status === "Stopped";

      if (currentHasMedia) {
        this._indicator.show();
        return;
      }

      if (currentIsStopped && currentPlayer) {
        const currentIsIdleBrowser = this._browserIsIdle(currentPlayer, manager);

        if (currentIsIdleBrowser) {
          const fallback = this._findBestFallback(
            players,
            currentPlayer,
            manager,
          );
          if (fallback) {
            if (!this._indicator._state.autoSwitchBlocked)
              this._indicator._state._currentPlayer = fallback;
            this.updateUI();
            this.updateTabs();
            this._indicator.show();
            return;
          }
          this._indicator._state._currentPlayer = null;
          this._indicator._panelUI.stopScrolling();
          this._indicator._panelUI.label.hide();
          this._indicator.hide();
          return;
        }

        this._indicator.show();
        return;
      }

      if (!this._indicator._state.autoSwitchBlocked) {
        for (const name of players) {
          const pInfo = manager.getPlayerInfo(name);
          if (
            pInfo &&
            (pInfo.status === "Playing" || pInfo.status === "Paused")
          ) {
            this._indicator._state._currentPlayer = name;
            this.updateUI();
            this._indicator.show();
            return;
          }
        }
      } else {
        for (const name of players) {
          const pInfo = manager.getPlayerInfo(name);
          if (
            pInfo &&
            (pInfo.status === "Playing" || pInfo.status === "Paused")
          ) {
            this._indicator.show();
            return;
          }
        }
      }

      this._indicator.hide();
    } catch (e) {}
  }

  updateUI() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      if (!this._indicator._state._currentPlayer) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        this._indicator.hide();
        return;
      }

      const info = this._indicator._manager.getPlayerInfo(
        this._indicator._state._currentPlayer,
      );
      if (!info) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        this._indicator.hide();
        return;
      }

      this._indicator._controls.update(
        info,
        this._indicator._state._currentPlayer,
        this._indicator._manager,
      );
      this._indicator._panelUI.updateAppIcon(
        this._indicator._manager,
        this._indicator._state._currentPlayer,
      );

      const playIcon =
        info.status === "Playing"
          ? "media-playback-pause-symbolic"
          : "media-playback-start-symbolic";
      this._indicator._panelUI.panelPlayBtn.child.icon_name = playIcon;

      this.updateLabel();
      this.updateTabs();
    } catch (e) {}
  }

  updateLabel() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      const showTrackName =
        this._indicator._settings.get_boolean("show-track-name");

      if (!this._indicator._state._currentPlayer) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        return;
      }

      const info = this._indicator._manager.getPlayerInfo(
        this._indicator._state._currentPlayer,
      );

      if (!showTrackName) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        return;
      }

      if (info && (info.status === "Playing" || info.status === "Paused")) {
        const showArtist = this._indicator._settings.get_boolean("show-artist");
        const separator =
          this._indicator._settings.get_string("separator-text");

        let text = info.title || "Unknown";
        if (showArtist && info.artists && info.artists.length > 0)
          text += separator + info.artists.join(", ");

        this._lastLabelText = text;

        this._indicator._panelUI.startScrolling(
          text,
          this._indicator._settings,
          info.status,
        );
        this._indicator._panelUI.label.show();
        return;
      }

      if (this._isBrowserPlayer(this._indicator._state._currentPlayer)) {
        if (!(info && info.title)) {
          this._lastLabelText = null;
          this._indicator._panelUI.stopScrolling();
          this._indicator._panelUI.label.hide();
          return;
        }
      }

      if (this._lastLabelText) {
        this._indicator._panelUI.startScrolling(
          this._lastLabelText,
          this._indicator._settings,
          "Paused",
        );
        this._indicator._panelUI.label.show();
        return;
      }

      this._indicator._panelUI.stopScrolling();
      this._indicator._panelUI.label.hide();
    } catch (e) {}
  }

  updateTabs() {
    if (
      this._indicator._state._isDestroyed ||
      !this._indicator._controls ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      const players = this._indicator._manager.getPlayers();
      this._indicator._controls.updateTabs(
        players,
        this._indicator._state._currentPlayer,
        this._indicator._manager,
      );
    } catch (e) {}
  }
}