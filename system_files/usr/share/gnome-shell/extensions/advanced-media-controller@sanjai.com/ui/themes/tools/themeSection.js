import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { normaliseThemeUrl } from "../../../utils/core/ThemeEngine.js";
import { showThemeInfoDialog } from "../themeInfoDialog.js";
import {
  resolveGifPath,
  loadFirstFrame,
  drawCirclePixbuf,
} from "../helpers/previewHelpers.js";
import {
  makeIcon,
  openUri,
  linkRow,
  presentDialog,
} from "../helpers/widgets.js";
import {
  USER_THEMES_DIR,
  SAMPLE_THEME_SRC,
  THUMB_SIZE,
  PRESET_GIFS,
  TAU,
} from "../constants.js";

const DOCS_URL =
  "https://codeberg.org/sanjai-shaarugesh/Advanced-media-controller/src/branch/main/THEME_SYSTEM.md";
const SHARING_URL =
  "https://codeberg.org/sanjai-shaarugesh/Advanced-media-controller/src/branch/main/THEMES.md";

const PRESET_MEDIA = Object.fromEntries(
  PRESET_GIFS.map((p) => [p.themeId, p.file]),
);

const subtitleFor = (t) => {
  if (t.builtin) return _("Built-in");
  return (
    [t.author, t.version && `v${t.version}`]
      .filter(Boolean)
      .join("  \u00b7  ") || _("User theme")
  );
};

const hasInfo = (t) =>
  !t.builtin && Boolean(t.author || t.version || t.description || t.repoUrl);

function themePixbuf(t, extensionDir) {
  const media =
    PRESET_MEDIA[t.id] && resolveGifPath(extensionDir, PRESET_MEDIA[t.id]);
  return loadFirstFrame(t.thumbFile ?? media, THUMB_SIZE);
}

