import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Cairo from "gi://cairo";
import Soup from "gi://Soup";

import { BUILTIN_THEMES } from "./builtinThemes.js";
import {
  fetchBytes,
  extractArchive,
  scanForThemeFolderRecursive,
  listDir,
  rimraf,
  copyDirRecursive,
  parseMetadata,
  loadThemeJs,
} from "./themeUtils.js";

export const THEME_API_VERSION = 1;

export { ThemeContext, ThumbContext } from "./themeContext.js";
export { normaliseThemeUrl } from "./themeUtils.js";

const THUMB_NAMES = [
  "thumb.gif",
  "thumb.webp",
  "thumb.png",
  "preview.gif",
  "preview.png",
];
const RELOAD_DELAY_MS = 200;

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

function findFile(dir, names) {
  return (
    names
      .map((n) => GLib.build_filenamev([dir, n]))
      .find((p) => GLib.file_test(p, GLib.FileTest.EXISTS)) ?? null
  );
}

function findDirNamed(base, target, depth) {
  if (depth < 0) return null;

  for (const { name, isDir } of listDir(base)) {
    if (!isDir) continue;
    const path = GLib.build_filenamev([base, name]);
    if (name === target) return path;
    const found = findDirNamed(path, target, depth - 1);
    if (found) return found;
  }
  return null;
}

function repoApiInfo(zipUrl, subdir) {
  let m = zipUrl.match(
    /^https?:\/\/codeberg\.org\/([^/]+\/[^/]+)\/archive\/([^/]+)\.zip$/,
  );
  if (m) {
    return {
      apiUrl: `https://codeberg.org/api/v1/repos/${m[1]}/contents/${subdir}?ref=${m[2]}`,
      rawBase: `https://codeberg.org/${m[1]}/raw/branch/${m[2]}/${subdir}`,
    };
  }

  m = zipUrl.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/refs\/heads\/([^/]+)\.zip$/,
  );
  if (m) {
    return {
      apiUrl: `https://api.github.com/repos/${m[1]}/contents/${subdir}?ref=${m[2]}`,
      rawBase: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${subdir}`,
    };
  }

  m = zipUrl.match(
    /^https?:\/\/gitlab\.com\/([^/]+\/[^/]+)\/-\/archive\/([^/]+)\/[^/]+-[^/]+\.zip$/,
  );
  if (m) {
    return {
      apiUrl: `https://gitlab.com/api/v4/projects/${encodeURIComponent(m[1])}/repository/tree?path=${subdir}&ref=${m[2]}&recursive=false`,
      rawBase: `https://gitlab.com/${m[1]}/-/raw/${m[2]}/${subdir}`,
    };
  }

  return null;
}

export class ThemeEngine {
  constructor(extensionDir) {
    this._extensionDir = extensionDir;
    this._themes = new Map();
    this._activeThemeId = "default";
    this._monitors = [];
    this._reloadTimer = 0;
    this._reloadCancellable = null;
    this._session = new Soup.Session({ timeout: 30 });
    this.onThemesChanged = null;
    this._userThemesDir = GLib.build_filenamev([
      GLib.get_user_data_dir(),
      "gnome-shell",
      "extensions",
      "Advanced-media-controller-themes",
    ]);

    for (const theme of BUILTIN_THEMES) {
      this._themes.set(theme.id, {
        theme,
        meta: null,
        builtin: true,
        folderPath: null,
        thumbFile: this._findBuiltinThumb(theme.id),
      });
    }

    GLib.mkdir_with_parents(this._userThemesDir, 0o755);
    this.reload();
  }

  _findBuiltinThumb(themeId) {
    if (!this._extensionDir) return null;

    for (const sub of [
      ["themes"],
      ["utils", "core", "themes"],
      ["assets", "themes"],
    ]) {
      const dir = GLib.build_filenamev([this._extensionDir, ...sub, themeId]);
      const found = findFile(dir, THUMB_NAMES);
      if (found) return found;
    }
    return null;
  }

  _watchThemeDirs() {
    this._unwatchThemeDirs();

    if (!GLib.file_test(this._userThemesDir, GLib.FileTest.IS_DIR)) return;

    const paths = [this._userThemesDir];
    for (const { name, isDir } of listDir(this._userThemesDir)) {
      if (isDir) paths.push(GLib.build_filenamev([this._userThemesDir, name]));
    }

    for (const path of paths) {
      const monitor = Gio.File.new_for_path(path).monitor_directory(
        Gio.FileMonitorFlags.NONE,
        null,
      );
      monitor.connect("changed", () => this._queueReload());
      this._monitors.push(monitor);
    }
  }

