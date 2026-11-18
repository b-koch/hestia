import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { parseBrowserSourceId, labelForId } from "./lib/utils.js";
import { buildGeneralPage } from "./ui/generalPage.js";
import { buildPopupPage } from "./ui/popupPage.js";
import { buildAppearancePage } from "./ui/appearancePage.js";
import { buildPlayerFilterPage } from "./ui/playerFilterPage.js";
import { buildLyricsPage } from "./ui/lyricsPage.js";
import { buildVinylAppsPage } from "./ui/vinylAppsPage.js";
import { buildImmersiveAppsPage } from "./ui/immersiveAppsPage.js";
import { createAboutPage } from "./ui/aboutPage.js";
import { buildProgressBarPage } from "./ui/themes/progressBarPage.js";
import { presentDialog } from "./ui/themes/helpers/widgets.js";

const BROWSER_IDS = new Set([
  "google-chrome",
  "google-chrome-stable",
  "google-chrome-beta",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "com.brave.Browser",
  "brave-browser-stable",
  "firefox",
  "org.mozilla.firefox",
  "firefox-esr",
  "microsoft-edge",
  "microsoft-edge-stable",
  "microsoft-edge-beta",
  "com.microsoft.Edge",
  "vivaldi-stable",
  "vivaldi",
  "opera",
  "opera-stable",
  "com.opera.Opera",
  "epiphany",
  "org.gnome.Epiphany",
  "midori",
  "falkon",
]);

const MEDIA_CATEGORIES = [
  "audio",
  "music",
  "video",
  "player",
  "multimedia",
  "media",
];

const GENERIC_TOKENS = [
  "org",
  "com",
  "net",
  "io",
  "app",
  "application",
  "browser",
  "client",
  "player",
  "media",
  "desktop",
  "instance",
  "snap",
  "flatpak",
];

const parseInstance = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const stripDesktop = (id) => id.replace(/\.desktop$/, "");

const sameBrowserSource = (idA, idB) => {
  const a = parseBrowserSourceId(idA);
  const b = parseBrowserSourceId(idB);
  return Boolean(
    a &&
    b &&
    a.source === b.source &&
    (a.browser === b.browser ||
      a.browser.includes(b.browser) ||
      b.browser.includes(a.browser)),
  );
};

const appImage = (gicon, size) =>
  new Gtk.Image({
    ...(gicon ? { gicon } : { icon_name: "media-optical-cd-audio-symbolic" }),
    pixel_size: size,
    valign: Gtk.Align.CENTER,
  });

const sectionLabel = (text, marginTop) =>
  new Gtk.Label({
    label: text,
    xalign: 0,
    css_classes: ["caption", "dim-label"],
    margin_top: marginTop,
    margin_bottom: 2,
    margin_start: 8,
  });

