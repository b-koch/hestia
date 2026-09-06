#!/usr/bin/env bash
#
# steam-remove-orphaned-prefixes.sh
#
# Uses `protontricks -l` to enumerate installed Steam games and non-Steam
# shortcuts, matches their App IDs against the Proton prefixes found in
# steamapps/compatdata, and interactively deletes prefixes that no longer
# correspond to anything protontricks knows about ("orphaned" prefixes).
#
# Usage:
#   ./clean-proton-prefixes.sh [compatdata_path]
#
# Options:
#   -n, --dry-run    Show what would be deleted, never actually delete anything
#   -y, --yes        Do not prompt individually, assume "yes" for every deletion
#                     (still skips prefix 0 and known tools; use with care)
#   --no-online      Never query the Steam Store API for unknown names
#   -h, --help       Show this help text
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DRY_RUN=0
ASSUME_YES=0
NO_ONLINE=0
COMPATDATA_ARG=""

print_help() {
    sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--dry-run)
            DRY_RUN=1
            shift
            ;;
        -y|--yes)
            ASSUME_YES=1
            shift
            ;;
        --no-online)
            NO_ONLINE=1
            shift
            ;;
        -h|--help)
            print_help
            exit 0
            ;;
        *)
            COMPATDATA_ARG="$1"
            shift
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Colors (fall back to plain text if not a terminal)
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'
    C_BOLD=$'\033[1m'
    C_RED=$'\033[31m'
    C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'
    C_CYAN=$'\033[36m'
    C_DIM=$'\033[2m'
else
    C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_DIM=""
fi