function makeThumb(t, themeEngine, extensionDir) {
  const size = THUMB_SIZE;
  const pixbuf = themePixbuf(t, extensionDir);
  const theme = themeEngine.getThemeEntry(t.id)?.theme;

  const area = new Gtk.DrawingArea({
    content_width: size,
    content_height: size,
    valign: Gtk.Align.CENTER,
  });

  if (typeof theme?.drawThumb === "function") {
    let offset = 0;
    let reported = false;
    area.set_draw_func((_area, cr) => {
      try {
        theme.drawThumb({
          cr,
          size,
          offset,
          pixbuf,
          ratio: 0.5,
          isPlaying: true,
          cx: size / 2,
          cy: size / 2,
          r: size / 2 - 1,
        });
      } catch (e) {
        if (!reported) {
          reported = true;
          console.error(`Theme "${t.id}" failed to draw thumb: ${e.message}`);
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
    area.set_draw_func((_area, cr) =>
      drawCirclePixbuf(cr, pixbuf, size / 2, size / 2, size / 2),
    );
  } else {
    area.set_draw_func((_area, cr) => {
      const c = size / 2;
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

function findScrolled(widget) {
  for (
    let child = widget.get_first_child();
    child;
    child = child.get_next_sibling()
  ) {
    if (child instanceof Gtk.ScrolledWindow) return child;
    const found = findScrolled(child);
    if (found) return found;
  }
  return null;
}

function chainScroll(inner, page) {
  const controller = new Gtk.EventControllerScroll({
    flags: Gtk.EventControllerScrollFlags.VERTICAL,
    propagation_phase: Gtk.PropagationPhase.CAPTURE,
  });
  controller.connect("scroll", (_ctrl, _dx, dy) => {
    const outer = findScrolled(page)?.vadjustment;
    if (!outer) return Gdk.EVENT_PROPAGATE;

    const adj = inner.vadjustment;
    const atTop = adj.value <= adj.lower + 0.5;
    const atBottom = adj.value >= adj.upper - adj.page_size - 0.5;
    if ((dy < 0 && !atTop) || (dy > 0 && !atBottom))
      return Gdk.EVENT_PROPAGATE;

    const next = outer.value + dy * Math.pow(outer.page_size, 2 / 3);
    outer.value = Math.min(
      outer.upper - outer.page_size,
      Math.max(outer.lower, next),
    );
    return Gdk.EVENT_STOP;
  });
  inner.add_controller(controller);
}

function chooseFolder(page, title, callback) {
  const dialog = new Gtk.FileDialog({ title, modal: true });
  dialog.select_folder(page.get_root(), null, (_dlg, result) => {
    let folder;
    try {
      folder = dialog.select_folder_finish(result);
    } catch {
      return;
    }
    callback(folder.get_path());
  });
}

function chooseThemeFile(page, callback) {
  const filter = new Gtk.FileFilter({ name: _("Theme files (*.theme.js)") });
  filter.add_pattern("*.theme.js");

  const filters = Gio.ListStore.new(Gtk.FileFilter);
  filters.append(filter);

  const dialog = new Gtk.FileDialog({
    title: _("Choose a .theme.js file"),
    modal: true,
    filters,
    default_filter: filter,
  });
  dialog.open(page.get_root(), null, (_dlg, result) => {
    let file;
    try {
      file = dialog.open_finish(result);
    } catch {
      return;
    }
    callback(file.get_path());
  });
}

export function buildThemeGroup(
  page,
  settings,
  themeEngine,
  previewArea,
  applyThemeThumb,
  getCurrentThemeId,
  cleanups,
  extensionDir,
) {
  let scrollResetId = 0;
  cleanups.push(() => {
    if (scrollResetId) GLib.Source.remove(scrollResetId);
  });

  const themeGroup = new Adw.PreferencesGroup({
    title: _("Themes"),
    description: _("Choose a built-in theme or install a custom one"),
  });
  page.add(themeGroup);

  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    css_classes: ["boxed-list"],
  });
  const scroll = new Gtk.ScrolledWindow({
    min_content_height: 360,
    max_content_height: 620,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    margin_top: 2,
    margin_bottom: 2,
    child: listBox,
  });
  chainScroll(scroll, page);
  const scrollRow = new Adw.ActionRow({ activatable: false });
  scrollRow.set_child(scroll);
  themeGroup.add(scrollRow);

  const useTheme = (id) => {
    if (!id) return;

    settings.set_string("progress-theme-id", id);
    themeEngine.setActiveTheme(id);
    const thumbFile =
      themeEngine.getThemeEntry(id)?.thumbFile ??
      (PRESET_MEDIA[id] && resolveGifPath(extensionDir, PRESET_MEDIA[id]));
    if (thumbFile) applyThemeThumb({ thumbFile });
    previewArea.queue_draw();
  };

  const buildRow = (t, isActive) => {
    const row = new Adw.ActionRow({
      title: t.label,
      subtitle: subtitleFor(t),
      activatable: !isActive,
      use_markup: false,
    });
    if (isActive) row.add_css_class("accent");

    row.add_prefix(makeThumb(t, themeEngine, extensionDir));
    row.add_prefix(
      new Gtk.CheckButton({
        valign: Gtk.Align.CENTER,
        active: isActive,
        can_target: false,
        can_focus: false,
      }),
    );
    row.connect("activated", () => useTheme(t.id));

    const actions = new Gtk.Box({ valign: Gtk.Align.CENTER });
    const addAction = (icon, tooltip, onClick, extraClass) => {
      const btn = new Gtk.Button({
        icon_name: icon,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
        css_classes: extraClass ? ["flat", extraClass] : ["flat"],
      });
      btn.connect("clicked", onClick);
      actions.append(btn);
    };

    if (!t.builtin && t.repoUrl)
      addAction("web-browser-symbolic", t.repoUrl, () => openUri(t.repoUrl));

    if (!t.builtin) {
      addAction("document-save-symbolic", _("Export theme"), () => {
        chooseFolder(page, _("Save theme folder\u2026"), (path) =>
          themeEngine.exportThemeFile(t.id, path),
        );
      });
      addAction(
        "user-trash-symbolic",
        _("Remove theme"),
        () => confirmRemoval(t),
        "destructive-action",
      );
    }

    if (hasInfo(t))
      addAction("dialog-information-symbolic", _("Theme info"), () =>
        showThemeInfoDialog(page, t, themeEngine),
      );

    if (actions.get_first_child()) row.add_suffix(actions);

    return row;
  };

  const rebuildRows = () => {
    const currentId = getCurrentThemeId();
    const all = themeEngine.listThemes();
    const ordered = [
      ...all.filter((t) => t.id === currentId),
      ...all.filter((t) => t.id !== currentId),
    ];

    listBox.remove_all();
    for (const t of ordered) listBox.append(buildRow(t, t.id === currentId));

    if (scrollResetId) GLib.Source.remove(scrollResetId);
    scrollResetId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      scrollResetId = 0;
      scroll.vadjustment.set_value(0);
      return GLib.SOURCE_REMOVE;
    });
  };

  const confirmRemoval = (t) => {
    presentDialog(page, {
      heading: _("Remove \u201c%s\u201d?").format(t.label),
      body: _("This will permanently delete the theme files."),
      responses: [
        ["cancel", _("Cancel")],
        ["delete", _("Delete"), Adw.ResponseAppearance.DESTRUCTIVE],
      ],
      defaultResponse: "cancel",
      closeResponse: "cancel",
      onResponse: (response) => {
        if (response !== "delete") return;
        themeEngine.deleteUserTheme(t.id);
        if (getCurrentThemeId() === t.id)
          settings.set_string("progress-theme-id", "default");
        rebuildRows();
      },
    });
  };

  rebuildRows();
  themeEngine.onThemesChanged = rebuildRows;
  cleanups.push(() => {
    themeEngine.onThemesChanged = null;
  });

  const themeChangedId = settings.connect("changed::progress-theme-id", () => {
    themeEngine.setActiveTheme(getCurrentThemeId());
    previewArea.queue_draw();
    rebuildRows();
  });
  cleanups.push(() => settings.disconnect(themeChangedId));

  const installGroup = new Adw.PreferencesGroup({ title: _("Install Themes") });
  page.add(installGroup);

  installGroup.add(
    linkRow({
      title: _("Install Theme Folder"),
      subtitle: _("Folder with a .theme.js file (and optional metadata.json)"),
      icon: "folder-open-symbolic",
      onActivate: () =>
        chooseFolder(page, _("Choose a theme folder"), async (path) => {
          const dest = await themeEngine.installThemeFolder(path);
          if (!dest) {
            presentDialog(page, {
              heading: _("Install failed"),
              body: _(
                "The folder must contain a .theme.js file and a metadata.json.",
              ),
              responses: [["close", _("OK")]],
            });
            return;
          }
          useTheme(themeEngine.getInstalledFolderThemeId(dest));
        }),
    }),
  );

  installGroup.add(
    linkRow({
      title: _("Install .theme.js File"),
      subtitle: _("Single-file theme without metadata"),
      icon: "document-open-symbolic",
      onActivate: () =>
        chooseThemeFile(page, async (path) => {
          const dest = await themeEngine.installThemeFile(path);
          if (dest) useTheme(themeEngine.getInstalledFileThemeId(dest));
        }),
    }),
  );

  installGroup.add(
    linkRow({
      title: _("Install from URL"),
      subtitle: _(
        "GitHub, Codeberg, GitLab \u2014 repo, subfolder, or raw .theme.js",
      ),
      icon: "network-receive-symbolic",
      onActivate: () => openUrlInstaller(),
    }),
  );

  const openUrlInstaller = () => {
    const stageLabels = {
      listing: _("Listing files\u2026"),
      downloading: _("Downloading\u2026"),
      extracting: _("Extracting\u2026"),
      installing: _("Installing\u2026"),
      done: _("Done"),
    };
    const errorLabels = {
      empty_response: _(
        "The server returned an empty response. Check the URL.",
      ),
      extract_failed: _(
        "Could not extract the archive. Ensure \u2018unzip\u2019 or \u2018tar\u2019 is installed.",
      ),
      no_theme_found: _(
        "No theme found. The folder must contain a .theme.js file.",
      ),
    };

    const intro = new Gtk.Label({
      label: _(
        "Paste a GitHub, Codeberg, or GitLab repo, subfolder, or direct .theme.js URL.",
      ),
      wrap: true,
      xalign: 0,
    });
    const urlEntry = new Gtk.Entry({
      placeholder_text: _("https://codeberg.org/user/repo"),
      hexpand: true,
    });
    const progressBar = new Gtk.ProgressBar({
      visible: false,
      show_text: true,
    });
    const detailLabel = new Gtk.Label({
      xalign: 0,
      visible: false,
      css_classes: ["caption", "dim-label"],
    });
    const statusLabel = new Gtk.Label({
      xalign: 0,
      wrap: true,
      visible: false,
    });

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 10,
      margin_top: 12,
      margin_bottom: 18,
      margin_start: 18,
      margin_end: 18,
    });
    for (const w of [intro, urlEntry, progressBar, detailLabel, statusLabel])
      body.append(w);

    const cancelBtn = new Gtk.Button({ label: _("Cancel") });
    const installBtn = new Gtk.Button({
      label: _("Install"),
      css_classes: ["suggested-action"],
    });
    const header = new Adw.HeaderBar({
      show_start_title_buttons: false,
      show_end_title_buttons: false,
    });
    header.pack_start(cancelBtn);
    header.pack_end(installBtn);

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    content.append(header);
    content.append(body);

    const win = new Adw.Window({
      title: _("Install Theme from URL"),
      modal: true,
      transient_for: page.get_root(),
      default_width: 440,
      resizable: false,
      content,
    });

    let cancellable = null;
    const abort = () => {
      cancellable?.cancel();
      cancellable = null;
    };
    cleanups.push(abort);

    const setStatus = (message, isError = false) => {
      statusLabel.label = message;
      statusLabel.css_classes = isError ? ["error"] : ["dim-label"];
      statusLabel.visible = message !== "";
    };

    const setBusy = (busy) => {
      urlEntry.sensitive = !busy;
      installBtn.sensitive = !busy;
      progressBar.visible = busy;
      if (!busy) detailLabel.visible = false;
    };

    const install = () => {
      if (!urlEntry.text.trim()) return;

      const target = normaliseThemeUrl(urlEntry.text);
      if (!target.ok) {
        setStatus(
          _("Unrecognised URL. Paste a GitHub, Codeberg, or GitLab link."),
          true,
        );
        return;
      }

      setStatus("");
      setBusy(true);
      progressBar.fraction = 0;
      progressBar.text = _("Starting\u2026");

      const current = new Gio.Cancellable();
      cancellable = current;

      const onProgress = (stage, fraction, detail) => {
        if (current.is_cancelled()) return;
        progressBar.fraction = Math.min(1, Math.max(0, fraction));
        progressBar.text = stageLabels[stage] ?? stage;
        detailLabel.label = detail ?? "";
        detailLabel.visible = Boolean(detail);
      };

      themeEngine
        .installThemeFromUrl(target, current, onProgress)
        .then((result) => {
          if (current.is_cancelled()) return;
          cancellable = null;
          win.close();
          useTheme(result.id);
        })
        .catch((error) => {
          if (current.is_cancelled()) return;
          cancellable = null;
          setBusy(false);
          setStatus(
            errorLabels[error.message] ??
              _("Download failed: %s").format(error.message),
            true,
          );
        });
    };

    const keys = new Gtk.EventControllerKey();
    keys.connect("key-pressed", (_ctrl, keyval) => {
      if (keyval !== Gdk.KEY_Escape) return false;
      win.close();
      return true;
    });
    win.add_controller(keys);

    win.connect("close-request", () => {
      abort();
      return false;
    });
    cancelBtn.connect("clicked", () => win.close());
    installBtn.connect("clicked", install);
    urlEntry.connect("activate", install);

    win.present();
    urlEntry.grab_focus();
  };

  const authoringGroup = new Adw.PreferencesGroup({ title: _("Authoring") });
  page.add(authoringGroup);

  authoringGroup.add(
    linkRow({
      title: _("Create New Theme"),
      subtitle: _("Save a starter .theme.js template to the themes folder"),
      icon: "document-new-symbolic",
      trailing: null,
      onActivate: async () => {
        const path = GLib.build_filenamev([
          USER_THEMES_DIR,
          "my-custom-theme.theme.js",
        ]);

        try {
          GLib.mkdir_with_parents(USER_THEMES_DIR, 0o755);
          if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            GLib.file_set_contents(path, SAMPLE_THEME_SRC);
        } catch (e) {
          presentDialog(page, {
            heading: _("Could not create the theme"),
            body: e.message,
            responses: [["close", _("OK")]],
          });
          return;
        }

        await themeEngine.reload();
        presentDialog(page, {
          heading: _("Theme file created"),
          body: _("Edit the file to create your custom theme:\n%s").format(
            path,
          ),
          responses: [
            ["open", _("Open Folder")],
            ["close", _("OK")],
          ],
          defaultResponse: "close",
          closeResponse: "close",
          onResponse: (response) => {
            if (response === "open")
              openUri(Gio.File.new_for_path(USER_THEMES_DIR).get_uri());
          },
        });
      },
    }),
  );

  authoringGroup.add(
    linkRow({
      title: _("Open Themes Folder"),
      subtitle: USER_THEMES_DIR,
      icon: "folder-open-symbolic",
      trailing: null,
      onActivate: () =>
        openUri(Gio.File.new_for_path(USER_THEMES_DIR).get_uri()),
    }),
  );

  authoringGroup.add(
    linkRow({
      title: _("Theme Authoring Guide"),
      subtitle: _("How to create and share custom themes"),
      icon: "help-contents-symbolic",
      trailing: "web-browser-symbolic",
      onActivate: () => openUri(DOCS_URL),
    }),
  );

  authoringGroup.add(
    linkRow({
      title: _("Theme Installation & Sharing Guide"),
      subtitle: _("Learn how to install and share themes"),
      icon: "emblem-shared-symbolic",
      trailing: "web-browser-symbolic",
      onActivate: () => openUri(SHARING_URL),
    }),
  );
}