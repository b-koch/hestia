import Gio from "gi://Gio";
import Clutter from "gi://Clutter";

export const _iconCache = new Map();
const _monoCache = new Map();

const _IDENTITY_DESKTOP_MAP = new Map([
  ["firefox", "firefox.desktop"],
  ["firefox esr", "firefox-esr.desktop"],
  ["firefox nightly", "firefox-nightly.desktop"],
  ["mozilla firefox", "firefox.desktop"],
  ["thunderbird", "thunderbird.desktop"],
  ["mozilla thunderbird", "thunderbird.desktop"],
  ["chromium", "chromium.desktop"],
  ["chromium-browser", "chromium-browser.desktop"],
  ["google chrome", "google-chrome.desktop"],
  ["brave", "brave-browser.desktop"],
  ["brave browser", "brave-browser.desktop"],
  ["vivaldi", "vivaldi.desktop"],
  ["opera", "opera.desktop"],
  ["spotify", "spotify.desktop"],
  ["vlc media player", "vlc.desktop"],
  ["vlc", "vlc.desktop"],
  ["rhythmbox", "rhythmbox.desktop"],
  ["clementine", "clementine.desktop"],
  ["strawberry", "strawberry.desktop"],
  ["lollypop", "org.gnome.Lollypop.desktop"],
  ["mpv", "mpv.desktop"],
  ["celluloid", "io.codeberg.celluloid_player.Celluloid.desktop"],
  ["totem", "org.gnome.Totem.desktop"],
]);

const _SKIP = new Set([
  "org", "com", "net", "io", "app", "application", "browser", "client",
  "player", "media", "desktop", "instance", "snap", "flatpak", "gnome",
  "kde", "stable", "beta", "nightly", "dev", "bin", "linux", "project",
  "free", "open",
]);

