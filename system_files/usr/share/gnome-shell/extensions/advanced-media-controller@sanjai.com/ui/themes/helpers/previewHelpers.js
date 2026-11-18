import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Gtk from "gi://Gtk";

export function rgbaToHex(rgba) {
  const hex = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(rgba.red)}${hex(rgba.green)}${hex(rgba.blue)}`;
}

export function resolveGifPath(extensionDir, filename) {
  if (!extensionDir) return null;
  for (const p of [
    GLib.build_filenamev([extensionDir, "media", filename]),
    GLib.build_filenamev([extensionDir, filename]),
  ]) {
    if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
  }
  return null;
}

export function loadFirstFrame(path, size) {
  if (!path) return null;
  try {
    const anim = GdkPixbuf.PixbufAnimation.new_from_file(path);
    const pb = anim.get_static_image();
    return pb
      ? pb.scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR)
      : null;
  } catch {
    return null;
  }
}

export class GifPlayer {
  constructor(path, size) {
    this._size = size;
    this._iter = null;
    this._frame = null;

    try {
      const anim = GdkPixbuf.PixbufAnimation.new_from_file(path);
      if (anim.is_static_image()) {
        this._frame = this._scale(anim.get_static_image());
      } else {
        this._iter = anim.get_iter(null);
        this._frame = this._scale(this._iter.get_pixbuf());
      }
    } catch {
      this._frame = null;
    }
  }

  get pixbuf() {
    if (this._iter?.advance(null))
      this._frame = this._scale(this._iter.get_pixbuf()) ?? this._frame;
    return this._frame;
  }

  _scale(pixbuf) {
    return (
      pixbuf?.scale_simple(
        this._size,
        this._size,
        GdkPixbuf.InterpType.BILINEAR,
      ) ?? null
    );
  }
}

export function buildPreviewArea(width, height) {
  return new Gtk.DrawingArea({
    content_width: width,
    content_height: height,
    hexpand: true,
    vexpand: false,
  });
}

export function roundedRectCr(cr, x, y, w, h, r) {
  const PI = Math.PI;
  cr.newPath();
  cr.arc(x + r, y + r, r, PI, (3 * PI) / 2);
  cr.arc(x + w - r, y + r, r, (3 * PI) / 2, 0);
  cr.arc(x + w - r, y + h - r, r, 0, PI / 2);
  cr.arc(x + r, y + h - r, r, PI / 2, PI);
  cr.closePath();
}

export function drawCirclePixbuf(cr, pixbuf, cx, cy, radius) {
  if (!pixbuf) return;

  const diameter = radius * 2;

  cr.save();
  cr.newPath();
  cr.arc(cx, cy, radius, 0, 2 * Math.PI);
  cr.clip();
  cr.translate(cx - radius, cy - radius);
  cr.scale(diameter / pixbuf.get_width(), diameter / pixbuf.get_height());
  Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
  cr.paint();
  cr.restore();
}