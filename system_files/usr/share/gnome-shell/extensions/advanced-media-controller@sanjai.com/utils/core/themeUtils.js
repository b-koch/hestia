import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");
Gio._promisify(
  Gio.File.prototype,
  "load_contents_async",
  "load_contents_finish",
);
Gio._promisify(
  Soup.Session.prototype,
  "send_and_read_async",
  "send_and_read_finish",
);

const noQuery = (url) => url.split("?")[0];
const archiveSlug = (repo) => repo.replace("/", "-");

export function normaliseThemeUrl(raw) {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return { ok: false };

  let m;

  if (
    (m = s.match(
      /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+\.theme\.js)(\?.*)?$/,
    ))
  )
    return {
      ok: true,
      url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`,
      single: true,
    };

  if (/^https?:\/\/raw\.githubusercontent\.com\/.+\.theme\.js(\?.*)?$/.test(s))
    return { ok: true, url: noQuery(s), single: true };

  if (
    (m = s.match(
      /^https?:\/\/codeberg\.org\/([^/]+\/[^/]+)\/src\/branch\/([^/]+)\/(.+\.theme\.js)(\?.*)?$/,
    ))
  )
    return {
      ok: true,
      url: `https://codeberg.org/${m[1]}/raw/branch/${m[2]}/${m[3]}`,
      single: true,
    };

  if (
    /^https?:\/\/codeberg\.org\/.+\/raw\/branch\/.+\.theme\.js(\?.*)?$/.test(s)
  )
    return { ok: true, url: noQuery(s), single: true };

  if (
    (m = s.match(
      /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/]+)\/(.+)$/,
    ))
  ) {
    const [, repo, branch, subdir] = m;
    return {
      ok: true,
      url: `https://github.com/${repo}/archive/refs/heads/${branch}.zip`,
      single: false,
      subdir: subdir.replace(/\/+$/, ""),
    };
  }

  if (
    (m = s.match(
      /^https?:\/\/codeberg\.org\/([^/]+\/[^/]+)\/src\/branch\/([^/]+)\/(.+)$/,
    ))
  ) {
    const [, repo, branch, subdir] = m;
    return {
      ok: true,
      url: `https://codeberg.org/${repo}/archive/${branch}.zip`,
      single: false,
      subdir: subdir.replace(/\/+$/, ""),
      cbRepoName: repo.split("/")[1] ?? repo,
      cbBranch: branch,
    };
  }

  if (
    (m = s.match(
      /^https?:\/\/gitlab\.com\/([^/]+\/[^/]+)\/-\/tree\/([^/]+)\/(.+)$/,
    ))
  ) {
    const [, repo, branch, subdir] = m;
    return {
      ok: true,
      url: `https://gitlab.com/${repo}/-/archive/${branch}/${archiveSlug(repo)}-${branch}.zip`,
      single: false,
      subdir: subdir.replace(/\/+$/, ""),
    };
  }

  if ((m = s.match(/^https?:\/\/github\.com\/([^/]+\/[^/?#]+)([/?#].*)?$/)))
    return {
      ok: true,
      url: `https://github.com/${m[1]}/archive/refs/heads/main.zip`,
      single: false,
    };

  if ((m = s.match(/^https?:\/\/codeberg\.org\/([^/]+\/[^/?#]+)([/?#].*)?$/)))
    return {
      ok: true,
      url: `https://codeberg.org/${m[1]}/archive/main.zip`,
      single: false,
    };

  if ((m = s.match(/^https?:\/\/gitlab\.com\/([^/]+\/[^/?#]+)([/?#].*)?$/)))
    return {
      ok: true,
      url: `https://gitlab.com/${m[1]}/-/archive/main/${archiveSlug(m[1])}-main.zip`,
      single: false,
    };

  if (/\.theme\.js(\?.*)?$/.test(s))
    return { ok: true, url: noQuery(s), single: true };

  if (/\.(zip|tar\.gz|tgz)(\?.*)?$/.test(s))
    return { ok: true, url: noQuery(s), single: false };

  return { ok: false };
}

export async function fetchBytes(session, url, cancellable, onProgress) {
  const message = Soup.Message.new("GET", url);
  if (!message) throw new Error("bad_url");

  const bytes = await session.send_and_read_async(
    message,
    GLib.PRIORITY_DEFAULT,
    cancellable,
  );
  if (message.get_status() !== Soup.Status.OK)
    throw new Error(`http_${message.get_status()}`);
  if (bytes.get_size() === 0) throw new Error("empty_response");

  onProgress?.(1.0);
  return bytes.get_data();
}

export async function subprocessWaitAsync(proc) {
  await proc.wait_async(null);
  return proc.get_exit_status();
}

export async function extractArchive(archivePath, destDir, isTarGz) {
  GLib.mkdir_with_parents(destDir, 0o755);

  const argv = isTarGz
    ? ["tar", "-xzf", archivePath, "-C", destDir]
    : ["unzip", "-q", "-o", archivePath, "-d", destDir];
  const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);

  if ((await subprocessWaitAsync(proc)) !== 0)
    throw new Error("extract_failed");
}

export function listDir(path) {
  const iter = Gio.File.new_for_path(path).enumerate_children(
    "standard::name,standard::type",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  const entries = [];

  for (
    let info = iter.next_file(null);
    info !== null;
    info = iter.next_file(null)
  ) {
    entries.push({
      name: info.get_name(),
      isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
    });
  }
  iter.close(null);
  return entries;
}

export function scanForThemeFolderRecursive(path, depth) {
  if (depth < 0) return null;

  const entries = listDir(path);
  const hasMeta = entries.some((e) => e.name === "metadata.json");
  const hasScript = entries.some((e) => e.name.endsWith(".theme.js"));
  if (hasMeta && hasScript) return path;

  for (const dir of entries.filter((e) => e.isDir)) {
    const found = scanForThemeFolderRecursive(
      GLib.build_filenamev([path, dir.name]),
      depth - 1,
    );
    if (found) return found;
  }
  return null;
}

export function rimraf(path) {
  const file = Gio.File.new_for_path(path);
  const type = file.query_file_type(
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );
  if (type === Gio.FileType.UNKNOWN) return;

  if (type === Gio.FileType.DIRECTORY) {
    for (const { name } of listDir(path))
      rimraf(GLib.build_filenamev([path, name]));
  }
  file.delete(null);
}

export function copyDirRecursive(src, dst) {
  GLib.mkdir_with_parents(dst, 0o755);

  for (const { name, isDir } of listDir(src)) {
    const from = GLib.build_filenamev([src, name]);
    const to = GLib.build_filenamev([dst, name]);

    if (isDir) {
      copyDirRecursive(from, to);
    } else {
      Gio.File.new_for_path(from).copy(
        Gio.File.new_for_path(to),
        Gio.FileCopyFlags.OVERWRITE,
        null,
        null,
      );
    }
  }
}

async function readText(path, cancellable) {
  const [bytes] =
    await Gio.File.new_for_path(path).load_contents_async(cancellable);
  return new TextDecoder().decode(bytes);
}

export async function parseMetadata(metaPath, cancellable = null) {
  try {
    return JSON.parse(await readText(metaPath, cancellable));
  } catch {
    return null;
  }
}

export async function loadThemeJs(
  jsPath,
  Cairo,
  THEME_API_VERSION,
  cancellable = null,
) {
  try {
    const src = await readText(jsPath, cancellable);
    const factory = new Function(
      "Cairo",
      "GLib",
      "THEME_API_VERSION",
      `"use strict";\n${src}\nif (typeof theme === "undefined") throw new Error("theme not defined");\nreturn theme;`,
    );
    const theme = factory(Cairo, GLib, THEME_API_VERSION);

    if (typeof theme?.id !== "string" || typeof theme.drawTrack !== "function")
      return null;
    return theme;
  } catch (e) {
    if (cancellable?.is_cancelled()) return null;
    console.error(`Failed to load theme ${jsPath}: ${e.message}`);
    return null;
  }
}