function _getIdentity(playerName, manager) {
  if (!manager || !playerName) return "";
  try {
    const identity = manager._identities && manager._identities.get(playerName);
    return identity ? identity.trim().toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

function _identityToDesktopId(identity) {
  if (!identity) return null;
  if (_IDENTITY_DESKTOP_MAP.has(identity))
    return _IDENTITY_DESKTOP_MAP.get(identity);
  const first = identity.split(/\s+/)[0];
  if (first && _IDENTITY_DESKTOP_MAP.has(first))
    return _IDENTITY_DESKTOP_MAP.get(first);
  return null;
}

function _scoreApp(app, segments, exact, identity) {
  let score = 0;
  try {
    const rawId = (app.get_id() || "").toLowerCase();
    const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
    const dn = (app.get_display_name() || "").toLowerCase();
    const exec = (app.get_executable() || "").toLowerCase().trim();

    if (exact.has(rawId) || exact.has(noSuffix)) score += 100;

    for (const seg of noSuffix.split(".")) {
      if (seg.length > 2 && segments.has(seg)) score += 40;
    }

    const dnFirst = dn.split(/\s+/)[0];
    const dnNoSpace = dn.replace(/\s+/g, "");
    if (dnFirst.length > 2 && segments.has(dnFirst)) score += 35;
    if (dnNoSpace.length > 2 && segments.has(dnNoSpace)) score += 30;

    if (exec.length > 2 && segments.has(exec)) score += 25;
    for (const part of exec.split(/[-_]/)) {
      if (part.length > 2 && segments.has(part)) score += 15;
    }

    const snapParts = noSuffix.split("_");
    if (snapParts.length >= 2 && snapParts[0].length > 2 && segments.has(snapParts[0]))
      score += 20;

    if (identity) {
      const idFirst = identity.split(/\s+/)[0];
      if (dn.includes(idFirst) || noSuffix.includes(idFirst)) score += 50;
      else score -= 80;
    }
  } catch (_) {}
  return score;
}

export function _buildCandidateTokens(playerName, manager) {
  const exact = new Set();
  const segments = new Set();

  const _add = (str) => {
    if (!str) return;
    const lower = str.toLowerCase().trim();
    if (!lower) return;

    exact.add(lower);
    if (lower.endsWith(".desktop")) {
      exact.add(lower.slice(0, -8));
    } else {
      exact.add(`${lower}.desktop`);
    }

    const base = lower.replace(/\.desktop$/, "");
    for (const seg of base.split(".")) {
      if (seg.length > 2 && !_SKIP.has(seg)) segments.add(seg);
    }

    const hParts = base.split(/[-_]/);
    if (hParts.length > 1) {
      for (const p of hParts) {
        if (p.length > 2 && !_SKIP.has(p)) segments.add(p);
      }
      const joined = hParts.filter((p) => !_SKIP.has(p)).join("");
      if (joined.length > 2) segments.add(joined);
    }
  };

  if (manager) {
    const de = manager._desktopEntries && manager._desktopEntries.get(playerName);
    if (de) _add(de);
  }

  if (!playerName) return { exact, segments };

  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw
    .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, "")
    .replace(/[-_]stable$/i, "")
    .replace(/[-_]beta$/i, "")
    .replace(/[-_]nightly$/i, "")
    .replace(/[-_]esr$/i, "");

  _add(clean);

  const dotTail = clean.split(".").pop();
  if (dotTail && dotTail !== clean) {
    _add(dotTail);
    _add(`${dotTail}_${dotTail}`);
  }

  const dotParts = clean.split(".");
  if (dotParts.length >= 3) {
    const last2 = dotParts.slice(-2).join("").toLowerCase();
    if (last2.length > 3 && !_SKIP.has(last2)) segments.add(last2);
  }

  const identity = _getIdentity(playerName, manager);
  if (identity) {
    const norm = identity.replace(/\s+/g, "");
    const first = identity.split(/\s+/)[0];
    if (norm.length > 2) segments.add(norm);
    if (first.length > 2) segments.add(first);
  }

  return { exact, segments };
}

export function resolveGicon(playerName, manager) {
  const identity = _getIdentity(playerName, manager);

  if (manager) {
    try {
      const ai = manager.getAppInfo(playerName);
      if (ai) {
        const safe = _appMatchesIdentity(ai, identity);
        if (safe) {
          const gi = ai.get_icon();
          if (gi) return gi;
        }
      }
    } catch (_) {}
  }

  if (!_iconCache.has(playerName)) {
    const knownId = _identityToDesktopId(identity);
    if (knownId) {
      try {
        const allApps = Gio.AppInfo.get_all();
        for (const app of allApps) {
          const rawId = (app.get_id() || "").toLowerCase();
          if (rawId === knownId || rawId === knownId.replace(/\.desktop$/, "")) {
            const gi = app.get_icon();
            if (gi) {
              _iconCache.set(playerName, gi);
              break;
            }
          }
        }
      } catch (_) {}
    }
  }

  if (!_iconCache.has(playerName)) {
    _iconCache.set(playerName, null);
    try {
      const cand = _buildCandidateTokens(playerName, manager);
      const allApps = Gio.AppInfo.get_all();
      let bestApp = null;
      let bestScore = 0;

      for (const app of allApps) {
        const score = _scoreApp(app, cand.segments, cand.exact, identity);
        if (score > 0 && score > bestScore) {
          bestScore = score;
          bestApp = app;
        }
      }

      if (bestApp) {
        const gi = bestApp.get_icon();
        if (gi) _iconCache.set(playerName, gi);
      }
    } catch (_) {}
  }

  const cached = _iconCache.get(playerName);
  if (cached) return cached;

  if (playerName) {
    const tail = playerName
      .replace(/^org\.mpris\.MediaPlayer2\./, "")
      .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\.snap$/i, "")
      .split(".")
      .pop()
      .toLowerCase();
    if (tail && tail.length > 1) return Gio.ThemedIcon.new(tail);
  }

  return Gio.ThemedIcon.new("audio-x-generic-symbolic");
}

/**
 * Returns a monochrome-friendly Gio.Icon for the given player.
 *
 * Strategy (in priority order):
 *   1. If the colour icon is a Gio.ThemedIcon, try appending "-symbolic" to
 *      each of its names. Shell's icon theme will return the symbolic variant
 *      if one exists, or fall back automatically to the colour icon.
 *      We therefore always return the symbolic-names ThemedIcon — the icon
 *      theme handles the graceful fallback.
 *   2. For Gio.FileIcon (e.g. Spotify's bundled PNG), there is no symbolic
 *      variant available; return the colour icon and let the caller apply
 *      a Clutter.DesaturateEffect instead.
 *
 * Results are cached in _monoCache keyed by playerName.
 */
