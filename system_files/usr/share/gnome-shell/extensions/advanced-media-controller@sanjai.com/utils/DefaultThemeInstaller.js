import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
  fetchBytes,
  extractArchive,
  scanForThemeFolderRecursive,
  copyDirRecursive,
  rimraf,
} from "./core/themeUtils.js";

const MATRIX_ARCHIVE_URL =
  "https://codeberg.org/sanjai-shaarugesh/matrix/archive/main.zip";

const THEMES_DIR = GLib.build_filenamev([
  GLib.get_user_data_dir(),
  "gnome-shell",
  "extensions",
  "Advanced-media-controller-themes",
]);
const SENTINEL = GLib.build_filenamev([
  THEMES_DIR,
  ".matrix-default-installed",
]);

async function installMatrixTheme(cancellable) {
  GLib.mkdir_with_parents(THEMES_DIR, 0o755);

  const tmpBase = GLib.build_filenamev([
    GLib.get_tmp_dir(),
    `amc-matrix-${GLib.get_monotonic_time()}`,
  ]);
  const archivePath = `${tmpBase}.zip`;
  const extractDir = `${tmpBase}-extracted`;
  const session = new Soup.Session({ timeout: 30 });
  const cancelId = cancellable.connect(() => session.abort());

  try {
    GLib.file_set_contents(
      archivePath,
      await fetchBytes(session, MATRIX_ARCHIVE_URL, cancellable),
    );
    await extractArchive(archivePath, extractDir, false);

    const themeFolder = scanForThemeFolderRecursive(extractDir, 4);
    if (!themeFolder) throw new Error(_("No theme folder found in archive"));

    copyDirRecursive(
      themeFolder,
      GLib.build_filenamev([THEMES_DIR, GLib.path_get_basename(themeFolder)]),
    );
    GLib.file_set_contents(SENTINEL, "1");
  } finally {
    cancellable.disconnect(cancelId);
    session.abort();
    rimraf(archivePath);
    rimraf(extractDir);
  }
}

// Returns a Gio.Cancellable, cancel it from disable()
export function installDefaultThemesIfNeeded() {
  const cancellable = new Gio.Cancellable();

  if (!GLib.file_test(SENTINEL, GLib.FileTest.EXISTS)) {
    installMatrixTheme(cancellable).catch((e) => {
      if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.error(`Default theme install failed: ${e.message}`);
    });
  }
  return cancellable;
}