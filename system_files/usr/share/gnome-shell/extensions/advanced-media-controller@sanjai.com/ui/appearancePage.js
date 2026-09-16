import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import PangoCairo from "gi://PangoCairo";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

function _getSystemFontFamilies() {
    const fontMap = PangoCairo.FontMap.get_default();
    return fontMap
        .list_families()
        .map((f) => f.get_name())
        .sort((a, b) => a.localeCompare(b));
}

function _getDefaultFontFamily() {
    try {
        const gtkSettings = Gtk.Settings.get_default();
        if (gtkSettings) {
            const fontName = gtkSettings.gtk_font_name;
            if (fontName) {
                const desc = Pango.FontDescription.from_string(fontName);
                const family = desc.get_family();
                if (family) return family;
            }
        }
    } catch (_e) {}
    return "Sans";
}

function _makeColorRow(opts) {
    const { title, subtitle, settings, key, defaultHint } = opts;

    const row = new Adw.ActionRow({ title, subtitle });

    const inheritSw = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        tooltip_text: _("When ON the colour is inherited from the Shell theme"),
    });

    const colorBtn = new Gtk.ColorButton({
        valign: Gtk.Align.CENTER,
        use_alpha: true,
        tooltip_text: _("Pick a custom text colour"),
    });

    const _cssToRgba = (css) => {
        const rgba = new Gdk.RGBA();
        if (css && rgba.parse(css)) return rgba;
        return null;
    };

    const _rgbaToHex = (rgba) => {
        const r = Math.round(rgba.red * 255);
        const g = Math.round(rgba.green * 255);
        const b = Math.round(rgba.blue * 255);
        const a = rgba.alpha;
        if (Math.abs(a - 1.0) < 0.005)
            return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        const ai = Math.round(a * 255);
        return `rgba(${r},${g},${b},${(ai / 255).toFixed(3)})`;
    };

    const storedCss = settings.get_string(key) || "";
    const storedRgba = _cssToRgba(storedCss);

    if (storedRgba) {
        colorBtn.rgba = storedRgba;
        inheritSw.active = false;
        colorBtn.sensitive = true;
    } else {
        const fallbackRgba = new Gdk.RGBA();
        fallbackRgba.parse(defaultHint || "rgba(255,255,255,1)");
        colorBtn.rgba = fallbackRgba;
        inheritSw.active = true;
        colorBtn.sensitive = false;
    }

    inheritSw.connect("notify::active", () => {
        if (inheritSw.active) {
            colorBtn.sensitive = false;
            settings.set_string(key, "");
        } else {
            colorBtn.sensitive = true;
            settings.set_string(key, _rgbaToHex(colorBtn.rgba));
        }
    });

    colorBtn.connect("color-set", () => {
        if (!inheritSw.active)
            settings.set_string(key, _rgbaToHex(colorBtn.rgba));
    });

    const inheritLabel = new Gtk.Label({
        label: _("Inherit"),
        valign: Gtk.Align.CENTER,
        css_classes: ["dim-label"],
    });

    row.add_suffix(inheritLabel);
    row.add_suffix(inheritSw);
    row.add_suffix(colorBtn);

    return row;
}

