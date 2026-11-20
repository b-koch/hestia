import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { rgbaToHex } from "../helpers/previewHelpers.js";
import { TAU, COLOR_PRESETS } from "../constants.js";

export function buildColorGroup(page, settings, previewArea, getCurrentColor, getUseSystemColor, cleanups) {
    const colorGroup = new Adw.PreferencesGroup({
        title: _("Bar Colour"),
        description: _("Applied by themes that respect the bar colour setting"),
    });
    page.add(colorGroup);

    const sysColorRow = new Adw.ActionRow({
        title: _("Use System Accent Colour"),
        subtitle: _("Follow the GNOME accent colour from Settings \u2192 Appearance"),
    });
    const sysSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: getUseSystemColor() });
    sysSwitch.connect("notify::active", () => {
        settings.set_boolean("progress-bar-use-system-color", sysSwitch.active);
    });

    let colorBtn;

    const idSysColor = settings.connect("changed::progress-bar-use-system-color", () => {
        sysSwitch.active = getUseSystemColor();
        colorBtn.sensitive = !sysSwitch.active;
        previewArea.queue_draw();
    });
    cleanups.push(() => settings.disconnect(idSysColor));

    sysColorRow.add_suffix(sysSwitch);
    colorGroup.add(sysColorRow);

    const colorRow = new Adw.ActionRow({
        title: _("Custom Bar Colour"),
        subtitle: _("Click the swatch to open the colour picker"),
        activatable: false,
    });
    colorBtn = new Gtk.ColorButton({
        valign: Gtk.Align.CENTER,
        use_alpha: false,
        sensitive: !getUseSystemColor(),
    });
    const rgba = new Gdk.RGBA();
    rgba.parse(getCurrentColor());
    colorBtn.rgba = rgba;

    colorBtn.connect("color-set", () => {
        settings.set_string("progress-bar-color", rgbaToHex(colorBtn.get_rgba()));
    });

    const idBarColor = settings.connect("changed::progress-bar-color", () => {
        const next = new Gdk.RGBA();
        next.parse(getCurrentColor());
        colorBtn.rgba = next;
        previewArea.queue_draw();
    });
    cleanups.push(() => settings.disconnect(idBarColor));

    colorRow.add_suffix(colorBtn);
    colorGroup.add(colorRow);

    const presetsGroup = new Adw.PreferencesGroup({ title: _("Colour Presets") });
    page.add(presetsGroup);

    const colorFlow = new Gtk.FlowBox({
        max_children_per_line: 10,
        min_children_per_line: 4,
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        column_spacing: 8,
        row_spacing: 8,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    for (const cp of COLOR_PRESETS) {
        const btn = new Gtk.Button({ tooltip_text: cp.label, css_classes: ["flat"] });
        const swatch = new Gtk.DrawingArea({ content_width: 28, content_height: 28 });
        swatch.set_draw_func((_w, cr) => {
            const rgba = new Gdk.RGBA();
            rgba.parse(cp.hex);
            const cx = 14, cy = 14, r = 12;
            cr.setSourceRGBA(rgba.red, rgba.green, rgba.blue, 1.0);
            cr.arc(cx, cy, r, 0, TAU);
            cr.fill();
            cr.setSourceRGBA(0, 0, 0, 0.12);
            cr.setLineWidth(1.5);
            cr.arc(cx, cy, r, 0, TAU);
            cr.stroke();
        });
        btn.set_child(swatch);
        btn.connect("clicked", () => {
            settings.set_boolean("progress-bar-use-system-color", false);
            settings.set_string("progress-bar-color", cp.hex);
        });
        colorFlow.append(btn);
    }

    const colorFlowRow = new Adw.ActionRow({ activatable: false });
    colorFlowRow.set_child(colorFlow);
    presetsGroup.add(colorFlowRow);

    return { colorGroup, colorPresetsGroup: presetsGroup };
}