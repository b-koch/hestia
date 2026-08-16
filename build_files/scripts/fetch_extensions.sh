#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TARGET_DIR="${REPO_ROOT}/system_files/usr/share/gnome-shell/extensions"

EXTENSIONS=(
    # "https://extensions.gnome.org/extension/extension-id:UUID"
    # Example: "8834:copyous@boerdereinar.dev"
    "9184:advanced-media-controller@sanjai.com"
    "4269:AlphabeticalAppGrid@stuarthayhurst"
    "9308:bluetooth-battery-monitor@v8v88v8v88.com"
    "8834:copyous@boerdereinar.dev"
    "5410:grand-theft-focus@zalckos.github.com"
    "4099:no-overview@fthx"
    "4691:pip-on-top@rafostar.github.com"
    "7048:rounded-window-corners@fxgn"
    "355:status-area-horizontal-spacing@mathematical.coffee.gmail.com"
    "5470:weatheroclock@CleoMenezesJr.github.io"
)

mkdir -p "$TARGET_DIR"

for entry in "${EXTENSIONS[@]}"; do
    PK="${entry%%:*}"
    UUID="${entry#*:}"

    EXT_OUT="${TARGET_DIR}/${UUID}"
    VERSION_FILE="${EXT_OUT}/.version"

    echo "Checking ${UUID} (PK: ${PK})..."

    # Query general extension info to get the shell_version_map
    API_URL="https://extensions.gnome.org/extension-info/?pk=${PK}"
    REMOTE_JSON=$(curl -s "${API_URL}")

    # Find the highest GNOME shell version key dynamically and get its version while ignoring legacy versions.
    MAX_SHELL=$(echo "${REMOTE_JSON}" | jq -r '.shell_version_map | to_entries | map(select(.key | test("^[0-9]+$"))) | max_by(.key | tonumber) | .key')
    REMOTE_VERSION=$(echo "${REMOTE_JSON}" | jq -r --arg max "$MAX_SHELL" '.shell_version_map[$max].version')

    # Query the API again with that specific shell version to get the corresponding download_url
    VERSIONED_API_URL="https://extensions.gnome.org/extension-info/?pk=${PK}&shell_version=${MAX_SHELL}"
    VERSIONED_JSON=$(curl -s "${VERSIONED_API_URL}")
    DOWNLOAD_PATH=$(echo "${VERSIONED_JSON}" | jq -r '.download_url')

    if [ "${REMOTE_VERSION}" == "null" ] || [ -z "${DOWNLOAD_PATH}" ] || [ "${DOWNLOAD_PATH}" == "null" ]; then
        echo "  -> Warning: Could not fetch info for ${UUID}. Skipping."
        continue
    fi

    DOWNLOAD_URL="https://extensions.gnome.org${DOWNLOAD_PATH}"

    if [ -f "${VERSION_FILE}" ]; then
        LOCAL_VERSION=$(cat "${VERSION_FILE}")
        if [ "${LOCAL_VERSION}" == "${REMOTE_VERSION}" ]; then
            echo "  -> Up to date (v${LOCAL_VERSION}). Skipping."
            continue
        fi
    fi

    echo "  -> Updating to v${REMOTE_VERSION}..."

    TMP_DIR=$(mktemp -d)
    curl -sL "${DOWNLOAD_URL}" -o "${TMP_DIR}/ext.zip"

    rm -rf "${EXT_OUT}"
    mkdir -p "${EXT_OUT}"
    unzip -q "${TMP_DIR}/ext.zip" -d "${EXT_OUT}"

    if [ -d "${EXT_OUT}/schemas" ]; then
        glib-compile-schemas "${EXT_OUT}/schemas"
    fi

    echo "${REMOTE_VERSION}" > "${VERSION_FILE}"
    rm -rf "${TMP_DIR}"

    echo "  -> Successfully updated ${UUID}."
done
