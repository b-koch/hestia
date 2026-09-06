import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GdkPixbuf from "gi://GdkPixbuf";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

function _imageFromFile(path, size) {
  try {
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
      path,
      size,
      size,
      true,
    );
    return Gtk.Image.new_from_pixbuf(pixbuf);
  } catch (_e) {
    return new Gtk.Image({
      icon_name: "emblem-favorite-symbolic",
      pixel_size: size,
    });
  }
}

function _createKofiIcon(extensionDirPath, size = 20) {
  const path = `${extensionDirPath}/icons/kofi_symbol.webp`;
  if (Gio.File.new_for_path(path).query_exists(null))
    return _imageFromFile(path, size);
  return new Gtk.Image({
    icon_name: "emblem-favorite-symbolic",
    pixel_size: size,
  });
}

function _createLiberapayIcon(extensionDirPath, size = 20) {
  for (const name of ["liberapay.svg", "liberapay_logo_black-on-yellow.svg"]) {
    const path = `${extensionDirPath}/icons/${name}`;
    if (Gio.File.new_for_path(path).query_exists(null))
      return _imageFromFile(path, size);
  }
  return new Gtk.Image({
    icon_name: "emblem-favorite-symbolic",
    pixel_size: size,
  });
}

function _createBmcIcon(extensionDirPath, size = 20) {
  for (const name of [
    "bmc_icon.png",
    "buymeacoffee.png",
    "bmc.png",
    "bmc.svg",
  ]) {
    const path = `${extensionDirPath}/icons/${name}`;
    if (Gio.File.new_for_path(path).query_exists(null))
      return _imageFromFile(path, size);
  }
  return new Gtk.Image({
    icon_name: "emblem-favorite-symbolic",
    pixel_size: size,
  });
}

function _createcodebergIcon(extensionDirPath, size = 20) {
  const path = `${extensionDirPath}/icons/codeberg.svg`;
  if (Gio.File.new_for_path(path).query_exists(null))
    return _imageFromFile(path, size);
  return new Gtk.Image({
    icon_name: "adw-external-link-symbolic",
    pixel_size: size,
  });
}

/**
 * @param {string} extensionDirPath
 * @param {Gio.Settings} settings
 * @returns {Adw.PreferencesPage}
 */
