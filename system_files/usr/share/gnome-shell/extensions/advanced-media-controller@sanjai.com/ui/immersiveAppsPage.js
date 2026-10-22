import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { parseBrowserSourceId, labelForId } from "../lib/utils.js";

const MEDIA_CATEGORIES = ["audio", "music", "video", "player", "multimedia"];
const BROWSER_IDS = [
  "firefox",
  "org.mozilla.firefox",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "com.brave.Browser",
  "microsoft-edge",
  "vivaldi-stable",
  "opera",
  "epiphany",
  "org.gnome.Epiphany",
];

const DEFAULT = 0;
const ON = 1;
const OFF = 2;

const appKey = (app) =>
  (app.get_id() ?? "").replace(/\.desktop$/, "").toLowerCase();

const sameApp = (stored, id) => {
  const a = stored.toLowerCase();
  if (a === id) return true;
  if (a.includes("--") || id.includes("--")) return false;
  return a.split(".").pop() === id.split(".").pop();
};

const inList = (list, id) => list.some((x) => sameApp(x, id));
const without = (list, id) => list.filter((x) => !sameApp(x, id));

/**
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} settings
 */
export function buildImmersiveAppsPage(page, settings) {
  const connIds = [];
  page.connect("destroy", () => {
    for (const id of connIds) settings.disconnect(id);
    connIds.length = 0;
  });

  const introGroup = new Adw.PreferencesGroup({
    title: _("Per-App Immersive Cover"),
    description: _(
      "Force the immersive cover on or off for a single app. Apps left on " +
        "Default follow the global switch in Popup Player. Changes made by " +
        "clicking the album art in the popup show up here too.",
    ),
  });
  page.add(introGroup);

  const searchEntry = new Gtk.SearchEntry({
    placeholder_text: _("Type an app or browser name\u2026"),
    hexpand: true,
    valign: Gtk.Align.CENTER,
  });
  const searchRow = new Adw.ActionRow({
    title: _("Search apps"),
    activatable: false,
  });
  searchRow.add_suffix(searchEntry);
  introGroup.add(searchRow);

  const listGroup = new Adw.PreferencesGroup();
  page.add(listGroup);

  const seen = new Set();
  const apps = Gio.AppInfo.get_all()
    .filter((app) => {
      const id = appKey(app);
      if (!id || seen.has(id) || !app.should_show()) return false;
      const cats = (app.get_categories() ?? "").toLowerCase();
      const ok =
        MEDIA_CATEGORIES.some((c) => cats.includes(c)) ||
        BROWSER_IDS.some((b) => b.toLowerCase() === id);
      if (ok) seen.add(id);
      return ok;
    })
    .sort((a, b) => a.get_name().localeCompare(b.get_name()));

  const stateOf = (id) => {
    if (inList(settings.get_strv("immersive-app-disabled-ids"), id)) return OFF;
    if (inList(settings.get_strv("immersive-app-ids"), id)) return ON;
    return DEFAULT;
  };

  let busy = false;
  let rows = [];
  let orphanKey = "";

  const orphanIds = () => {
    const known = apps.map(appKey);
    const stored = [
      ...settings.get_strv("immersive-app-ids"),
      ...settings.get_strv("immersive-app-disabled-ids"),
    ].map((id) => id.toLowerCase());
    return [...new Set(stored)].filter(
      (id) => !known.some((k) => sameApp(k, id)),
    );
  };

  const writeState = (id, selected) => {
    const on = without(settings.get_strv("immersive-app-ids"), id);
    const off = without(settings.get_strv("immersive-app-disabled-ids"), id);
    if (selected === ON) on.push(id);
    else if (selected === OFF) off.push(id);

    busy = true;
    settings.set_strv("immersive-app-ids", on);
    settings.set_strv("immersive-app-disabled-ids", off);
    busy = false;
  };

  const addRow = ({ id, title, subtitle, gicon }) => {
    const row = new Adw.ComboRow({
      title,
      subtitle,
      model: Gtk.StringList.new([_("Default"), _("On"), _("Off")]),
      selected: stateOf(id),
    });
    row.add_prefix(
      new Gtk.Image({
        ...(gicon
          ? { gicon }
          : { icon_name: "application-x-executable-symbolic" }),
        pixel_size: 24,
        valign: Gtk.Align.CENTER,
      }),
    );
    row.connect("notify::selected", () => {
      if (busy) return;
      writeState(id, row.selected);
    });
    listGroup.add(row);
    rows.push({ id, row });
  };

  const render = () => {
    for (const { row } of rows) listGroup.remove(row);
    rows = [];

    const query = searchEntry.text.toLowerCase().trim();
    const hit = (...texts) =>
      !query || texts.some((t) => t.toLowerCase().includes(query));

    for (const app of apps) {
      const id = appKey(app);
      if (!hit(app.get_name(), id)) continue;
      addRow({
        id,
        title: app.get_name(),
        subtitle: id,
        gicon: app.get_icon(),
      });
    }

    orphanKey = orphanIds().join("|");
    for (const id of orphanIds()) {
      const source = parseBrowserSourceId(id);
      const title = source ? labelForId(id) : id;
      if (!hit(title, id)) continue;
      addRow({ id, title, subtitle: id, gicon: null });
    }

    if (rows.length === 0) {
      const empty = new Adw.ActionRow({
        title: _("No matching apps found"),
        activatable: false,
      });
      listGroup.add(empty);
      rows.push({ id: null, row: empty });
    }
  };

  const sync = () => {
    if (busy) return;
    if (orphanIds().join("|") !== orphanKey) {
      render();
      return;
    }
    busy = true;
    for (const { id, row } of rows) {
      if (id !== null && row.selected !== stateOf(id))
        row.selected = stateOf(id);
    }
    busy = false;
  };

  for (const key of ["immersive-app-ids", "immersive-app-disabled-ids"])
    connIds.push(settings.connect(`changed::${key}`, sync));

  searchEntry.connect("search-changed", render);
  render();
}
