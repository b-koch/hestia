#!/usr/bin/env python3
"""
steam-art-fetch.py

Fetches official Steam library artwork (hero, logo, portrait grid, capsule,
icon) and applies it to Steam library entries -- primarily non-Steam
shortcuts, which Steam never fetches art for on its own.

Everything (image references AND the logo's default position/size) is read
from a single source: Valve's own per-app "appinfo" data, fetched over an
anonymous Steam client session (the same mechanism the real Steam client and
SteamDB itself use -- no scraping of any third-party site involved).

Non-Steam shortcuts don't carry a real Steam App ID (they get a large
synthetic one instead), so for those the script suggests a real App ID via
Steam's official store search, asks you to confirm it, and remembers your
answer in a local cache file so you're never asked twice for the same game.

Icons are handled separately from the rest of the art: Steam ships them as
.jpg, so they're converted to .png locally. They're stored inside the
non-Steam game's own compatdata/<appid>/ prefix when one already exists, so
deleting that prefix later (e.g. with a cleanup script) removes the icon
automatically too. If no prefix exists yet, they fall back to a small local
data directory instead.

Dependencies (install with pip):
    pip install --break-system-packages "steam[client]" vdf requests pillow

Usage:
    ./steam-art-fetch.py [options]

Options:
    --steam-dir PATH        Steam installation root (auto-detected if omitted)
    --compatdata-dir PATH   compatdata directory (auto-detected if omitted)
    --only ID_OR_NAME       Only process this app (repeatable). For real Steam
                            games you can pass either the shortcut's own
                            (huge) ID or a substring of its name.
    --include-real-games    Also (re)fetch art for real, already-owned/
                            installed Steam games. Normally skipped, since
                            Steam already manages their library art itself --
                            this is only useful for repairing missing/broken
                            local art.
    --force                 Overwrite art files that already exist locally
                            (default: skip apps that already have art)
    --dry-run               Show what would happen, fetch info, but do not
                            download, write, or modify anything
    --yes                   Don't prompt per app; still requires a confident
                            single search match to auto-resolve a shortcut's
                            real App ID, and always still confirms before
                            writing shortcuts.vdf
    --reset-mapping-cache   Reset the mapping cache that maps the Non-Steam
                            AppID to the real Steam ID
    -h, --help
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency check (clear error instead of a raw traceback)
# ---------------------------------------------------------------------------
MISSING = []
try:
    import vdf
except ImportError:
    MISSING.append("vdf")
try:
    import requests
except ImportError:
    MISSING.append("requests")
try:
    from PIL import Image
except ImportError:
    MISSING.append("pillow")
try:
    from steam.client import SteamClient
    from steam.enums import EResult
except ImportError:
    MISSING.append('"steam[client]"')

if MISSING:
    print("Missing dependencies: " + ", ".join(MISSING), file=sys.stderr)
    print(
        "Install with:\n"
        '  pip install --break-system-packages "steam[client]" vdf requests pillow',
        file=sys.stderr,
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
IS_TTY = sys.stdout.isatty()


def _c(code):
    return code if IS_TTY else ""


C_RESET = _c("\033[0m")
C_BOLD = _c("\033[1m")
C_RED = _c("\033[31m")
C_GREEN = _c("\033[32m")
C_YELLOW = _c("\033[33m")
C_CYAN = _c("\033[36m")
C_DIM = _c("\033[2m")


def log(msg=""):
    print(msg)


def info(msg):
    print(f"{C_CYAN}[*]{C_RESET} {msg}")


def warn(msg):
    print(f"{C_YELLOW}[!]{C_RESET} {msg}")


def err(msg):
    print(f"{C_RED}[x]{C_RESET} {msg}", file=sys.stderr)


def ok(msg):
    print(f"{C_GREEN}[+]{C_RESET} {msg}")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
STORE_CDN_BASE = "https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{filename}"
COMMUNITY_CDN_BASE = (
    "https://shared.steamstatic.com/community_assets/images/apps/{appid}/{hash}.jpg"
)
COMMUNITY_ICON_CDN_BASE = (
    "https://shared.steamstatic.com/community_assets/images/apps/{appid}/{hash}.ico"
)
STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/"

DEFAULT_LOGO_POSITION = {
    "nVersion": 1,
    "logoPosition": {"pinnedPosition": "BottomLeft", "nWidthPct": 40, "nHeightPct": 40},
}

DATA_DIR = Path.home() / ".local" / "share" / "steam-art-fetch"
MAPPING_FILE = DATA_DIR / "appid-mappings.json"
ICON_FALLBACK_DIR = DATA_DIR / "icons"

NONSTEAM_ID_MIN = 2147483648 


# ---------------------------------------------------------------------------
# Steam path discovery
# ---------------------------------------------------------------------------
def find_steam_root() -> Path | None:
    candidates = [
        Path.home() / ".local/share/Steam",
        Path.home() / ".steam/steam",
        Path.home() / ".steam/root",
        Path.home() / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
    ]
    for c in candidates:
        if (c / "userdata").is_dir():
            return c
    return None


def find_compatdata_dir(steam_root: Path) -> Path | None:
    d = steam_root / "steamapps" / "compatdata"
    return d if d.is_dir() else None


def choose_userdata_profile(steam_root: Path, assume_yes: bool) -> Path:
    userdata = steam_root / "userdata"
    profiles = [p for p in userdata.iterdir() if p.is_dir() and (p / "config").is_dir()]
    if not profiles:
        err(f"No user profiles found under {userdata}")
        sys.exit(1)
    if len(profiles) == 1:
        return profiles[0]
    info("Multiple Steam profiles found:")
    for i, p in enumerate(profiles, 1):
        log(f"  {i}) {p.name}")
    if assume_yes:
        warn("Multiple profiles and --yes given, using the first one.")
        return profiles[0]
    sel = input(f"Select one [1-{len(profiles)}]: ").strip()
    try:
        idx = int(sel) - 1
        if not (0 <= idx < len(profiles)):
            raise ValueError
    except ValueError:
        err("Invalid selection.")
        sys.exit(1)
    return profiles[idx]


# ---------------------------------------------------------------------------
# Real Steam games: parse appmanifest_*.acf across all library folders
# ---------------------------------------------------------------------------
def collect_real_games(steamapps_dir: Path) -> dict[int, str]:
    games: dict[int, str] = {}

    def scan(dir_: Path):
        if not dir_.is_dir():
            return
        for f in dir_.glob("appmanifest_*.acf"):
            try:
                data = vdf.load(open(f, encoding="utf-8", errors="ignore"))
                app = data.get("AppState", {})
                appid = int(app.get("appid", 0))
                name = app.get("name")
                if appid and name:
                    games[appid] = name
            except Exception as e:
                warn(f"Could not parse {f}: {e}")

    scan(steamapps_dir)
    libfolders = steamapps_dir / "libraryfolders.vdf"
    if libfolders.is_file():
        try:
            data = vdf.load(open(libfolders, encoding="utf-8", errors="ignore"))
            for entry in data.get("libraryfolders", {}).values():
                if isinstance(entry, dict) and "path" in entry:
                    scan(Path(entry["path"]) / "steamapps")
        except Exception as e:
            warn(f"Could not parse {libfolders}: {e}")

    return games


# ---------------------------------------------------------------------------
# Non-Steam shortcuts: parse shortcuts.vdf (binary format)
# ---------------------------------------------------------------------------
def to_unsigned32(n: int) -> int:
    return n & 0xFFFFFFFF


def load_shortcuts(shortcuts_path: Path):
    """Returns (raw_parsed_dict, list_of_shortcut_views).
    raw_parsed_dict is kept around so we can write it back unmodified except
    for the fields we intentionally change."""
    if not shortcuts_path.is_file():
        return None, []
    raw = vdf.binary_loads(shortcuts_path.read_bytes())
    shortcuts = []
    for key, entry in raw.get("shortcuts", {}).items():
        appid = to_unsigned32(int(entry.get("appid", 0)))
        shortcuts.append(
            {
                "key": key,
                "appid": appid,
                "name": entry.get("AppName") or entry.get("appname") or "",
                "exe": entry.get("Exe") or entry.get("exe") or "",
                "icon": entry.get("icon", ""),
            }
        )
    return raw, shortcuts


def save_shortcuts(shortcuts_path: Path, raw: dict):
    # backup = shortcuts_path.with_suffix(shortcuts_path.suffix + f".bak-{int(time.time())}")
    backup = shortcuts_path.with_suffix(shortcuts_path.suffix + f".bak")
    shutil.copy2(shortcuts_path, backup)
    ok(f"Backed up shortcuts.vdf to {backup}")
    shortcuts_path.write_bytes(vdf.binary_dumps(raw))


# ---------------------------------------------------------------------------
# AppID mapping cache (shortcut appid -> real Steam appid, or None = skip)
# ---------------------------------------------------------------------------
def load_mapping_cache() -> dict:
    if MAPPING_FILE.is_file():
        try:
            return json.loads(MAPPING_FILE.read_text())
        except Exception:
            warn(f"Could not parse {MAPPING_FILE}, starting fresh.")
    return {}


def save_mapping_cache(cache: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MAPPING_FILE.write_text(json.dumps(cache, indent=2, sort_keys=True))


def search_store(name: str, timeout=10):
    try:
        resp = requests.get(
            STORE_SEARCH_URL,
            params={"term": f'"{name}"', "l": "english", "cc": "us"},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", [])
    except Exception as e:
        warn(f"Store search failed for '{name}': {e}")
        return []


def resolve_shortcut_appid(shortcut: dict, cache: dict, assume_yes: bool) -> int | None:
    key = str(shortcut["appid"])
    if key in cache:
        cached = cache[key]
        return cached.get("real_appid")  # may be None (means "skip, confirmed")

    name = shortcut["name"]
    results = search_store(name)[:5]

    if not results:
        info(f"No Steam store match found for '{name}' -- skipping art for it.")
        cache[key] = {"real_appid": None, "name_at_time": name}
        save_mapping_cache(cache)
        return None

    if assume_yes:
        # Only auto-accept if there's a single, name-matching result -- never
        # guess blindly among several candidates even in --yes mode.
        exact = [r for r in results if r.get("name", "").strip().lower() == name.strip().lower()]
        if len(exact) == 1:
            appid = exact[0]["id"]
            cache[key] = {"real_appid": appid, "name_at_time": name}
            save_mapping_cache(cache)
            ok(f"Auto-matched '{name}' -> AppID {appid} ({exact[0]['name']})")
            return appid
        warn(f"No confident single match for '{name}' under --yes, skipping.")
        cache[key] = {"real_appid": None, "name_at_time": name}
        save_mapping_cache(cache)
        return None

    log("")
    info(f"Non-Steam shortcut: {C_BOLD}{name}{C_RESET} (shortcut ID {shortcut['appid']})")
    for i, r in enumerate(results, 1):
        log(f"  {i}) {r.get('name')}  (AppID {r.get('id')})")
    log("  s) Skip this one (don't fetch art for it)")
    log("  m) Enter an AppID manually")
    choice = input("Choose: ").strip().lower()

    real_appid = None
    if choice == "s":
        pass
    elif choice == "m":
        manual = input("  Real Steam AppID: ").strip()
        if manual.isdigit():
            real_appid = int(manual)
    else:
        try:
            idx = 0 if choice == "" else int(choice) - 1
            if 0 <= idx < len(results):
                real_appid = results[idx]["id"]
        except ValueError:
            pass

    cache[key] = {"real_appid": real_appid, "name_at_time": name}
    save_mapping_cache(cache)
    return real_appid


# ---------------------------------------------------------------------------
# Appinfo fetch (single anonymous Steam client session, batched)
# ---------------------------------------------------------------------------
def fetch_appinfo(appids: list[int]) -> dict:
    if not appids:
        return {}
    info(f"Connecting to Steam (anonymous) to fetch app info for {len(appids)} app(s)...")
    client = SteamClient()
    try:
        result = client.anonymous_login()
    except Exception as e:
        err(f"Could not connect to Steam: {e}")
        return {}
    if result != EResult.OK:
        err(f"Anonymous login failed: {result!r}")
        return {}

    try:
        product_info = client.get_product_info(apps=appids, timeout=30)
    except Exception as e:
        err(f"get_product_info failed: {e}")
        client.logout()
        return {}
    finally:
        try:
            client.logout()
        except Exception:
            pass

    return product_info.get("apps", {}) if product_info else {}


def extract_art_refs(art_source_appid: int, info_dict: dict) -> dict:
    """Pulls whatever we can find for hero/logo/logo_position/capsule/icon
    out of one app's appinfo dict, with graceful fallbacks.

    art_source_appid is the *real* Steam AppID the art actually belongs to
    (for a non-Steam shortcut this is the resolved match, not the shortcut's
    own synthetic ID) -- every URL built here is rooted at that ID."""
    appid = art_source_appid
    common = info_dict.get("common", {}) if info_dict else {}
    icon_hash = common.get("clienticon")
    refs = {
        "name": common.get("name"),
        "icon_url": (
            COMMUNITY_ICON_CDN_BASE.format(appid=appid, hash=icon_hash) if icon_hash else None
        ),
        "capsule_url": None,
        "hero_url": None,
        "logo_url": None,
        "logo_position": None,
        "header_url": None,
    }

    assets = common.get("library_assets_full", {})

    def asset_filename(section):
        img = section.get("image2x") or section.get("image") or section if isinstance(section, dict) else None
        if isinstance(img, dict):
            return img.get("english") or next(iter(img.values()), None)
        return img

    hero = assets.get("library_hero", {})
    hero_file = asset_filename(hero)

    if hero_file:
        refs["hero_url"] = STORE_CDN_BASE.format(appid=appid, filename=hero_file)
    else:
        refs["hero_url"] = STORE_CDN_BASE.format(appid=appid, filename="library_hero.jpg") # steam's legacy filename

    logo = assets.get("library_logo", {})
    logo_file = asset_filename(logo)

    if logo_file:
        refs["logo_url"] = STORE_CDN_BASE.format(appid=appid, filename=logo_file)
    else:
        refs["logo_url"] = STORE_CDN_BASE.format(appid=appid, filename="logo.png") # steam's legacy filename

    pos = logo.get("logo_position") if isinstance(logo, dict) else None
    if isinstance(pos, dict):
        refs["logo_position"] = {
            "nVersion": 1,
            "logoPosition": {
                "pinnedPosition": pos.get("pinned_position", "BottomLeft"),
                "nWidthPct": int(float(pos.get("width_pct", 40))),
                "nHeightPct": int(float(pos.get("height_pct", 40))),
            },
        }

    capsule = assets.get("library_capsule", {})
    capsule_file = asset_filename(capsule)

    if capsule_file:
        refs["capsule_url"] = STORE_CDN_BASE.format(appid=appid, filename=capsule_file)
    else:
        refs["capsule_url"] = STORE_CDN_BASE.format(appid=appid, filename="library_600x900_2x.jpg") # steam's legacy filename

    header = assets.get("library_header") or common.get("header_image") or {}
    header_file = asset_filename(header)

    if header_file:
        refs["header_url"] = STORE_CDN_BASE.format(appid=appid, filename=header_file)
    else:
        refs["header_url"] = STORE_CDN_BASE.format(appid=appid, filename="header.jpg") # steam's legacy filename

    return refs


# ---------------------------------------------------------------------------
# Downloading / conversion / placement
# ---------------------------------------------------------------------------
def download(url: str, dest: Path, dry_run: bool) -> bool:
    if dry_run:
        info(f"  [dry-run] would download {url} -> {dest}")
        return True
    try:
        resp = requests.get(url, timeout=20)
        if resp.status_code != 200 or not resp.content:
            warn(f"  Could not fetch {url} (status {resp.status_code})")
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        warn(f"  Download failed for {url}: {e}")
        return False


def convert_to_png(src: Path, dest: Path, dry_run: bool) -> bool:
    if dry_run:
        info(f"  [dry-run] would convert {src} -> {dest}")
        return True
    try:
        with Image.open(src) as im:
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.convert("RGBA").save(dest, "PNG")
        return True
    except Exception as e:
        warn(f"  Icon conversion failed: {e}")
        return False

def convert_ico_to_png(src: Path, dest: Path, dry_run: bool) -> bool:
    if dry_run:
            info(f"  [dry-run] would convert {src} -> {dest}")
            return True
    try:
        with Image.open(src) as ico:
            best_frame = None
            best_pixels = 0

            for frame in range(getattr(ico, "n_frames", 1)):
                ico.seek(frame)

                pixels = ico.width * ico.height

                if pixels > best_pixels:
                    best_pixels = pixels
                    best_frame = ico.copy()

            dest.parent.mkdir(parents=True, exist_ok=True)
            best_frame.convert("RGBA").save(dest)
        return True
    except Exception as e:
        warn(f"  Icon conversion failed: {e}")
        return False

def write_logo_position(grid_dir: Path, appid: int, position: dict, dry_run: bool):
    dest = grid_dir / f"{appid}.json"
    if dry_run:
        info(f"  [dry-run] would write {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(position))


def icon_destination(appid: int, compatdata_dir: Path | None) -> Path:
    if compatdata_dir is not None:
        prefix_dir = compatdata_dir / str(appid)
        if prefix_dir.is_dir():
            return prefix_dir / "icon.ico"
    return ICON_FALLBACK_DIR / f"{appid}.ico"


# ---------------------------------------------------------------------------
# Per-app processing
# ---------------------------------------------------------------------------
def art_exists(grid_dir: Path, appid: int) -> bool:
    return any(
        (grid_dir / name).exists()
        for name in (f"{appid}p.png", f"{appid}_hero.png", f"{appid}_logo.png")
    )


def process_app(
    target_appid: int,
    display_name: str,
    art_refs: dict,
    grid_dir: Path,
    compatdata_dir: Path | None,
    is_shortcut: bool,
    dry_run: bool,
    force: bool,
    assume_yes: bool,
) -> dict | None:
    """target_appid is the ID Steam's library actually looks files up under:
    the real AppID for a real game, or the shortcut's own synthetic ID for a
    non-Steam shortcut. art_refs URLs were already built from the correct
    *source* AppID by extract_art_refs() and don't need target_appid at all.

    Returns {'icon_path': Path} if a shortcut icon was placed and should be
    written into shortcuts.vdf, else None."""
    if not force and art_exists(grid_dir, target_appid):
        info(
            f"Art already present for '{display_name}' (AppID {target_appid}), "
            "skipping. Use --force to overwrite."
        )
        return None

    if not assume_yes:
        ans = input(
            f"Apply Steam art for '{display_name}' (target AppID {target_appid})? [Y/n]: "
        ).strip().lower()
        if ans not in ("", "y", "yes"):
            info("  Skipped.")
            return None

    log(f"{C_BOLD}{display_name}{C_RESET} (target AppID {target_appid})")

    hero_url = art_refs.get("hero_url")
    if hero_url:
        extension = Path(urlparse(hero_url).path).suffix
        download(
            hero_url,
            grid_dir / f"{target_appid}_hero{extension}",
            dry_run
        )

    capsule_url = art_refs.get("capsule_url")
    if capsule_url:
        extension = Path(urlparse(capsule_url).path).suffix
        download(
            capsule_url,
            grid_dir / f"{target_appid}p{extension}",
            dry_run
        )

    header_url = art_refs.get("header_url")
    if header_url:
        extension = Path(urlparse(header_url).path).suffix
        download(
            header_url,
            grid_dir / f"{target_appid}{extension}",
            dry_run
        )

    logo_url = art_refs.get("logo_url")
    if logo_url:
        extension = Path(urlparse(logo_url).path).suffix
        if download(
            logo_url,
            grid_dir / f"{target_appid}_logo{extension}",
            dry_run):
            position = art_refs.get("logo_position") or DEFAULT_LOGO_POSITION
            write_logo_position(grid_dir, target_appid, position, dry_run)

    icon_result = None
    icon_url = art_refs.get("icon_url")
    if is_shortcut and icon_url:
        success = False
        extension = Path(urlparse(icon_url).path).suffix
        dest_png = grid_dir / f"{target_appid}_icon.png"

        if extension == ".ico":
            dest_ico = icon_destination(target_appid, compatdata_dir)

            if download(icon_url, dest_ico, dry_run):
                if dry_run:
                    info(f"  [dry-run] would save icon to {dest_ico}")
                    info(f"  [dry-run] would convert icon to .png and save it to {dest_png}")
                    success = True
                else:
                    success = convert_ico_to_png(dest_ico, dest_png, dry_run)

        else:
            with TemporaryDirectory() as tmp_dir:
                tmp_icon = Path(tmp_dir) / f"{target_appid}_icon{extension}"

                if download(icon_url, tmp_icon, dry_run):
                    if dry_run:
                        info(f"  [dry-run] would convert icon to .png and save it to {dest_png}")
                        success = True
                    else:
                        success = convert_to_png(tmp_icon, dest_png, dry_run)

        if success:
            icon_result = {"icon_path": dest_png}

    ok(f"  Done: {display_name}")
    log("")
    return icon_result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Fetch official Steam library art for non-Steam shortcuts (and, optionally, real games).",
    )
    parser.add_argument("--steam-dir")
    parser.add_argument("--compatdata-dir")
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--include-real-games", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--reset-mapping-cache", action="store_true")
    args = parser.parse_args()

    steam_root = Path(args.steam_dir) if args.steam_dir else find_steam_root()
    if not steam_root:
        err("Could not find your Steam installation. Pass --steam-dir explicitly.")
        sys.exit(1)
    info(f"Steam root: {steam_root}")

    compatdata_dir = (
        Path(args.compatdata_dir) if args.compatdata_dir else find_compatdata_dir(steam_root)
    )
    if compatdata_dir:
        info(f"compatdata: {compatdata_dir}")
    else:
        warn("No compatdata directory found -- icons will use the fallback location for all shortcuts.")

    profile_dir = choose_userdata_profile(steam_root, args.yes)
    grid_dir = profile_dir / "config" / "grid"
    grid_dir.mkdir(parents=True, exist_ok=True)
    shortcuts_path = profile_dir / "config" / "shortcuts.vdf"
    info(f"Steam profile: {profile_dir.name}")
    info(f"Grid folder: {grid_dir}")

    steamapps_dir = steam_root / "steamapps"
    real_games = collect_real_games(steamapps_dir) if args.include_real_games else {}
    raw_shortcuts, shortcuts = load_shortcuts(shortcuts_path)
    info(f"Found {len(shortcuts)} non-Steam shortcut(s).")
    if args.include_real_games:
        info(f"Found {len(real_games)} real Steam game(s).")

    if args.only:
        wanted = set(args.only)

        def matches(appid, name):
            return str(appid) in wanted or any(w.lower() in name.lower() for w in wanted)

        real_games = {a: n for a, n in real_games.items() if matches(a, n)}
        shortcuts = [s for s in shortcuts if matches(s["appid"], s["name"])]

    mapping_cache = load_mapping_cache() if not args.reset_mapping_cache else {}

    # Build the work list: (art_source_appid, target_appid, display_name, is_shortcut, shortcut_ref)
    # art_source_appid: the real AppID whose official art we fetch from Valve.
    # target_appid: the ID Steam's library actually looks art up under --
    #   identical to art_source_appid for real games, but the shortcut's own
    #   synthetic ID for non-Steam shortcuts.
    work = []
    for appid, name in real_games.items():
        work.append((appid, appid, name, False, None))
    for sc in shortcuts:
        real_appid = resolve_shortcut_appid(sc, mapping_cache, args.yes)
        if real_appid is None:
            continue
        work.append((real_appid, sc["appid"], sc["name"], True, sc))

    if not work:
        warn("Nothing to do.")
        return

    art_source_appids = [w[0] for w in work]
    appinfo = fetch_appinfo(art_source_appids)

    log("")
    info(f"Processing {len(work)} app(s)...")
    log("")

    icon_updates = {}  # shortcut key -> new icon path
    for art_source_appid, target_appid, display_name, is_shortcut, sc in work:
        app_data = appinfo.get(art_source_appid)
        if not app_data:
            warn(
                f"No app info returned for AppID {art_source_appid} "
                f"('{display_name}'), skipping."
            )
            continue
        refs = extract_art_refs(art_source_appid, app_data)

        result = process_app(
            target_appid=target_appid,
            display_name=refs.get("name") or display_name,
            art_refs=refs,
            grid_dir=grid_dir,
            compatdata_dir=compatdata_dir,
            is_shortcut=is_shortcut,
            dry_run=args.dry_run,
            force=args.force,
            assume_yes=args.yes,
        )
        if result and is_shortcut:
            icon_updates[sc["key"]] = str(result["icon_path"])

    if icon_updates and raw_shortcuts is not None:
        log("")
        info(f"{len(icon_updates)} shortcut icon(s) need to be written into shortcuts.vdf.")
        if args.dry_run:
            info("[dry-run] would update shortcuts.vdf and back it up first.")
        else:
            proceed = args.yes
            if not proceed:
                ans = input(
                    "Write these icon paths into shortcuts.vdf now? "
                    "Make sure Steam is closed. [Y/n]: "
                ).strip().lower()
                proceed = ans in ("", "y", "yes")
            if proceed:
                for key, icon_path in icon_updates.items():
                    raw_shortcuts["shortcuts"][key]["icon"] = icon_path
                save_shortcuts(shortcuts_path, raw_shortcuts)
                ok("shortcuts.vdf updated. Restart Steam to see the changes.")
            else:
                info("Skipped writing shortcuts.vdf; icon files were still saved to disk.")

    log("")
    ok("Done.")


if __name__ == "__main__":
    main()