function _makeFontFamilyGroup(cfg) {
    const { groupTitle, groupDescription, settings, key, page } = cfg;

    const defaultFamily = _getDefaultFontFamily();
    const systemFamilies = _getSystemFontFamilies();
    const inheritLabel = _("Default (%s)").format(defaultFamily);

    const group = new Adw.PreferencesGroup({
        title: groupTitle,
        description: groupDescription,
    });
    page.add(group);

    const storedFamily = settings.get_string(key) || "";

    const row = new Adw.ActionRow({
        title: _("Font Family"),
        subtitle: _("Default uses the Shell / GTK theme font"),
        activatable: true,
    });

    const valueLabel = new Gtk.Label({
        label: storedFamily || inheritLabel,
        valign: Gtk.Align.CENTER,
        css_classes: ["dim-label"],
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 24,
    });

    row.add_suffix(valueLabel);
    row.add_suffix(new Gtk.Image({
        icon_name: "pan-down-symbolic",
        valign: Gtk.Align.CENTER,
    }));

    const popover = new Gtk.Popover({
        has_arrow: false,
        position: Gtk.PositionType.BOTTOM,
        autohide: true,
    });

    const popoverBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
        width_request: 280,
    });

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: _("Search fonts\u2026"),
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6,
    });

    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        min_content_height: 220,
        max_content_height: 380,
    });

    const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        css_classes: ["navigation-sidebar"],
    });

    const allEntries = [inheritLabel, ...systemFamilies];
    const rowMap = new Map();

    for (const entry of allEntries) {
        const lbl = new Gtk.Label({
            label: entry,
            xalign: 0,
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 36,
        });
        const item = new Gtk.ListBoxRow({ child: lbl });
        item._fontName = entry;
        listBox.append(item);
        rowMap.set(entry, item);
    }

    let _query = "";

    listBox.set_filter_func((item) => {
        if (_query.length === 0) return true;
        if (item._fontName === inheritLabel) return true;
        return item._fontName.toLowerCase().includes(_query);
    });

    const _applyFilter = (query) => {
        _query = query.toLowerCase().trim();
        listBox.invalidate_filter();
    };

    const _syncSelection = () => {
        const stored = settings.get_string(key) || "";
        const target = stored
            ? rowMap.get(systemFamilies.find(
                (f) => f.toLowerCase() === stored.toLowerCase()) ?? "")
            : rowMap.get(inheritLabel);
        if (target)
            listBox.select_row(target);
    };

    const _scrollToSelected = () => {
        const sel = listBox.get_selected_row();
        if (!sel) return;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const adj = scrolled.get_vadjustment();
            if (!adj) return GLib.SOURCE_REMOVE;
            const alloc = sel.get_allocation();
            if (alloc.height > 0) {
                const center = alloc.y - (scrolled.get_min_content_height() / 2 - alloc.height / 2);
                adj.set_value(Math.max(0, center));
            }
            return GLib.SOURCE_REMOVE;
        });
    };

    let _debounceId = 0;

    searchEntry.connect("search-changed", () => {
        if (_debounceId !== 0) {
            GLib.source_remove(_debounceId);
            _debounceId = 0;
        }
        const text = searchEntry.get_text();
        _debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            _debounceId = 0;
            _applyFilter(text);
            return GLib.SOURCE_REMOVE;
        });
    });

    listBox.connect("row-activated", (_, selectedRow) => {
        if (!selectedRow) return;
        const name = selectedRow._fontName;
        settings.set_string(key, name === inheritLabel ? "" : name);
        popover.popdown();
    });

    row.connect("activated", () => {
        searchEntry.set_text("");
        _applyFilter("");
        _syncSelection();
        popover.popup();
        _scrollToSelected();
        searchEntry.grab_focus();
    });

    const sid = settings.connect(`changed::${key}`, () => {
        const v = settings.get_string(key) || "";
        valueLabel.set_label(v || inheritLabel);
    });

    row.connect("destroy", () => {
        if (_debounceId !== 0) {
            GLib.source_remove(_debounceId);
            _debounceId = 0;
        }
        try { settings.disconnect(sid); } catch (_e) {}
        popover.unparent();
    });

    scrolled.set_child(listBox);
    popoverBox.append(searchEntry);
    popoverBox.append(scrolled);
    popover.set_child(popoverBox);
    popover.set_parent(row);

    group.add(row);
    return group;
}