export function createAboutPage(extensionDirPath, settings) {
  const page = new Adw.PreferencesPage({
    title: _("About"),
    icon_name: "help-about-symbolic",
  });

  const _signalIds = [];
  const _trackConnect = (obj, signal, fn) => {
    _signalIds.push({ obj, id: obj.connect(signal, fn) });
  };

  const resetGroup = new Adw.PreferencesGroup({
    title: _("Danger Zone"),
    description: _("Reset extension settings to their default values"),
  });

  const resetRow = new Adw.ActionRow({
    title: _("Reset All Settings"),
    subtitle: _("This action cannot be undone"),
    activatable: false,
  });

  const resetBtn = new Gtk.Button({
    icon_name: "edit-clear-all-symbolic",
    valign: Gtk.Align.CENTER,
    css_classes: ["destructive-action"],
    label: _("Reset"),
  });

  _trackConnect(resetBtn, "clicked", () => {
    const dialog = new Adw.AlertDialog({
      heading: _("Reset Settings?"),
      body: _(
        "Are you sure you want to restore all settings to their default values?",
      ),
      default_response: "cancel",
      close_response: "cancel",
    });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("reset", _("Reset"));
    dialog.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect("response", (_, responseId) => {
      if (responseId === "reset" && settings) {
        const keys = settings.settings_schema.list_keys();
        keys.forEach((k) => settings.reset(k));
      }
    });
    const parent = resetBtn.get_root();
    if (parent instanceof Gtk.Window) dialog.present(parent);
  });

  resetRow.add_suffix(resetBtn);
  resetGroup.add(resetRow);

  const infoGroup = new Adw.PreferencesGroup({
    title: _("Advanced Media Controller"),
    description: _(
      "Beautiful and modern media controls with multi-instance support",
    ),
  });

  const headerBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 20,
    margin_top: 20,
    margin_bottom: 20,
    halign: Gtk.Align.CENTER,
  });

  const logoPath = `${extensionDirPath}/icons/media-logo.png`;
  let logoImage;
  try {
    logoImage = Gtk.Image.new_from_file(logoPath);
    logoImage.set_pixel_size(72);
  } catch (_e) {
    logoImage = new Gtk.Image({
      icon_name: "multimedia-player-symbolic",
      pixel_size: 72,
    });
  }

  const infoBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    valign: Gtk.Align.CENTER,
  });
  infoBox.append(
    new Gtk.Label({
      label: _("Advanced Media Controller"),
      halign: Gtk.Align.START,
      css_classes: ["title-2"],
    }),
  );
  infoBox.append(
    new Gtk.Label({
      label: _("Version 6.5"),
      halign: Gtk.Align.START,
      css_classes: ["caption"],
    }),
  );
  infoBox.append(
    new Gtk.Label({
      label: _("Modern media controls with native GNOME design"),
      halign: Gtk.Align.START,
      wrap: true,
      max_width_chars: 40,
      css_classes: ["body"],
    }),
  );

  headerBox.append(logoImage);
  headerBox.append(infoBox);
  const headerRow = new Adw.ActionRow({ title: "", activatable: false });
  headerRow.add_suffix(headerBox);

  const linksGroup = new Adw.PreferencesGroup({
    title: _("Extension Links"),
    description: _("Source code, issues, and contributions"),
  });

  const codebergRow = new Adw.ActionRow({
    title: _("View on codeberg"),
    subtitle: _("Source code, issues, and contributions"),
    activatable: true,
  });
  codebergRow.add_prefix(_createcodebergIcon(extensionDirPath));
  codebergRow.add_suffix(
    new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }),
  );
  _trackConnect(codebergRow, "activated", () => {
    try {
      Gio.AppInfo.launch_default_for_uri(
        "https://codeberg.org/sanjai-shaarugesh/Advanced-media-controller",
        null,
      );
    } catch (e) {}
  });

  const DONATION_OPTIONS = [
    {
      label: _("Ko-fi"),
      subtitle: _("Support development with Ko-fi"),
      url: "https://ko-fi.com/sanjai_shaarugesh",
      qrFile: "qr-kofi.png",
      createIcon: (size = 20) => _createKofiIcon(extensionDirPath, size),
      qrTitle: _("\u2615 Support via Ko-fi \u2013 scan the QR code!"),
      qrDesc: _("Scan QR code to open Ko-fi"),
    },
    {
      label: _("Liberapay"),
      subtitle: _("Support via Liberapay \u2014 recurring donations"),
      url: "https://liberapay.com/sanjai/",
      qrFile: "qr-liberapay.png",
      createIcon: (size = 20) => _createLiberapayIcon(extensionDirPath, size),
      qrTitle: _("\u2665 Support via Liberapay \u2013 scan the QR code!"),
      qrDesc: _("Scan QR code to open Liberapay"),
    },
    {
      label: _("Buy Me a Coffee"),
      subtitle: _("Support development with a small donation"),
      url: "https://buymeacoffee.com/sanjai",
      qrFile: "bmc_qr.png",
      createIcon: (size = 20) => _createBmcIcon(extensionDirPath, size),
      qrTitle: _("\u2615 Support via Buy Me a Coffee \u2013 scan the QR code!"),
      qrDesc: _("Scan QR code to open Buy Me a Coffee"),
    },
  ];

  const qrGroup = new Adw.PreferencesGroup({
    title: DONATION_OPTIONS[0].qrTitle,
    description: DONATION_OPTIONS[0].qrDesc,
  });

  const qrPlatformModel = new Gtk.StringList();
  DONATION_OPTIONS.forEach((opt) => qrPlatformModel.append(opt.label));

  const qrIconWrapper = new Gtk.Box({
    valign: Gtk.Align.CENTER,
    width_request: 20,
    height_request: 20,
  });
  qrIconWrapper.append(DONATION_OPTIONS[0].createIcon(20));

  const qrPlatformRow = new Adw.ComboRow({
    title: _("Donation Platform"),
    subtitle: _("Switch to see the QR code for each platform"),
    model: qrPlatformModel,
    selected: 0,
  });
  qrPlatformRow.add_prefix(qrIconWrapper);
  qrGroup.add(qrPlatformRow);

  const qrContainer = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 16,
    halign: Gtk.Align.CENTER,
    margin_top: 24,
    margin_bottom: 24,
    margin_start: 24,
    margin_end: 24,
  });

  const loadQr = (filename) => {
    const path = `${extensionDirPath}/icons/${filename}`;
    try {
      const img = Gtk.Image.new_from_file(path);
      img.set_pixel_size(200);
      return img;
    } catch (_e) {
      return new Gtk.Image({
        icon_name: "camera-web-symbolic",
        pixel_size: 200,
      });
    }
  };

  let qrImage = loadQr(DONATION_OPTIONS[0].qrFile);
  qrContainer.append(qrImage);

  const qrRow = new Adw.ActionRow({ title: "", activatable: false });
  qrRow.set_child(qrContainer);

  const addressGroup = new Adw.PreferencesGroup({
    title: _("Donation Address"),
  });

  const addressRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[0].url,
    activatable: true,
  });
  addressRow.add_prefix(
    new Gtk.Image({ icon_name: "emote-love-symbolic", pixel_size: 16 }),
  );
  addressRow.add_suffix(
    new Gtk.Image({ icon_name: "edit-copy-symbolic", pixel_size: 16 }),
  );
  _trackConnect(addressRow, "activated", () =>
    _copyToClipboard(addressRow.title, _("Donation address")),
  );

  let activeDonation = 0;

  const switchDonation = (idx) => {
    if (idx === activeDonation) return;
    activeDonation = idx;
    const opt = DONATION_OPTIONS[idx];

    qrContainer.remove(qrImage);
    qrImage = loadQr(opt.qrFile);
    qrContainer.append(qrImage);

    let child = qrIconWrapper.get_first_child();
    while (child) {
      qrIconWrapper.remove(child);
      child = qrIconWrapper.get_first_child();
    }
    qrIconWrapper.append(opt.createIcon(20));

    qrGroup.title = opt.qrTitle;
    qrGroup.description = opt.qrDesc;
    addressRow.title = opt.url;

    if (qrPlatformRow.selected !== idx) qrPlatformRow.selected = idx;
  };

  _trackConnect(qrPlatformRow, "notify::selected", () => {
    switchDonation(qrPlatformRow.selected);
  });

  const donationSelectorGroup = new Adw.PreferencesGroup({
    title: _("Support Development"),
    description: _("Choose your preferred donation platform"),
  });

  const kofiRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[0].label,
    subtitle: DONATION_OPTIONS[0].subtitle,
    activatable: true,
  });
  kofiRow.add_prefix(DONATION_OPTIONS[0].createIcon(20));
  kofiRow.add_suffix(
    new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }),
  );
  _trackConnect(kofiRow, "activated", () => {
    switchDonation(0);
    try {
      Gio.AppInfo.launch_default_for_uri(DONATION_OPTIONS[0].url, null);
    } catch (e) {}
  });

  const liberapayRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[1].label,
    subtitle: DONATION_OPTIONS[1].subtitle,
    activatable: true,
  });
  liberapayRow.add_prefix(DONATION_OPTIONS[1].createIcon(20));
  liberapayRow.add_suffix(
    new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }),
  );
  _trackConnect(liberapayRow, "activated", () => {
    switchDonation(1);
    try {
      Gio.AppInfo.launch_default_for_uri(DONATION_OPTIONS[1].url, null);
    } catch (e) {}
  });

  const buymeacoffeeRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[2].label,
    subtitle: DONATION_OPTIONS[2].subtitle,
    activatable: true,
  });
  buymeacoffeeRow.add_prefix(DONATION_OPTIONS[2].createIcon(20));
  buymeacoffeeRow.add_suffix(
    new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }),
  );
  _trackConnect(buymeacoffeeRow, "activated", () => {
    switchDonation(2);
    try {
      Gio.AppInfo.launch_default_for_uri(DONATION_OPTIONS[2].url, null);
    } catch (e) {}
  });

  const licenseGroup = new Adw.PreferencesGroup({
    title: _("License & Credits"),
    description: _("Open source software information"),
  });
  const licenseRow = new Adw.ActionRow({
    title: _("Open Source License"),
    subtitle: _("GPL-3.0 License - Free and open source software"),
    activatable: false,
  });
  licenseRow.add_prefix(
    new Gtk.Image({ icon_name: "security-high-symbolic", pixel_size: 16 }),
  );
  const creditsRow = new Adw.ActionRow({
    title: _("Media Data Sources"),
    subtitle: _(
      "MPRIS D-Bus interface - Standard media player remote interfacing",
    ),
    activatable: false,
  });
  creditsRow.add_prefix(
    new Gtk.Image({ icon_name: "network-server-symbolic", pixel_size: 16 }),
  );
  const featuresRow = new Adw.ActionRow({
    title: _("Key Features"),
    subtitle: _(
      "\u2022 Multi-instance browser support\n\u2022 Per-app rotating vinyl record album art\n" +
        "\u2022 Animated tonearm\n\u2022 Smooth animations\n\u2022 Double-click to toggle vinyl per app\n" +
        "\u2022 Triple-click album art to show synced lyrics\n" +
        "\u2022 Single-click lyrics panel to return to album art\n" +
        "\u2022 Lyrics synced to playback via lrclib.net\n" +
        "\u2022 Per-player lyrics toggle (each tab independent)\n" +
        "\u2022 All seen apps remembered \u2014 re-enable any time",
    ),
    activatable: false,
  });
  featuresRow.add_prefix(
    new Gtk.Image({ icon_name: "starred-symbolic", pixel_size: 16 }),
  );

  infoGroup.add(headerRow);
  linksGroup.add(codebergRow);
  donationSelectorGroup.add(kofiRow);
  donationSelectorGroup.add(liberapayRow);
  donationSelectorGroup.add(buymeacoffeeRow);
  qrGroup.add(qrRow);
  addressGroup.add(addressRow);
  licenseGroup.add(licenseRow);
  licenseGroup.add(creditsRow);
  licenseGroup.add(featuresRow);

  page.add(infoGroup);
  page.add(linksGroup);
  page.add(donationSelectorGroup);
  page.add(qrGroup);
  page.add(addressGroup);
  page.add(licenseGroup);
  page.add(resetGroup);

  page.connect("destroy", () => {
    for (const { obj, id } of _signalIds) {
      try {
        obj.disconnect(id);
      } catch (_) {}
    }
    _signalIds.length = 0;
  });

  return page;
}

function _copyToClipboard(text, _label) {
  Gdk.Display.get_default().get_clipboard().set(text);
}