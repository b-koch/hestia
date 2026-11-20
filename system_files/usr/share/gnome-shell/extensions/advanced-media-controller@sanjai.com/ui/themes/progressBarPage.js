import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { ThemeEngine } from "../../utils/core/ThemeEngine.js";
import { makeSettingsHelpers } from "./helpers/settingsHelpers.js";
import { openUri } from "./helpers/widgets.js";
import { USER_THEMES_DIR } from "./constants.js";
import { buildPreview } from "./tools/previewSection.js";
import { buildThemeGroup } from "./tools/themeSection.js";
import { buildGifGroup } from "./tools/gifSection.js";
import { buildColorGroup } from "./tools/colorSection.js";

const LINK_IMAGE = "icons/banner.png";
const LINK_URL = "https://codeberg.org/sanjai-shaarugesh/Demons-slayer-themes";

export function buildProgressBarPage(page, settings, extensionDir) {
  GLib.mkdir_with_parents(USER_THEMES_DIR, 0o755);

  const cleanups = [];

  // built-in themes look Gdk up here when drawing pixbufs
  globalThis._themeGdk = { Gdk };
  cleanups.push(() => {
    delete globalThis._themeGdk;
  });

  const {
    _sc,
    getCurrentThemeId,
    getCurrentGifPath,
    getCurrentColor,
    getUseSystemColor,
    getUseNativeSlider,
  } = makeSettingsHelpers(settings, cleanups);

  const themeEngine = new ThemeEngine(extensionDir);
  themeEngine.setActiveTheme(getCurrentThemeId());

  const {
    previewArea,
    setPreviewRatio,
    setPreviewGif,
    getPreviewGifPixbuf,
  } = buildPreview(
    themeEngine,
    getUseNativeSlider,
    getCurrentColor,
    getUseSystemColor,
    cleanups,
  );
  setPreviewGif(getCurrentGifPath());

  const previewGroup = new Adw.PreferencesGroup({
    title: _("Preview"),
    description: _("Drag the slider to preview any playback position"),
  });
  page.add(previewGroup);
  settings.bind(
    "progress-use-native-slider",
    previewGroup,
    "visible",
    Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN,
  );

  const previewSlider = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: new Gtk.Adjustment({ lower: 0, upper: 1, value: 0.48 }),
    draw_value: false,
    hexpand: true,
  });
  previewSlider.connect("value-changed", () =>
    setPreviewRatio(previewSlider.get_value()),
  );

  const previewBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    margin_top: 10,
    margin_bottom: 4,
  });
  previewBox.append(previewArea);
  previewBox.append(previewSlider);

  const previewRow = new Adw.ActionRow({ activatable: false });
  previewRow.set_child(previewBox);
  previewGroup.add(previewRow);

  const sliderGroup = new Adw.PreferencesGroup({
    title: _("Slider Style"),
    description: _(
      "Switch between the themed Cairo renderer and the native GTK slider",
    ),
  });
  page.add(sliderGroup);

  const nativeRow = new Adw.ActionRow({
    title: _("Use Native GTK Slider"),
    subtitle: _(
      "Follows your system theme colour automatically; disables custom themes",
    ),
  });
  const nativeSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
  settings.bind(
    "progress-use-native-slider",
    nativeSwitch,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  _sc("changed::progress-use-native-slider", () => previewArea.queue_draw());
  nativeRow.add_suffix(nativeSwitch);
  sliderGroup.add(nativeRow);

  const applyThemeThumb = (theme) => {
    if (!theme.thumbFile) return;

    settings.set_string("progress-gif-path", theme.thumbFile);
    settings.set_boolean("progress-gif-enabled", true);
  };

  buildThemeGroup(
    page,
    settings,
    themeEngine,
    previewArea,
    applyThemeThumb,
    getCurrentThemeId,
    cleanups,
    extensionDir,
  );

  buildGifGroup(
    page,
    settings,
    themeEngine,
    previewArea,
    getPreviewGifPixbuf,
    setPreviewGif,
    getCurrentGifPath,
    extensionDir,
    cleanups,
  );

  buildColorGroup(
    page,
    settings,
    previewArea,
    getCurrentColor,
    getUseSystemColor,
    cleanups,
  );

  const resetGroup = new Adw.PreferencesGroup({ title: _("Reset") });
  page.add(resetGroup);

  const resetRow = new Adw.ActionRow({
    title: _("Reset to Defaults"),
    subtitle: _(
      "Revert to Default theme, disable animated thumb, restore GNOME Blue or you're system accent color",
    ),
    activatable: true,
  });
  resetRow.add_prefix(
    new Gtk.Image({
      icon_name: "edit-clear-symbolic",
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
    }),
  );
  resetRow.connect("activated", () => {
    settings.set_string("progress-theme-id", "default");
    settings.set_boolean("progress-gif-enabled", false);
    settings.set_string("progress-gif-path", "");
    settings.set_string("progress-bar-color", "#3584e4");
    settings.set_boolean("progress-bar-use-system-color", false);
    settings.set_boolean("progress-use-native-slider", false);
    themeEngine.setActiveTheme("default");
    previewArea.queue_draw();
  });
  resetGroup.add(resetRow);

  const openLink = () => openUri(LINK_URL);

  const linkGroup = new Adw.PreferencesGroup({
    title: _("Demons Slayer Themes"),
    description: _("You can get Demons Slayer themes from here"),
  });
  page.add(linkGroup);

  const linkBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
  });
  linkGroup.add(linkBox);

  const imagePath = `${extensionDir}/${LINK_IMAGE}`;
  const linkImage = Gio.File.new_for_path(imagePath).query_exists(null)
    ? Gtk.Picture.new_for_filename(imagePath)
    : new Gtk.Image({ icon_name: "web-browser-symbolic", pixel_size: 96 });
  if (linkImage instanceof Gtk.Picture) {
    linkImage.content_fit = Gtk.ContentFit.COVER;
    linkImage.can_shrink = true;
    linkImage.height_request = 180;
    linkImage.hexpand = true;
  }

  const imageCard = new Gtk.Box({
    css_classes: ["card"],
    overflow: Gtk.Overflow.HIDDEN,
    tooltip_text: LINK_URL,
    cursor: Gdk.Cursor.new_from_name("pointer", null),
  });
  imageCard.append(linkImage);
  const click = new Gtk.GestureClick();
  click.connect("released", openLink);
  imageCard.add_controller(click);
  linkBox.append(imageCard);

  const urlList = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    css_classes: ["boxed-list"],
  });
  const urlRow = new Adw.ActionRow({
    title: LINK_URL,
    activatable: true,
  });
  urlRow.add_suffix(
    new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }),
  );
  urlRow.connect("activated", openLink);
  urlList.append(urlRow);
  linkBox.append(urlList);

  page.connect("destroy", () => {
    cleanups.forEach((fn) => fn());
    themeEngine.destroy();
  });
}