export default class MediaControlsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    window.set_title(_("Advanced Media Controller"));
    window.set_default_size(800, 760);
    window.set_resizable(true);

    window.add(buildGeneralPage(settings));
    window.add(buildPopupPage(settings));
    window.add(buildAppearancePage(settings));

    const vinylPage = new Adw.PreferencesPage({
      title: _("Vinyl Apps"),
      icon_name: "media-optical-cd-audio-symbolic",
    });
    window.add(vinylPage);

    // the page fills in the four widget fields itself
    this._vinylHelpers = {
      findAppInfo: this._findAppInfo.bind(this),
      normalizeAppId: this._normalizeAppId.bind(this),
      buildMatchSet: this._buildMatchSet.bind(this),
      isAppEnabled: this._isAppEnabled.bind(this),
      setAppVinylState: this._setAppVinylState.bind(this),
      updateInstanceEnabledField: this._updateInstanceEnabledField.bind(this),
      deleteInstance: this._deleteInstance.bind(this),
      loadMediaAndBrowserApps: this._loadMediaAndBrowserApps.bind(this),
      renderAppList: this._renderAppList.bind(this),
      refreshInstancesList: this._refreshInstancesList.bind(this),
      showRenameDialog: this._showRenameDialog.bind(this),

      instancesGroup: null,
      instanceRows: null,
      appListBox: null,
      allApps: null,
      currentSearchQuery: "",
    };
    buildVinylAppsPage(vinylPage, settings, this._vinylHelpers);

    const immersivePage = new Adw.PreferencesPage({
      title: _("Immersive"),
      icon_name: "view-fullscreen-symbolic",
    });
    window.add(immersivePage);
    buildImmersiveAppsPage(immersivePage, settings);

    const filterPage = new Adw.PreferencesPage({
      title: _("Player Filter"),
      icon_name: "view-list-symbolic",
    });
    window.add(filterPage);
    buildPlayerFilterPage(filterPage, settings, this._findAppInfo.bind(this));

    const lyricsPage = new Adw.PreferencesPage({
      title: _("Lyrics"),
      icon_name: "audio-x-generic-symbolic",
    });
    window.add(lyricsPage);
    buildLyricsPage(lyricsPage, settings);

    const progressPage = new Adw.PreferencesPage({
      title: _("Progress Bar"),
      icon_name: "media-seek-forward-symbolic",
    });
    window.add(progressPage);
    buildProgressBarPage(progressPage, settings, this.dir.get_path());

    window.add(createAboutPage(this.dir.get_path(), settings));
  }

  _refreshInstancesList(settings) {
    const { instancesGroup, instanceRows } = this._vinylHelpers;

    for (const row of instanceRows.values()) instancesGroup.remove(row);
    instanceRows.clear();

    const rawInstances = settings.get_strv("vinyl-app-instances");

    if (rawInstances.length === 0) {
      const placeholder = new Adw.ActionRow({
        title: _("No instances saved yet"),
        subtitle: _(
          "Double-click the album art in the popup while music is playing to save an instance here.",
        ),
        activatable: false,
      });
      const icon = appImage(null, 28);
      icon.opacity = 0.4;
      placeholder.add_prefix(icon);
      instanceRows.set("__placeholder__", placeholder);
      instancesGroup.add(placeholder);
      return;
    }

    const groups = new Map();
    for (const raw of rawInstances) {
      const obj = parseInstance(raw);
      if (!obj?.id) continue;

      const idLower = obj.id.toLowerCase();
      let appInfo = null;
      let key;

      if (idLower.includes("--")) {
        key = idLower;
      } else {
        appInfo = this._findAppInfo(obj.desktopId || obj.id, obj.id);
        key = appInfo
          ? stripDesktop(appInfo.get_id() ?? "").toLowerCase() || idLower
          : idLower.replace(/\.instance[_\d]+$/i, "").replace(/\.\d+$/, "");
      }

      const entry = { obj, appInfo };
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { best: entry, allIds: new Set([idLower]) });
        continue;
      }

      group.allIds.add(idLower);
      if (!group.best.obj.enabled && obj.enabled) group.best = entry;
    }

    const enabledIds = settings.get_strv("vinyl-app-ids");

    for (const { best, allIds } of groups.values()) {
      const { obj, appInfo } = best;
      const id = obj.id;
      const normId = id.toLowerCase();
      const composite = parseBrowserSourceId(normId);

      let appName = obj.name || obj.desktopId || id;
      let icon = null;

      if (composite) {
        appName = labelForId(normId);
        const browserId = obj.desktopId || composite.browser;
        icon = this._findAppInfo(browserId, browserId)?.get_icon() ?? null;
      } else if (appInfo) {
        appName = appInfo.get_display_name() || appInfo.get_name() || appName;
        icon = appInfo.get_icon();
      }

      const customName = obj.customName?.trim();
      const displayName = customName || appName;
      const baseSubtitle = composite
        ? _("%s via %s").format(
            composite.source.replace(/-/g, " "),
            composite.browser,
          )
        : id;

      const row = new Adw.ActionRow({
        title: displayName,
        subtitle: customName
          ? `${baseSubtitle}  \u00b7  ${_("renamed from")} "${appName}"`
          : baseSubtitle,
        activatable: false,
        use_markup: false,
      });
      row.add_prefix(appImage(icon, 28));

      const renameBtn = new Gtk.Button({
        icon_name: "document-edit-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["flat"],
        tooltip_text: _("Rename \u201c%s\u201d").format(displayName),
      });
      renameBtn.connect("clicked", () =>
        this._showRenameDialog(settings, id, normId, displayName, appName),
      );
      row.add_suffix(renameBtn);

      const toggle = new Gtk.Switch({
        active: [...allIds].some((aid) => this._isAppEnabled(aid, enabledIds)),
        valign: Gtk.Align.CENTER,
      });
      toggle.connect("state-set", (_widget, state) => {
        for (const aid of allIds) {
          this._setAppVinylState(settings, aid, aid, state);
          this._updateInstanceEnabledField(settings, aid, state);
        }
        return false;
      });
      row.add_suffix(toggle);

      const removeBtn = new Gtk.Button({
        icon_name: "list-remove-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["destructive-action", "flat"],
        tooltip_text: _("Remove %s from saved instances").format(appName),
      });
      removeBtn.connect("clicked", () => {
        for (const aid of allIds) this._deleteInstance(settings, aid, aid);
      });
      row.add_suffix(removeBtn);

      instancesGroup.add(row);
      instanceRows.set(id, row);
    }
  }

  _showRenameDialog(settings, id, normId, currentDisplay, resolvedName) {
    const source = normId.includes("--") ? labelForId(normId) : resolvedName;

    const entryRow = new Adw.EntryRow({
      title: _("Display name"),
      text:
        currentDisplay !== resolvedName && currentDisplay !== source
          ? currentDisplay
          : "",
      show_apply_button: true,
    });

    const list = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ["boxed-list"],
      margin_top: 12,
      margin_bottom: 4,
    });
    list.append(entryRow);

    const clamp = new Adw.Clamp({
      maximum_size: 480,
      tightening_threshold: 320,
    });
    clamp.set_child(list);

    const dialog = presentDialog(this._vinylHelpers.instancesGroup, {
      heading: _("Rename Instance"),
      body: _(
        'Enter a custom display name for "%s".\nLeave blank to reset to the default.',
      ).format(source),
      extraChild: clamp,
      responses: [
        ["cancel", _("Cancel")],
        ["rename", _("Rename"), Adw.ResponseAppearance.SUGGESTED],
      ],
      defaultResponse: "rename",
      closeResponse: "cancel",
      onResponse: (response) => {
        if (response === "rename")
          this._renameInstance(settings, normId, entryRow.text.trim());
      },
    });

    entryRow.connect("entry-activated", () => dialog.response("rename"));
    entryRow.connect("apply", () => dialog.response("rename"));

    const mapId = entryRow.connect("map", () => {
      entryRow.grab_focus();
      entryRow.disconnect(mapId);
    });
  }

  // rewrites every stored instance matching normId, edit() returns the new object or null to drop it
  _editInstances(settings, normId, edit) {
    const composite = normId.includes("--");
    const matches = (obj) => {
      const id = (obj.id ?? "").toLowerCase();
      return composite
        ? id === normId
        : id === normId || id.split(".").pop() === normId;
    };

    const updated = settings.get_strv("vinyl-app-instances").flatMap((raw) => {
      const obj = parseInstance(raw);
      if (!obj || !matches(obj)) return [raw];

      const next = edit(obj);
      return next ? [JSON.stringify(next)] : [];
    });
    settings.set_strv("vinyl-app-instances", updated);
  }

  _renameInstance(settings, normId, newName) {
    this._editInstances(settings, normId, ({ customName, ...rest }) =>
      newName ? { ...rest, customName: newName } : rest,
    );
  }

  _updateInstanceEnabledField(settings, normId, enabled) {
    this._editInstances(settings, normId, (obj) => ({ ...obj, enabled }));
  }

  _deleteInstance(settings, id, normId) {
    this._editInstances(settings, normId, () => null);
    this._setAppVinylState(settings, id, normId, false);
  }

  _loadMediaAndBrowserApps() {
    const seen = new Set();

    const apps = Gio.AppInfo.get_all().filter((app) => {
      if (!app.should_show()) return false;

      const rawId = app.get_id() || "";
      const normId = this._normalizeAppId(rawId).toLowerCase();
      if (seen.has(normId)) return false;

      const categories = (app.get_categories() || "").toLowerCase();
      const isMedia = MEDIA_CATEGORIES.some((c) => categories.includes(c));
      const isBrowser =
        BROWSER_IDS.has(normId) || BROWSER_IDS.has(stripDesktop(rawId));
      if (!isMedia && !isBrowser) return false;

      seen.add(normId);
      return true;
    });

    return apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
  }

  _buildMatchSet(appId) {
    const lower = appId.toLowerCase();
    const ids = new Set([lower]);

    if (!lower.includes("--")) {
      const parts = lower.split(".");
      if (parts.length > 1) ids.add(parts[parts.length - 1]);
    }
    return ids;
  }

  _isAppEnabled(normId, vinylIds) {
    const composite = normId.includes("--");

    return vinylIds.some((stored) => {
      const storedLower = stored.toLowerCase();
      const matchSet = this._buildMatchSet(stored);

      if (matchSet.has(normId)) return true;
      if (!composite) return matchSet.has(normId.split(".").pop());

      return (
        storedLower === normId ||
        (storedLower.includes("--") && sameBrowserSource(normId, storedLower))
      );
    });
  }

  _setAppVinylState(settings, appId, normId, enable) {
    const enabledIds = settings.get_strv("vinyl-app-ids");
    const disabledIds = settings.get_strv("vinyl-app-disabled-ids");
    const composite = normId.includes("--");

    const sameApp = (id) => {
      const lower = id.toLowerCase();
      if (lower === normId) return true;
      if (composite)
        return lower.includes("--") && sameBrowserSource(normId, lower);

      const matchSet = this._buildMatchSet(id);
      return matchSet.has(normId) || matchSet.has(normId.split(".").pop());
    };

    const [add, remove, addKey, removeKey] = enable
      ? [enabledIds, disabledIds, "vinyl-app-ids", "vinyl-app-disabled-ids"]
      : [disabledIds, enabledIds, "vinyl-app-disabled-ids", "vinyl-app-ids"];

    if (!this._isAppEnabled(normId, add)) add.push(appId);

    settings.set_strv(addKey, add);
    settings.set_strv(
      removeKey,
      remove.filter((id) => !sameApp(id)),
    );
  }

  _renderAppList(systemApps, settings) {
    const { appListBox, currentSearchQuery } = this._vinylHelpers;
    const query = currentSearchQuery ?? "";

    for (let child = appListBox.get_first_child(); child;) {
      const next = child.get_next_sibling();
      appListBox.remove(child);
      child = next;
    }

    const enabledIds = settings.get_strv("vinyl-app-ids");
    const shown = new Set();
    const instances = [];

    for (const raw of settings.get_strv("vinyl-app-instances")) {
      const obj = parseInstance(raw);
      if (!obj?.id) continue;

      const id = obj.id;
      const normId = id.toLowerCase();
      if (shown.has(normId)) continue;

      const desktopId = obj.desktopId || id;
      const composite = parseBrowserSourceId(normId);

      let resolvedName = obj.name || desktopId;
      let icon = null;

      if (composite) {
        resolvedName = labelForId(normId);
        const browserId = obj.desktopId || composite.browser;
        icon = this._findAppInfo(browserId, browserId)?.get_icon() ?? null;
      } else {
        const appInfo = this._findAppInfo(desktopId, id);
        if (appInfo) {
          resolvedName =
            appInfo.get_display_name() || appInfo.get_name() || resolvedName;
          icon = appInfo.get_icon();
        }
      }

      const customName = obj.customName?.trim() || "";
      const displayName = customName || resolvedName;
      const extraText = composite
        ? `${composite.source} ${composite.browser} ${obj.mprisIdentity ?? ""}`
        : "";

      const matchesQuery =
        !query ||
        [displayName, resolvedName, normId, extraText].some((text) =>
          text.toLowerCase().includes(query),
        );
      if (!matchesQuery) continue;

      shown.add(normId);
      instances.push({
        id,
        normId,
        displayName,
        resolvedName,
        icon,
        customName,
        composite,
      });
    }

    for (const [index, item] of instances.entries()) {
      if (index === 0) appListBox.append(sectionLabel(_("Saved Instances"), 8));

      const {
        id,
        normId,
        displayName,
        resolvedName,
        icon,
        customName,
        composite,
      } = item;
      const baseSubtitle = composite
        ? _("Browser: %s \u00b7 Source: %s").format(
            composite.browser,
            composite.source.replace(/-/g, " "),
          )
        : id;

      const row = new Adw.ActionRow({
        title: displayName,
        subtitle: customName
          ? `${baseSubtitle}  \u00b7  ${_("renamed from")} "${resolvedName}"`
          : baseSubtitle,
        activatable: false,
        use_markup: false,
      });
      row.add_prefix(appImage(icon, 24));

      const toggle = new Gtk.Switch({
        active: this._isAppEnabled(normId, enabledIds),
        valign: Gtk.Align.CENTER,
      });
      toggle.connect("state-set", (_widget, state) => {
        this._setAppVinylState(settings, id, normId, state);
        this._updateInstanceEnabledField(settings, normId, state);
        return false;
      });
      row.add_suffix(toggle);
      appListBox.append(row);
    }

    const others = systemApps.filter((app) => {
      const normId =
        this._normalizeAppId(app.get_id() || "")?.toLowerCase() ?? "";
      return !shown.has(normId);
    });

    if (others.length > 0 && instances.length > 0)
      appListBox.append(sectionLabel(_("Other Apps"), 10));

    for (const app of others) {
      const appId = this._normalizeAppId(app.get_id());
      if (!appId) continue;

      const normId = appId.toLowerCase();
      const row = new Adw.ActionRow({
        title: app.get_name(),
        subtitle: appId,
        activatable: false,
        use_markup: false,
      });

      const icon = app.get_icon();
      if (icon) row.add_prefix(appImage(icon, 24));

      const toggle = new Gtk.Switch({
        active: this._isAppEnabled(normId, enabledIds),
        valign: Gtk.Align.CENTER,
      });
      toggle.connect("state-set", (_widget, state) => {
        if (state) this._saveSystemAppInstance(settings, app, appId, normId);
        else this._updateInstanceEnabledField(settings, normId, false);

        this._setAppVinylState(settings, appId, normId, state);
        return false;
      });
      row.add_suffix(toggle);
      appListBox.append(row);
    }

    if (instances.length === 0 && others.length === 0) {
      appListBox.append(
        new Gtk.Label({
          label: _("No matching apps found"),
          css_classes: ["dim-label"],
          margin_top: 16,
          margin_bottom: 16,
        }),
      );
    }
  }

  _saveSystemAppInstance(settings, app, appId, normId) {
    const others = settings
      .get_strv("vinyl-app-instances")
      .filter((raw) => parseInstance(raw)?.id?.toLowerCase() !== normId);

    others.push(
      JSON.stringify({
        id: appId,
        name: app.get_name(),
        desktopId: appId,
        busName: "",
        enabled: true,
      }),
    );
    settings.set_strv("vinyl-app-instances", others);
  }

  // desktopId is the stored desktopId, fallbackId the stored id
  _findAppInfo(desktopId, fallbackId) {
    const tokens = new Set();
    for (const base of [desktopId, fallbackId]) {
      if (!base) continue;

      const stripped = base
        .replace(/\.instance[_\d]+$/i, "")
        .replace(/\.\d+$/, "");
      for (const variant of [base, stripped]) {
        const lower = variant.toLowerCase();
        tokens.add(lower);
        tokens.add(`${lower}.desktop`);
        lower
          .split(".")
          .filter((seg) => seg.length > 2)
          .forEach((seg) => tokens.add(seg));
      }
    }
    GENERIC_TOKENS.forEach((token) => tokens.delete(token));

    const apps = Gio.AppInfo.get_all();
    const cleanId = (app) => stripDesktop((app.get_id() ?? "").toLowerCase());

    const byId = apps.find((app) => tokens.has(cleanId(app)));
    if (byId) return byId;

    const bySegment = apps.find((app) =>
      cleanId(app)
        .split(".")
        .some((seg) => seg.length > 2 && tokens.has(seg)),
    );
    if (bySegment) return bySegment;

    return (
      apps.find((app) => {
        const name = (app.get_display_name() ?? "").toLowerCase();
        const firstWord = name.split(/\s+/)[0];
        return (
          tokens.has(name.replace(/\s+/g, "")) ||
          (firstWord.length > 2 && tokens.has(firstWord))
        );
      }) ?? null
    );
  }

  _normalizeAppId(id) {
    return id ? stripDesktop(id) : null;
  }
}