  _unwatchThemeDirs() {
    for (const monitor of this._monitors) monitor.cancel();
    this._monitors = [];
  }

  async reload() {
    this._reloadCancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this._reloadCancellable = cancellable;

    await this._reloadUserThemes(cancellable);
    if (cancellable.is_cancelled()) return;
    this._watchThemeDirs();
  }

  _queueReload() {
    if (this._reloadTimer) GLib.Source.remove(this._reloadTimer);

    this._reloadTimer = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RELOAD_DELAY_MS,
      () => {
        this._reloadTimer = 0;
        this.reload();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  async _reloadUserThemes(cancellable) {
    const found = new Map();

    const entries = GLib.file_test(this._userThemesDir, GLib.FileTest.IS_DIR)
      ? listDir(this._userThemesDir)
      : [];

    for (const { name } of entries.filter((e) => e.isDir)) {
      const entry = await this._loadThemeFolder(
        GLib.build_filenamev([this._userThemesDir, name]),
        name,
        cancellable,
      );
      if (cancellable.is_cancelled()) return;
      if (entry) found.set(entry.theme.id, entry);
    }

    for (const { name } of entries.filter(
      (e) => !e.isDir && e.name.endsWith(".theme.js"),
    )) {
      const entry = await this._loadSingleFileTheme(
        GLib.build_filenamev([this._userThemesDir, name]),
        cancellable,
      );
      if (cancellable.is_cancelled()) return;
      if (entry && !found.has(entry.theme.id)) found.set(entry.theme.id, entry);
    }

    for (const id of [...this._themes.keys()]) {
      if (!BUILTIN_IDS.has(id)) this._themes.delete(id);
    }
    for (const [id, entry] of found) this._themes.set(id, entry);
    this.onThemesChanged?.();
  }

  async _loadThemeFolder(folderPath, folderName, cancellable) {
    const meta = await parseMetadata(
      GLib.build_filenamev([folderPath, "metadata.json"]),
      cancellable,
    );

    const scriptPath =
      findFile(folderPath, [`${folderName}.theme.js`, "theme.js"]) ??
      listDir(folderPath)
        .map((e) => e.name)
        .filter((n) => n.endsWith(".theme.js"))
        .map((n) => GLib.build_filenamev([folderPath, n]))[0];
    if (!scriptPath) return null;

    const theme = await loadThemeJs(
      scriptPath,
      Cairo,
      THEME_API_VERSION,
      cancellable,
    );
    if (!theme || BUILTIN_IDS.has(theme.id)) return null;

    if (meta) {
      theme.label = meta.name || theme.label || theme.id;
      theme.author = meta.author || theme.author || "";
      theme.version = meta.version || theme.version || "1.0";
      theme.description = meta.description || "";
      theme.repoUrl = meta.repoUrl || meta.url || "";
    }

    const thumbFile = meta?.thumb
      ? GLib.build_filenamev([folderPath, meta.thumb])
      : findFile(folderPath, THUMB_NAMES);

    return {
      theme,
      meta,
      builtin: false,
      folderPath,
      thumbFile,
    };
  }

  async _loadSingleFileTheme(jsPath, cancellable) {
    const theme = await loadThemeJs(
      jsPath,
      Cairo,
      THEME_API_VERSION,
      cancellable,
    );
    if (!theme || BUILTIN_IDS.has(theme.id)) return null;

    return {
      theme,
      meta: null,
      builtin: false,
      folderPath: null,
      thumbFile: null,
    };
  }

  setActiveTheme(id) {
    const themeId = id || "default";
    this._activeThemeId = themeId;

    if (!BUILTIN_IDS.has(themeId)) this.reload();
  }

  getActiveTheme() {
    return this.getActiveThemeEntry()?.theme ?? null;
  }

  getActiveThemeEntry() {
    return (
      this._themes.get(this._activeThemeId) ??
      this._themes.get("default") ??
      null
    );
  }

  getThemeEntry(id) {
    return this._themes.get(id) ?? null;
  }

  listThemes() {
    return [...this._themes.values()].map(
      ({ theme, meta, builtin, folderPath, thumbFile }) => ({
        id: theme.id,
        label: meta?.name || theme.label || theme.id,
        author: meta?.author || theme.author || "",
        version: meta?.version || theme.version || "1.0",
        description: meta?.description || theme.description || "",
        repoUrl: meta?.repoUrl || meta?.url || theme.repoUrl || "",
        builtin,
        folderPath,
        thumbFile,
        meta,
      }),
    );
  }

  getUserThemesDir() {
    return this._userThemesDir;
  }

  getInstalledFolderThemeId(destFolderPath) {
    for (const [id, entry] of this._themes) {
      if (!entry.builtin && entry.folderPath === destFolderPath) return id;
    }
    return null;
  }

  getInstalledFileThemeId(destFilePath) {
    const standalone = [...this._themes].filter(
      ([, e]) => !e.builtin && !e.folderPath,
    );
    const exact = standalone.find(
      ([id]) => GLib.path_get_basename(destFilePath) === `${id}.theme.js`,
    );
    return (exact ?? standalone[0])?.[0] ?? null;
  }

  async installThemeFolder(srcFolderPath) {
    const hasScript = listDir(srcFolderPath).some((e) =>
      e.name.endsWith(".theme.js"),
    );
    const hasMeta = GLib.file_test(
      GLib.build_filenamev([srcFolderPath, "metadata.json"]),
      GLib.FileTest.EXISTS,
    );
    if (!hasScript || !hasMeta) return null;

    const dest = GLib.build_filenamev([
      this._userThemesDir,
      GLib.path_get_basename(srcFolderPath),
    ]);
    try {
      copyDirRecursive(srcFolderPath, dest);
    } catch (e) {
      console.error(`Could not install theme folder: ${e.message}`);
      return null;
    }
    await this.reload();
    return dest;
  }

  async installThemeFile(srcPath) {
    const dest = GLib.build_filenamev([
      this._userThemesDir,
      GLib.path_get_basename(srcPath),
    ]);
    Gio.File.new_for_path(srcPath).copy(
      Gio.File.new_for_path(dest),
      Gio.FileCopyFlags.OVERWRITE,
      null,
      null,
    );
    await this.reload();
    return dest;
  }

  deleteUserTheme(themeId) {
    const entry = this._themes.get(themeId);
    if (!entry || entry.builtin) return false;

    rimraf(
      entry.folderPath ??
        GLib.build_filenamev([this._userThemesDir, `${themeId}.theme.js`]),
    );
    this._themes.delete(themeId);
    this._watchThemeDirs();
    return true;
  }

  exportThemeFile(themeId, destDir) {
    const entry = this._themes.get(themeId);
    if (!entry || entry.builtin) return null;

    if (entry.folderPath) {
      const dst = GLib.build_filenamev([
        destDir,
        GLib.path_get_basename(entry.folderPath),
      ]);
      copyDirRecursive(entry.folderPath, dst);
      return dst;
    }

    const name = `${themeId}.theme.js`;
    const dst = GLib.build_filenamev([destDir, name]);
    Gio.File.new_for_path(
      GLib.build_filenamev([this._userThemesDir, name]),
    ).copy(
      Gio.File.new_for_path(dst),
      Gio.FileCopyFlags.OVERWRITE,
      null,
      null,
    );
    return dst;
  }

  async installThemeFromUrl(target, cancellable, onProgress) {
    onProgress?.("downloading", 0, null);

    if (!target.single && target.subdir) {
      try {
        const result = await this._installSubdirViaApi(
          target,
          cancellable,
          onProgress,
        );
        if (result) return result;
      } catch (e) {
        if (cancellable?.is_cancelled()) throw e;
      }
    }

    const bytes = await fetchBytes(this._session, target.url, cancellable, (p) =>
      onProgress?.("downloading", p * 0.7, null),
    );

    if (target.single) {
      onProgress?.("installing", 0.85, null);
      const dest = GLib.build_filenamev([
        this._userThemesDir,
        GLib.path_get_basename(target.url),
      ]);
      GLib.file_set_contents(dest, bytes);
      await this.reload();
      onProgress?.("done", 1.0, null);
      return this._installResult(
        "file",
        dest,
        this.getInstalledFileThemeId(dest),
      );
    }

    const isTarGz = /\.(tar\.gz|tgz)$/.test(target.url);
    const tmpBase = GLib.build_filenamev([
      GLib.get_tmp_dir(),
      `amc-theme-${GLib.get_monotonic_time()}`,
    ]);
    const archivePath = tmpBase + (isTarGz ? ".tar.gz" : ".zip");
    const extractDir = `${tmpBase}-extracted`;

    try {
      GLib.file_set_contents(archivePath, bytes);

      onProgress?.("extracting", 0.72, null);
      await extractArchive(archivePath, extractDir, isTarGz);
      onProgress?.("extracting", 0.82, null);

      const searchRoot = target.subdir
        ? this._resolveSubdir(extractDir, target)
        : extractDir;

      onProgress?.("installing", 0.88, null);
      const themeFolder = scanForThemeFolderRecursive(searchRoot, 4);
      if (!themeFolder) throw new Error("no_theme_found");

      const dest = GLib.build_filenamev([
        this._userThemesDir,
        GLib.path_get_basename(themeFolder),
      ]);
      copyDirRecursive(themeFolder, dest);
      await this.reload();
      onProgress?.("done", 1.0, null);
      return this._installResult(
        "folder",
        dest,
        this.getInstalledFolderThemeId(dest),
      );
    } finally {
      rimraf(archivePath);
      rimraf(extractDir);
    }
  }

  _installResult(type, dest, id) {
    return {
      ok: true,
      type,
      dest,
      id,
      thumbFile: this._themes.get(id)?.thumbFile ?? null,
    };
  }

  _resolveSubdir(extractDir, { subdir, cbRepoName, cbBranch }) {
    const parts = subdir.split("/");
    const candidates = [GLib.build_filenamev([extractDir, ...parts])];

    if (cbRepoName && cbBranch)
      candidates.push(
        GLib.build_filenamev([
          extractDir,
          `${cbRepoName}-${cbBranch}`,
          ...parts,
        ]),
      );

    for (const { name, isDir } of listDir(extractDir)) {
      if (isDir)
        candidates.push(GLib.build_filenamev([extractDir, name, ...parts]));
    }

    const hit = candidates.find((p) => GLib.file_test(p, GLib.FileTest.IS_DIR));
    return (
      hit ?? findDirNamed(extractDir, parts[parts.length - 1], 6) ?? extractDir
    );
  }

  async _installSubdirViaApi(target, cancellable, onProgress) {
    const info = repoApiInfo(target.url, target.subdir);
    if (!info) return null;

    onProgress?.("listing", 0.05, null);

    const listing = new TextDecoder().decode(
      await fetchBytes(this._session, info.apiUrl, cancellable),
    );
    let parsed;
    try {
      parsed = JSON.parse(listing);
    } catch {
      return null;
    }

    const items = Array.isArray(parsed) ? parsed : parsed.tree;
    const files = (items ?? []).filter(
      (f) => f.type === "file" || f.type === "blob",
    );
    if (files.length === 0) return null;

    const destDir = GLib.build_filenamev([
      this._userThemesDir,
      target.subdir.split("/").pop(),
    ]);
    GLib.mkdir_with_parents(destDir, 0o755);

    let done = 0;
    try {
      await Promise.all(
        files.map(async (file) => {
          const name = GLib.path_get_basename(file.name ?? file.path ?? "");
          const url =
            file.download_url ?? `${info.rawBase}/${encodeURIComponent(name)}`;

          GLib.file_set_contents(
            GLib.build_filenamev([destDir, name]),
            await fetchBytes(this._session, url, cancellable),
          );

          done++;
          onProgress?.(
            "downloading",
            0.1 + (done / files.length) * 0.75,
            `${name} (${done}/${files.length})`,
          );
        }),
      );
    } catch (e) {
      rimraf(destDir);
      throw e;
    }

    onProgress?.("installing", 0.9, null);

    if (!scanForThemeFolderRecursive(destDir, 2)) {
      rimraf(destDir);
      return null;
    }

    await this.reload();
    onProgress?.("done", 1.0, null);
    return this._installResult(
      "folder",
      destDir,
      this.getInstalledFolderThemeId(destDir),
    );
  }

  destroy() {
    this._reloadCancellable?.cancel();
    this._reloadCancellable = null;
    this._session?.abort();
    this._session = null;
    this.onThemesChanged = null;
    if (this._reloadTimer) {
      GLib.Source.remove(this._reloadTimer);
      this._reloadTimer = 0;
    }
    this._unwatchThemeDirs();
    this._themes.clear();
  }
}