export function resolveMonochromeGicon(playerName, manager) {
  if (_monoCache.has(playerName)) return _monoCache.get(playerName);

  const colour = resolveGicon(playerName, manager);

  let mono = colour;

  if (colour instanceof Gio.ThemedIcon) {
    const names = colour.get_names();
    const symbolicNames = [];
    for (const name of names) {
      if (!name.endsWith("-symbolic")) symbolicNames.push(`${name}-symbolic`);
      symbolicNames.push(name);
    }
    mono = Gio.ThemedIcon.new_from_names(symbolicNames);
  }

  _monoCache.set(playerName, mono);
  return mono;
}

/**
 * Apply or remove monochrome rendering on an St.Icon actor.
 *
 * For Gio.ThemedIcon: switches between the colour gicon and the symbolic
 * variant (which the Shell theme desaturates automatically).
 * For Gio.FileIcon (bundled PNGs): adds/removes a Clutter.DesaturateEffect
 * so the rendered pixbuf is desaturated in-place without reloading.
 *
 * @param {import("gi://St").Icon} stIcon      The St.Icon actor to modify
 * @param {Gio.Icon}               colourGicon The original colour Gio.Icon
 * @param {string|null}            playerName  MPRIS bus name (for cache key)
 * @param {object|null}            manager     MprisManager instance
 * @param {boolean}                monochrome  true = monochrome, false = colour
 */
export function applyMonochromeToIcon(stIcon, colourGicon, playerName, manager, monochrome) {
  if (!stIcon) return;

  try {
    if (colourGicon instanceof Gio.ThemedIcon) {
      if (monochrome) {
        stIcon.gicon = resolveMonochromeGicon(playerName, manager);
      } else {
        stIcon.gicon = colourGicon;
      }
      _removeDesaturateEffect(stIcon);
      return;
    }

    if (colourGicon instanceof Gio.FileIcon) {
      stIcon.gicon = colourGicon;
      if (monochrome) {
        _ensureDesaturateEffect(stIcon);
      } else {
        _removeDesaturateEffect(stIcon);
      }
    }
  } catch (_) {}
}

function _ensureDesaturateEffect(actor) {
  if (!actor.get_effect("amc-desaturate")) {
    const fx = new Clutter.DesaturateEffect({ factor: 1.0 });
    actor.add_effect_with_name("amc-desaturate", fx);
  }
}

function _removeDesaturateEffect(actor) {
  if (actor.get_effect("amc-desaturate"))
    actor.remove_effect_by_name("amc-desaturate");
}

function _appMatchesIdentity(app, identity) {
  if (!identity) return true;
  try {
    const dn = (app.get_display_name() || "").toLowerCase();
    const id = (app.get_id() || "").toLowerCase();
    const exc = (app.get_executable() || "").toLowerCase();
    const first = identity.split(/\s+/)[0];
    return dn.includes(first) || id.includes(first) || exc.includes(first);
  } catch (_) {
    return true;
  }
}

export function resolveDisplayName(playerName, manager) {
  if (manager) {
    try {
      const identity = manager._identities && manager._identities.get(playerName);
      if (identity && identity.trim()) return identity.trim();
    } catch (_) {}
  }

  try {
    if (manager) {
      const identity = _getIdentity(playerName, manager);
      const ai = manager.getAppInfo(playerName);
      if (ai && _appMatchesIdentity(ai, identity)) {
        const n = ai.get_display_name();
        if (n) return n;
      }
    }

    const cand = _buildCandidateTokens(playerName, manager);
    const allApps = Gio.AppInfo.get_all();

    for (const app of allApps) {
      const rawId = (app.get_id() || "").toLowerCase();
      const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
      if (cand.exact.has(rawId) || cand.exact.has(noSuffix)) {
        const n = app.get_display_name();
        if (n) return n;
      }
    }
  } catch (_) {}

  if (playerName) {
    const tail = playerName
      .replace(/^org\.mpris\.MediaPlayer2\./, "")
      .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\.snap$/i, "")
      .split(".")
      .pop();
    if (tail) return tail.charAt(0).toUpperCase() + tail.slice(1);
  }

  return "Unknown";
}

export function clearIconCache() {
  _iconCache.clear();
  _monoCache.clear();
}