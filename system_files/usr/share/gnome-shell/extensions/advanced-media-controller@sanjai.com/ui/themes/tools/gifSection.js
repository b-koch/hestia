import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { loadFirstFrame, resolveGifPath } from "../helpers/previewHelpers.js";
import { openUri } from "../helpers/widgets.js";
import { USER_THEMES_DIR, THUMB_SIZE, TAU, PRESET_GIFS } from "../constants.js";

export function buildGifGroup(page, settings, themeEngine, previewArea, getPreviewGifPixbuf, setPreviewGif, getCurrentGifPath, extensionDir, cleanups) {
    const gifGroup = new Adw.PreferencesGroup({
        title: _("Animated Thumb"),
        description: _("Replace the thumb ball with a GIF or WebP animation. Auto-applied when a theme with a bundled thumb is selected."),
    });
    page.add(gifGroup);

    const THUMB_PREVIEW_SIZE = 48;

    const thumbPreviewArea = new Gtk.DrawingArea({
        content_width: THUMB_PREVIEW_SIZE,
        content_height: THUMB_PREVIEW_SIZE,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
    });

    let thumbPreviewOffset = 0;
    thumbPreviewArea.set_draw_func((_widget, cr) => {
        const theme = themeEngine.getActiveTheme();
        if (!theme || typeof theme.drawThumb !== "function") return;
        const size = THUMB_PREVIEW_SIZE;
        const tctx2 = {
            cr, size,
            ratio: 0.5,
            offset: thumbPreviewOffset,
            isPlaying: true,
            cx: size / 2, cy: size / 2, r: size / 2 - 1,
            pixbuf: getPreviewGifPixbuf(),
        };
        theme.drawThumb(tctx2);
    });

    let thumbPreviewAnimId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
        thumbPreviewOffset = (thumbPreviewOffset + 2) % 10000;
        thumbPreviewArea.queue_draw();
        return GLib.SOURCE_CONTINUE;
    });
    cleanups.push(() => { if (thumbPreviewAnimId) { GLib.source_remove(thumbPreviewAnimId); thumbPreviewAnimId = null; } });

    const idGifPath = settings.connect("changed::progress-gif-path", () => {
        thumbPreviewArea.queue_draw();
    });
    cleanups.push(() => settings.disconnect(idGifPath));

    const idThemeId = settings.connect("changed::progress-theme-id", () => {
        thumbPreviewArea.queue_draw();
    });
    cleanups.push(() => settings.disconnect(idThemeId));

    const thumbPreviewRow = new Adw.ActionRow({
        title: _("Live Thumb Preview"),
        subtitle: _("Current thumb ball animation"),
        activatable: false,
    });
    thumbPreviewRow.add_suffix(thumbPreviewArea);
    gifGroup.add(thumbPreviewRow);

    const presetsGroup = new Adw.PreferencesGroup({ title: _("Preset Animations") });
    page.add(presetsGroup);

    for (const preset of PRESET_GIFS) {
        const resolvedPath = resolveGifPath(extensionDir, preset.file);
        const thumbPixbuf = resolvedPath ? loadFirstFrame(resolvedPath, THUMB_SIZE) : null;

        const row = new Adw.ActionRow({
            title: preset.label,
            subtitle: resolvedPath
                ? _("Built-in preset")
                : _("File not found \u2014 add %s to the media folder").format(preset.file),
            activatable: !!resolvedPath,
        });

        if (thumbPixbuf) {
            const img = new Gtk.DrawingArea({
                content_width: THUMB_SIZE,
                content_height: THUMB_SIZE,
                valign: Gtk.Align.CENTER,
            });
            img.set_draw_func((_w, cr) => {
                cr.save();
                cr.arc(THUMB_SIZE / 2, THUMB_SIZE / 2, THUMB_SIZE / 2, 0, TAU);
                cr.clip();
                Gdk.cairo_set_source_pixbuf(cr, thumbPixbuf, 0, 0);
                cr.paint();
                cr.restore();
            });
            row.add_prefix(img);
        } else {
            row.add_prefix(new Gtk.Image({
                icon_name: "image-missing-symbolic",
                pixel_size: THUMB_SIZE,
                valign: Gtk.Align.CENTER,
            }));
        }

        if (resolvedPath) {
            const applyBtn = new Gtk.Button({
                label: _("Apply"),
                valign: Gtk.Align.CENTER,
                css_classes: ["suggested-action"],
            });
            applyBtn.connect("clicked", () => {
                settings.set_boolean("progress-gif-enabled", true);
                settings.set_string("progress-gif-path", resolvedPath);
                settings.set_string("progress-bar-color", preset.color);
                settings.set_boolean("progress-bar-use-system-color", false);
                settings.set_string("progress-theme-id", preset.themeId);
                themeEngine.setActiveTheme(preset.themeId);
                setPreviewGif(resolvedPath);
                previewArea.queue_draw();
                thumbPreviewArea.queue_draw();
            });
            row.add_suffix(applyBtn);
        }
        presetsGroup.add(row);
    }

    const customGroup = new Adw.PreferencesGroup({ title: _("Custom Animation") });
    page.add(customGroup);

    let gifPathRow;

    const uploadRow = new Adw.ActionRow({
        title: _("Upload GIF / WebP"),
        subtitle: getCurrentGifPath() || _("None selected"),
        activatable: true,
    });
    uploadRow.add_prefix(new Gtk.Image({ icon_name: "document-open-symbolic", pixel_size: 20, valign: Gtk.Align.CENTER }));
    uploadRow.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic", pixel_size: 16, valign: Gtk.Align.CENTER }));
    gifPathRow = uploadRow;

    const _updateGifPathRow = () => {
        if (gifPathRow) gifPathRow.subtitle = getCurrentGifPath() || _("None selected");
    };

    const idGifPathUpload = settings.connect("changed::progress-gif-path", () => {
        _updateGifPathRow();
        setPreviewGif(getCurrentGifPath() || null);
        previewArea.queue_draw();
    });
    cleanups.push(() => settings.disconnect(idGifPathUpload));

    uploadRow.connect("activated", () => {
        const dlg = new Gtk.FileDialog({ title: _("Choose a GIF or WebP file"), modal: true });
        const filter = new Gtk.FileFilter();
        filter.set_name(_("Animated images (GIF, WebP)"));
        filter.add_mime_type("image/gif");
        filter.add_mime_type("image/webp");
        filter.add_pattern("*.gif");
        filter.add_pattern("*.webp");
        const store = Gio.ListStore.new(Gtk.FileFilter);
        store.append(filter);
        dlg.filters = store;
        dlg.default_filter = filter;
        const root = page.get_root?.() ?? null;
        dlg.open(root, null, (d, res) => {
            let file;
            try {
                file = d.open_finish(res);
            } catch {
                return;
            }

            const srcPath = file.get_path();
            const mediaDir = GLib.build_filenamev([USER_THEMES_DIR, "thumbs"]);
            GLib.mkdir_with_parents(mediaDir, 0o755);
            const destPath = GLib.build_filenamev([mediaDir, GLib.path_get_basename(srcPath)]);
            try {
                Gio.File.new_for_path(srcPath).copy(
                    Gio.File.new_for_path(destPath),
                    Gio.FileCopyFlags.OVERWRITE,
                    null,
                    null
                );
                settings.set_string("progress-gif-path", destPath);
            } catch {
                settings.set_string("progress-gif-path", srcPath);
            }
            settings.set_boolean("progress-gif-enabled", true);
        });
    });
    customGroup.add(uploadRow);

    const clearGifRow = new Adw.ActionRow({
        title: _("Clear Animated Thumb"),
        subtitle: _("Revert to the theme\u2019s default thumb ball"),
        activatable: true,
    });
    clearGifRow.add_prefix(new Gtk.Image({
        icon_name: "user-trash-symbolic",
        pixel_size: 20,
        valign: Gtk.Align.CENTER,
        css_classes: ["error"],
    }));
    clearGifRow.connect("activated", () => {
        settings.set_string("progress-gif-path", "");
        settings.set_boolean("progress-gif-enabled", false);
        setPreviewGif(null);
        previewArea.queue_draw();
        _updateGifPathRow();
    });
    customGroup.add(clearGifRow);

    const thumbLink = new Adw.ActionRow({
        title: _("Find More Stickers"),
        subtitle: _("Browse animated stickers on GIPHY"),
        activatable: true,
    });
    thumbLink.add_prefix(new Gtk.Image({ icon_name: "web-browser-symbolic", pixel_size: 20, valign: Gtk.Align.CENTER }));
    thumbLink.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic", pixel_size: 16, valign: Gtk.Align.CENTER }));
    thumbLink.connect("activated", () => {
        openUri("https://giphy.com/?type=stickers");
    });
    customGroup.add(thumbLink);

    return { gifGroup, _updateGifPathRow };
}