function _buildFontGroup(cfg) {
    const {
        groupTitle, groupDescription, settings, page,
        familyKey, sizeKey, sizeLower, sizeUpper, boldKey, colorKey, colorHint,
    } = cfg;

    _makeFontFamilyGroup({
        groupTitle,
        groupDescription,
        settings,
        key: familyKey,
        page,
    });

    const group = new Adw.PreferencesGroup();
    page.add(group);

    const sizeRow = new Adw.SpinRow({
        title: _("Font Size (px)"),
        subtitle: `${sizeLower}–${sizeUpper} px`,
        adjustment: new Gtk.Adjustment({
            lower: sizeLower,
            upper: sizeUpper,
            step_increment: 1,
            page_increment: 2,
            value: settings.get_int(sizeKey),
        }),
    });
    settings.bind(sizeKey, sizeRow, "value", Gio.SettingsBindFlags.DEFAULT);
    group.add(sizeRow);

    const boldRow = new Adw.SwitchRow({
        title: _("Bold"),
        subtitle: _("Use bold font weight"),
    });
    settings.bind(boldKey, boldRow, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(boldRow);

    const colorRow = _makeColorRow({
        title: _("Text Colour"),
        subtitle: _("\"Inherit\" uses the Shell theme colour"),
        settings,
        key: colorKey,
        defaultHint: colorHint,
    });
    group.add(colorRow);
}

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: _("Appearance"),
        icon_name: "applications-graphics-symbolic",
    });

    _buildFontGroup({
        page, settings,
        groupTitle: _("Panel Label – Font Family"),
        groupDescription: _(
            "Font used for the track / artist text shown in the top panel bar. " +
            "Changes apply immediately.",
        ),
        familyKey: "panel-font-family",
        sizeKey:   "panel-font-size",
        sizeLower: 8, sizeUpper: 24,
        boldKey:   "panel-font-bold",
        colorKey:  "panel-font-color",
        colorHint: "rgba(255,255,255,0.9)",
    });

    const panelIconGroup = new Adw.PreferencesGroup({
        title: _("Panel App Icon"),
        description: _("Size of the application icon displayed in the top panel."),
    });
    page.add(panelIconGroup);

    const panelIconRow = new Adw.SpinRow({
        title: _("Icon Size (px)"),
        subtitle: _("12–32 px. Takes effect immediately."),
        adjustment: new Gtk.Adjustment({
            lower: 12, upper: 32,
            step_increment: 1, page_increment: 4,
            value: settings.get_int("panel-icon-size"),
        }),
    });
    settings.bind("panel-icon-size", panelIconRow, "value", Gio.SettingsBindFlags.DEFAULT);
    panelIconGroup.add(panelIconRow);

    _buildFontGroup({
        page, settings,
        groupTitle: _("Popup – Track Title Font Family"),
        groupDescription: _(
            "Font for the large track-title label inside the popup player.",
        ),
        familyKey: "popup-title-font-family",
        sizeKey:   "popup-title-font-size",
        sizeLower: 8, sizeUpper: 32,
        boldKey:   "popup-title-font-bold",
        colorKey:  "popup-title-font-color",
        colorHint: "rgba(255,255,255,1.0)",
    });

    _buildFontGroup({
        page, settings,
        groupTitle: _("Popup – Artist Name Font Family"),
        groupDescription: _(
            "Font for the artist-name label inside the popup player.",
        ),
        familyKey: "popup-artist-font-family",
        sizeKey:   "popup-artist-font-size",
        sizeLower: 8, sizeUpper: 28,
        boldKey:   "popup-artist-font-bold",
        colorKey:  "popup-artist-font-color",
        colorHint: "rgba(200,200,200,1.0)",
    });

    const tabIconGroup = new Adw.PreferencesGroup({
        title: _("Player-Tab Icons"),
        description: _(
            "Icon sizes and style used in the player-switcher tabs at the top of the popup. " +
            "Set sizes to 0 to follow the system / Shell-theme default. " +
            "Changes apply immediately.",
        ),
    });
    page.add(tabIconGroup);

    const monoRow = new Adw.SwitchRow({
        title: _("Monochrome Icons"),
        subtitle: _(
            "Show app icons in monochrome (symbolic style) instead of colour. " +
            "Symbolic icons match the panel text colour and adapt to light / dark themes. " +
            "Apps without a symbolic variant are desaturated automatically.",
        ),
    });
    settings.bind("monochrome-icons", monoRow, "active", Gio.SettingsBindFlags.DEFAULT);
    tabIconGroup.add(monoRow);

    const tabIconNote = new Adw.ActionRow({
        title: _("System default sizes"),
        subtitle: _(
            "Multi-tab icons default to 18 px; the single large icon defaults to 28 px. " +
            "Setting 0 restores the system default for that slot.",
        ),
        activatable: false,
    });
    tabIconNote.add_prefix(new Gtk.Image({
        icon_name: "dialog-information-symbolic",
        pixel_size: 20,
        valign: Gtk.Align.CENTER,
    }));
    tabIconGroup.add(tabIconNote);

    const tabIconRow = new Adw.SpinRow({
        title: _("Multi-player Tab Icon Size (px)"),
        subtitle: _("0 = system default (18 px), range 12–32 px"),
        adjustment: new Gtk.Adjustment({
            lower: 0, upper: 32,
            step_increment: 1, page_increment: 4,
            value: settings.get_int("tab-icon-size"),
        }),
    });
    settings.bind("tab-icon-size", tabIconRow, "value", Gio.SettingsBindFlags.DEFAULT);
    tabIconGroup.add(tabIconRow);

    const singleIconRow = new Adw.SpinRow({
        title: _("Single-player Icon Size (px)"),
        subtitle: _("0 = system default (28 px), range 16–48 px"),
        adjustment: new Gtk.Adjustment({
            lower: 0, upper: 48,
            step_increment: 1, page_increment: 4,
            value: settings.get_int("single-icon-size"),
        }),
    });
    settings.bind("single-icon-size", singleIconRow, "value", Gio.SettingsBindFlags.DEFAULT);
    tabIconGroup.add(singleIconRow);

    const resetGroup = new Adw.PreferencesGroup({
        title: _("Reset Appearance"),
        description: _(
            "To restore all appearance defaults, use the Reset All Settings button on the About page.",
        ),
    });
    page.add(resetGroup);

    const resetRow = new Adw.ActionRow({
        title: _("Reset appearance defaults"),
        subtitle: _("Clears all font, colour and icon-size overrides"),
        activatable: false,
    });

    const resetBtn = new Gtk.Button({
        label: _("Reset"),
        valign: Gtk.Align.CENTER,
        css_classes: ["destructive-action"],
    });

    resetBtn.connect("clicked", () => {
        const APPEARANCE_KEYS = [
            "panel-font-family", "panel-font-size", "panel-font-bold",
            "panel-font-color", "panel-icon-size",
            "popup-title-font-family", "popup-title-font-size", "popup-title-font-bold",
            "popup-title-font-color",
            "popup-artist-font-family", "popup-artist-font-size", "popup-artist-font-bold",
            "popup-artist-font-color",
            "tab-icon-size", "single-icon-size", "monochrome-icons",
        ];

        const dialog = new Adw.AlertDialog({
            heading: _("Reset Appearance?"),
            body: _("Restore font, colour and icon-size settings to their defaults?"),
            default_response: "cancel",
            close_response: "cancel",
        });
        dialog.add_response("cancel", _("Cancel"));
        dialog.add_response("reset", _("Reset"));
        dialog.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE);

        dialog.connect("response", (_, responseId) => {
            if (responseId === "reset")
                APPEARANCE_KEYS.forEach((k) => settings.reset(k));
        });

        let parent = resetBtn.get_root();
        if (!(parent instanceof Gtk.Window)) parent = null;
        dialog.present(parent ?? null);
    });

    resetRow.add_suffix(resetBtn);
    resetGroup.add(resetRow);

    return page;
}