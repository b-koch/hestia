import GLib from "gi://GLib";
import Cairo from "gi://cairo";

const surfaces = new WeakMap();

export function surfaceFromPixbuf(pixbuf) {
  let surface = surfaces.get(pixbuf);
  if (surface) return surface;

  const tmp = GLib.build_filenamev([
    GLib.get_user_runtime_dir(),
    `amc-pixbuf-${GLib.uuid_string_random()}.png`,
  ]);
  try {
    pixbuf.savev(tmp, "png", [], []);
    surface = Cairo.ImageSurface.createFromPNG(tmp);
  } finally {
    GLib.unlink(tmp);
  }

  surfaces.set(pixbuf, surface);
  return surface;
}

export function setSourcePixbuf(cr, pixbuf, x, y) {
  cr.setSourceSurface(surfaceFromPixbuf(pixbuf), x, y);
}