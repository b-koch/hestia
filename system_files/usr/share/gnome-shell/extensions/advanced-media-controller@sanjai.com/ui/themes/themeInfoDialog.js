import Adw from "gi://Adw";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { loadFirstFrame, drawCirclePixbuf } from "./helpers/previewHelpers.js";
import { openUri, presentDialog } from "./helpers/widgets.js";
import { TAU } from "./constants.js";

const THUMB = 56;

function buildThumbArea(theme, pixbuf) {
  const area = new Gtk.DrawingArea({
    content_width: THUMB,
    content_height: THUMB,
    valign: Gtk.Align.CENTER,
    halign: Gtk.Align.CENTER,
  });

  if (typeof theme?.drawThumb === "function") {
    let offset = 0;
    let reported = false;
    area.set_draw_func((_area, cr) => {
      try {
        theme.drawThumb({
          cr,
          offset,
          pixbuf,
          size: THUMB,
          ratio: 0.5,
          isPlaying: true,
          cx: THUMB / 2,
          cy: THUMB / 2,
          r: THUMB / 2 - 1,
        });
      } catch (e) {
        if (!reported) {
          reported = true;
          console.error(`Theme "${theme.id}" failed to draw thumb: ${e.message}`);
        }
      }
    });

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
      if (!area.get_root()) return GLib.SOURCE_REMOVE;
      offset = (offset + 2) % 10000;
      area.queue_draw();
      return GLib.SOURCE_CONTINUE;
    });
  } else if (pixbuf) {
    area.set_draw_func((_area, cr) => drawCirclePixbuf(cr, pixbuf, THUMB / 2, THUMB / 2, THUMB / 2));
  } else {
    area.set_draw_func((_area, cr) => {
      const c = THUMB / 2;
      cr.setSourceRGBA(0.208, 0.518, 0.894, 1);
      cr.arc(c, c, c - 1, 0, TAU);
      cr.fill();
      cr.setSourceRGBA(1, 1, 1, 0.3);
      cr.setLineWidth(1.5);
      cr.arc(c, c, c - 1.75, 0, TAU);
      cr.stroke();
    });
  }

  return area;
}

export function showThemeInfoDialog(page, t, themeEngine) {
  const entry = themeEngine?.getThemeEntry(t.id);
  const pixbuf = loadFirstFrame(t.thumbFile ?? entry?.thumbFile, THUMB);

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    margin_top: 4,
  });

  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 12,
    valign: Gtk.Align.CENTER,
  });
  header.append(buildThumbArea(entry?.theme, pixbuf));

  const meta = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    valign: Gtk.Align.CENTER,
  });
  meta.append(
    new Gtk.Label({ label: t.label, xalign: 0, css_classes: ["title-4"] }),
  );

  const credits = [t.author, t.version && `v${t.version}`].filter(Boolean);
  if (credits.length > 0) {
    meta.append(
      new Gtk.Label({
        label: credits.join("  \u00b7  "),
        xalign: 0,
        css_classes: ["dim-label"],
      }),
    );
  }
  header.append(meta);
  content.append(header);

  if (t.description) {
    content.append(new Gtk.Separator());
    content.append(
      new Gtk.Label({
        label: t.description,
        xalign: 0,
        wrap: true,
        max_width_chars: 42,
      }),
    );
  }

  if (t.repoUrl) {
    const url = GLib.markup_escape_text(t.repoUrl, -1);
    content.append(
      new Gtk.Label({
        label: `<a href="${url}">${url}</a>`,
        use_markup: true,
        xalign: 0,
        wrap: true,
      }),
    );
  }

  const responses = [["close", _("Close")]];
  if (t.repoUrl)
    responses.unshift([
      "repo",
      _("Open Repository"),
      Adw.ResponseAppearance.SUGGESTED,
    ]);

  presentDialog(page, {
    heading: t.label,
    extraChild: content,
    responses,
    closeResponse: "close",
    onResponse: (response) => {
      if (response === "repo") openUri(t.repoUrl);
    },
  });
}