log()  { printf '%s\n' "$*"; }
info() { printf '%s[*]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s[x]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
ok()   { printf '%s[+]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
if ! command -v protontricks >/dev/null 2>&1; then
    err "protontricks is not installed or not on PATH."
    exit 1
fi

HAVE_CURL=0
command -v curl >/dev/null 2>&1 && HAVE_CURL=1
HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

if [[ "$NO_ONLINE" -eq 0 && "$HAVE_CURL" -eq 0 ]]; then
    warn "curl not found -- online name lookups for unknown App IDs will be skipped."
    NO_ONLINE=1
fi

# ---------------------------------------------------------------------------
# Locate compatdata directory
# ---------------------------------------------------------------------------
find_compatdata() {
    local candidates=(
        "$HOME/.local/share/Steam/steamapps/compatdata"
        "$HOME/.steam/steam/steamapps/compatdata"
        "$HOME/.steam/root/steamapps/compatdata"
        "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata"
    )
    local c
    for c in "${candidates[@]}"; do
        [[ -d "$c" ]] && printf '%s\n' "$c"
    done
}

if [[ -n "$COMPATDATA_ARG" ]]; then
    COMPATDATA_DIR="$COMPATDATA_ARG"
    if [[ ! -d "$COMPATDATA_DIR" ]]; then
        err "Given compatdata path does not exist: $COMPATDATA_DIR"
        exit 1
    fi
else
    mapfile -t FOUND_DIRS < <(find_compatdata)
    if [[ ${#FOUND_DIRS[@]} -eq 0 ]]; then
        err "Could not auto-detect a compatdata directory."
        err "Pass it explicitly: $0 /path/to/steamapps/compatdata"
        exit 1
    elif [[ ${#FOUND_DIRS[@]} -eq 1 ]]; then
        COMPATDATA_DIR="${FOUND_DIRS[0]}"
    else
        info "Multiple compatdata directories found:"
        local_i=1
        for d in "${FOUND_DIRS[@]}"; do
            printf '  %d) %s\n' "$local_i" "$d"
            local_i=$((local_i + 1))
        done
        read -rp "Select one [1-${#FOUND_DIRS[@]}]: " sel
        if ! [[ "$sel" =~ ^[0-9]+$ ]] || (( sel < 1 || sel > ${#FOUND_DIRS[@]} )); then
            err "Invalid selection."
            exit 1
        fi
        COMPATDATA_DIR="${FOUND_DIRS[$((sel - 1))]}"
    fi
fi

STEAMAPPS_DIR="$(dirname "$COMPATDATA_DIR")"
info "Using compatdata directory: ${C_BOLD}${COMPATDATA_DIR}${C_RESET}"

# ---------------------------------------------------------------------------
# Known Steam/Proton tooling App IDs -- these are compatibility tools and
# runtimes, not games. They routinely get their own directory in compatdata
# but must never be treated as orphaned game prefixes.
# Sourced from SteamDB / Valve's steam-runtime docs. This list is best-effort
# and gets backed up by a name-pattern check below for anything newer that
# isn't in it yet (e.g. a future Proton release with a new App ID).
# ---------------------------------------------------------------------------
declare -A KNOWN_TOOL_IDS=(
    [858280]="Proton 3.7"
    [1113280]="Proton 4.11"
    [1245040]="Proton 5.0"
    [1420170]="Proton 5.13"
    [1580130]="Proton 6.3"
    [1887720]="Proton 7.0"
    [2348590]="Proton 8.0"
    [2805730]="Proton 9.0"
    [3658110]="Proton 10.0"
    [4628710]="Proton 11.0"
    [4628740]="Proton 11.0 (ARM64) (Beta)"
    [1493710]="Proton Experimental"
    [2230260]="Proton Next"
    [2180100]="Proton Hotfix"
    [3086180]="Proton Voice Files"
    [1070560]="Steam Linux Runtime 1.0 (scout)"
    [1391110]="Steam Linux Runtime 2.0 (soldier)"
    [1628350]="Steam Linux Runtime 3.0 (sniper)"
    [4183110]="Steam Linux Runtime 4.0"
    [1826330]="Proton EasyAntiCheat Runtime"
    [1161040]="Proton BattlEye Runtime"
    [228980]="Steamworks Common Redistributables"
)

# Fallback pattern match, in case a directory belongs to a tool/runtime/
# anti-cheat component whose App ID isn't in the static list above yet.
TOOL_NAME_PATTERN='^(Proton([[:space:]]|$)|Steam Linux Runtime|SteamVR|Steamworks Common Redistributables|Proton EasyAntiCheat Runtime|Proton BattlEye Runtime|EasyAntiCheat$|BattlEye$)'

# ---------------------------------------------------------------------------
# Build appid -> name map from `protontricks -l`
# ---------------------------------------------------------------------------
declare -A GAME_NAME       # appid -> name (both Steam games and non-Steam shortcuts)
declare -A IS_NONSTEAM     # appid -> 1 if it's a non-Steam shortcut

info "Querying protontricks for installed games and non-Steam shortcuts..."
PROTONTRICKS_OUTPUT="$(protontricks -l 2>/dev/null || true)"

if [[ -z "$PROTONTRICKS_OUTPUT" ]]; then
    err "protontricks -l returned no output. Aborting to avoid deleting valid prefixes."
    exit 1
fi

while IFS= read -r line; do
    # Match: "Non-Steam shortcut: Name (12345)"  or  "Name (12345)"
    if [[ "$line" =~ ^Non-Steam\ shortcut:\ (.+)\ \(([0-9]+)\)$ ]]; then
        name="${BASH_REMATCH[1]}"
        id="${BASH_REMATCH[2]}"
        GAME_NAME["$id"]="$name"
        IS_NONSTEAM["$id"]=1
    elif [[ "$line" =~ ^([^\(].*[^\ ])\ \(([0-9]+)\)$ ]]; then
        name="${BASH_REMATCH[1]}"
        id="${BASH_REMATCH[2]}"
        # Skip false positives from help/footer lines
        if [[ "$name" != "To run Protontricks for the chosen game, run:" ]]; then
            GAME_NAME["$id"]="$name"
        fi
    fi
done <<< "$PROTONTRICKS_OUTPUT"

if [[ ${#GAME_NAME[@]} -eq 0 ]]; then
    err "Could not parse any games from protontricks output. Aborting for safety."
    exit 1
fi

ok "Found ${#GAME_NAME[@]} known App ID(s) via protontricks."

# ---------------------------------------------------------------------------
# Fallback name resolution via appmanifest_<id>.acf files
# (covers games that are technically installed/known to Steam but for
# whatever reason weren't listed by protontricks, so we can still show a
# real name instead of "Unknown" wherever possible)
# ---------------------------------------------------------------------------
declare -A MANIFEST_NAME

collect_manifest_names() {
    local dir="$1"
    local f name id
    [[ -d "$dir" ]] || return 0
    for f in "$dir"/appmanifest_*.acf; do
        [[ -e "$f" ]] || continue
        id="$(sed -n 's/.*"appid"[[:space:]]*"\([0-9]*\)".*/\1/p' "$f" | head -n1)"
        name="$(sed -n 's/.*"name"[[:space:]]*"\(.*\)".*/\1/p' "$f" | head -n1)"
        [[ -n "$id" && -n "$name" ]] && MANIFEST_NAME["$id"]="$name"
    done
}

collect_manifest_names "$STEAMAPPS_DIR"

# Also check other Steam library folders listed in libraryfolders.vdf
LIBRARYFOLDERS_VDF="$STEAMAPPS_DIR/libraryfolders.vdf"
if [[ -f "$LIBRARYFOLDERS_VDF" ]]; then
    while IFS= read -r libpath; do
        [[ -n "$libpath" ]] && collect_manifest_names "$libpath/steamapps"
    done < <(sed -n 's/.*"path"[[:space:]]*"\(.*\)".*/\1/p' "$LIBRARYFOLDERS_VDF")
fi

# ---------------------------------------------------------------------------
# Online name lookup via the official Steam Store API.
# Only ever called for IDs in the plausible *real* Steam App ID range --
# non-Steam shortcut IDs (huge ~2-4 billion numbers) are filtered out before
# this is ever reached, see NONSTEAM_ID_MIN below.
# Also detects "type":"tool" so late-breaking Proton/runtime releases that
# aren't in KNOWN_TOOL_IDS yet still get recognized instead of offered up
# for deletion.
# ---------------------------------------------------------------------------
declare -A ONLINE_NAME
declare -A ONLINE_TYPE
declare -A ONLINE_CHECKED

query_steam_store() {
    local id="$1"
    [[ "$NO_ONLINE" -eq 1 ]] && return 1
    [[ -n "${ONLINE_CHECKED[$id]:-}" ]] && return 0

    ONLINE_CHECKED["$id"]=1
    local json
    json="$(curl -fsS --max-time 5 \
        "https://store.steampowered.com/api/appdetails?appids=${id}&l=english" 2>/dev/null || true)"
    [[ -z "$json" ]] && return 1

    local success name type
    if [[ "$HAVE_JQ" -eq 1 ]]; then
        success="$(printf '%s' "$json" | jq -r --arg id "$id" '.[$id].success')"
        [[ "$success" == "true" ]] || return 1
        name="$(printf '%s' "$json" | jq -r --arg id "$id" '.[$id].data.name // empty')"
        type="$(printf '%s' "$json" | jq -r --arg id "$id" '.[$id].data.type // empty')"
    else
        printf '%s' "$json" | grep -q '"success":true' || return 1
        name="$(printf '%s' "$json" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' | head -n1)"
        type="$(printf '%s' "$json" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p' | head -n1)"
    fi

    [[ -n "$name" ]] && ONLINE_NAME["$id"]="$name"
    [[ -n "$type" ]] && ONLINE_TYPE["$id"]="$type"
    # Be polite to Valve's API
    sleep 0.5
    return 0
}

# Real Steam App IDs are currently well under this. Non-Steam shortcut IDs
# (CRC32-derived, OR'd with the high bit) always land at/above 2^31.
NONSTEAM_ID_MIN=2147483648

is_real_steam_id_range() {
    local id="$1"
    (( id < NONSTEAM_ID_MIN ))
}

# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------
is_known_tool() {
    local id="$1"
    [[ -n "${KNOWN_TOOL_IDS[$id]:-}" ]]
}

name_looks_like_tool() {
    local name="$1"
    [[ "$name" =~ $TOOL_NAME_PATTERN ]]
}

resolve_name() {
    local id="$1"
    if [[ -n "${GAME_NAME[$id]:-}" ]]; then
        if [[ "${IS_NONSTEAM[$id]:-0}" -eq 1 ]]; then
            printf 'Non-Steam shortcut: %s' "${GAME_NAME[$id]}"
        else
            printf '%s' "${GAME_NAME[$id]}"
        fi
    elif [[ -n "${MANIFEST_NAME[$id]:-}" ]]; then
        printf '%s (recovered from appmanifest)' "${MANIFEST_NAME[$id]}"
    elif [[ -n "${ONLINE_NAME[$id]:-}" ]]; then
        printf '%s (recovered from Steam Store)' "${ONLINE_NAME[$id]}"
    else
        printf 'Unknown / no longer registered with Steam'
    fi
}

# ---------------------------------------------------------------------------
# Walk compatdata and find orphans
# ---------------------------------------------------------------------------
shopt -s nullglob
PREFIX_DIRS=("$COMPATDATA_DIR"/*/)
shopt -u nullglob

if [[ ${#PREFIX_DIRS[@]} -eq 0 ]]; then
    warn "No prefixes found in $COMPATDATA_DIR."
    exit 0
fi

ORPHAN_COUNT=0
DELETED_COUNT=0
SKIPPED_COUNT=0
TOOL_SKIPPED_COUNT=0
FREED_BYTES=0

log ""
info "Scanning ${#PREFIX_DIRS[@]} prefix director$([[ ${#PREFIX_DIRS[@]} -eq 1 ]] && echo y || echo ies) in compatdata..."
log ""

for dir in "${PREFIX_DIRS[@]}"; do
    id="$(basename "$dir")"

    # Only handle purely numeric App ID directories
    [[ "$id" =~ ^[0-9]+$ ]] || continue

    # NEVER touch or even prompt about prefix 0
    if [[ "$id" == "0" ]]; then
        continue
    fi

    # Known game or non-Steam shortcut currently visible to protontricks
    if [[ -n "${GAME_NAME[$id]:-}" ]]; then
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    # Known Proton / Steam Linux Runtime / anti-cheat runtime component
    if is_known_tool "$id"; then
        TOOL_SKIPPED_COUNT=$((TOOL_SKIPPED_COUNT + 1))
        continue
    fi

    # Not a known ID -- check appmanifest first (free, local, no network)
    manifest_name="${MANIFEST_NAME[$id]:-}"
    if [[ -n "$manifest_name" ]] && name_looks_like_tool "$manifest_name"; then
        TOOL_SKIPPED_COUNT=$((TOOL_SKIPPED_COUNT + 1))
        continue
    fi

    # Only ask the Steam Store about IDs that are plausibly real App IDs;
    # non-Steam shortcut IDs are skipped entirely for the online lookup.
    if [[ -z "$manifest_name" ]] && is_real_steam_id_range "$id"; then
        query_steam_store "$id" || true
        if [[ -n "${ONLINE_TYPE[$id]:-}" && "${ONLINE_TYPE[$id]}" == "tool" ]]; then
            TOOL_SKIPPED_COUNT=$((TOOL_SKIPPED_COUNT + 1))
            continue
        fi
        if [[ -n "${ONLINE_NAME[$id]:-}" ]] && name_looks_like_tool "${ONLINE_NAME[$id]}"; then
            TOOL_SKIPPED_COUNT=$((TOOL_SKIPPED_COUNT + 1))
            continue
        fi
    fi

    # Genuinely orphaned: not a known game/shortcut, not a known tool
    ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
    name="$(resolve_name "$id")"
    size="$(du -sh "$dir" 2>/dev/null | cut -f1)"
    size_bytes="$(du -sb "$dir" 2>/dev/null | cut -f1)"

    log "${C_YELLOW}Orphaned prefix found${C_RESET}"
    log "  App ID : ${C_BOLD}${id}${C_RESET}"
    log "  Name   : ${name}"
    log "  Path   : ${dir}"
    log "  Size   : ${size:-unknown}"
    if ! is_real_steam_id_range "$id"; then
        log "  ${C_DIM}(ID is in the non-Steam shortcut range, skipped online lookup)${C_RESET}"
    fi

    if [[ "$ASSUME_YES" -eq 1 ]]; then
        do_delete=1
    else
        read -rp "  Delete this prefix? [y/N]: " answer
        case "$answer" in
            y|Y|yes|YES) do_delete=1 ;;
            *) do_delete=0 ;;
        esac
    fi

    if [[ "$do_delete" -eq 1 ]]; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
            ok "  [dry-run] Would delete: $dir"
        else
            if rm -rf -- "$dir"; then
                ok "  Deleted: $dir"
                DELETED_COUNT=$((DELETED_COUNT + 1))
                [[ -n "${size_bytes:-}" ]] && FREED_BYTES=$((FREED_BYTES + size_bytes))
            else
                err "  Failed to delete: $dir"
            fi
        fi
    else
        info "  Kept."
    fi
    log ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
human_size() {
    local bytes="$1"
    numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || printf '%s bytes' "$bytes"
}

log "${C_BOLD}Summary${C_RESET}"
log "  Prefixes matched to known games : $SKIPPED_COUNT"
log "  Proton/runtime/tool prefixes    : $TOOL_SKIPPED_COUNT (never touched)"
log "  Orphaned prefixes found         : $ORPHAN_COUNT"
if [[ "$DRY_RUN" -eq 1 ]]; then
    log "  Deleted                         : 0 (dry-run)"
else
    log "  Deleted                         : $DELETED_COUNT"
    log "  Space freed                     : $(human_size "$FREED_BYTES")"
fi
log "  Prefix \"0\" (shared)             : never touched"