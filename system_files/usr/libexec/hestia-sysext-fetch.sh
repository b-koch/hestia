#!/usr/bin/env bash
set -uo pipefail
# NOTE: intentionally not `-e` - one category failing to fetch should not
# stop the others from being refreshed.

# If you fork this repo, update REGISTRY to match your own GHCR namespace
# (it mirrors REPO_ORGANIZATION in image-template.env).
REGISTRY="ghcr.io/b-koch"
IMAGE_PREFIX="hestia-sysext"
TAG="${HESTIA_SYSEXT_TAG:-latest}"

MANIFEST="/usr/lib/hestia/sysext-categories.list"
EXT_DIR="/var/lib/extensions.d"
EXT_LINK_DIR="/var/lib/extensions"

mkdir -p "$EXT_DIR" "$EXT_LINK_DIR"

if [[ ! -f "$MANIFEST" ]]; then
    echo "No sysext manifest found at ${MANIFEST}, nothing to do."
    exit 0
fi

fetched_any=0
failed_any=0

while IFS= read -r category; do
    [[ -z "$category" ]] && continue

    image="${REGISTRY}/${IMAGE_PREFIX}-${category}:${TAG}"
    raw_path="${EXT_DIR}/${category}.raw"

    echo "=== Refreshing sysext '${category}' from ${image} ==="

    if ! podman pull --quiet "$image"; then
        echo "  x Failed to pull ${image}, leaving existing state untouched."
        failed_any=1
        continue
    fi

    ctr="$(podman create "$image")" || { echo "  x podman create failed"; failed_any=1; continue; }
    tmp_raw="$(mktemp)"

    if podman cp "${ctr}:/sysext.raw" "$tmp_raw"; then
        mv -f "$tmp_raw" "$raw_path"
        ln -sf "$raw_path" "${EXT_LINK_DIR}/${category}.raw"
        echo "  + Installed ${category}.raw ($(du -h "$raw_path" | cut -f1))"
        fetched_any=1
    else
        echo "  x Failed to extract sysext.raw from ${image}"
        rm -f "$tmp_raw"
        failed_any=1
    fi

    podman rm "$ctr" >/dev/null 2>&1
    # Drop the pulled image layer again - we only need the extracted .raw.
    podman rmi "$image" >/dev/null 2>&1 || true
done < "$MANIFEST"

if [[ "$fetched_any" -eq 1 ]]; then
    systemctl daemon-reload
    systemctl enable --now systemd-sysext.service >/dev/null 2>&1 || true
    systemctl restart systemd-sysext.service

    # Refresh caches for content that landed via sysext (icons/fonts/desktop files)
    update-desktop-database /usr/share/applications 2>/dev/null || true
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
    fc-cache -f 2>/dev/null || true

    echo "Sysext refresh complete."
    echo "A reboot is recommended so services newly provided by sysexts (e.g. libvirtd) start cleanly."
fi

if [[ "$failed_any" -eq 1 ]]; then
    exit 1
fi

exit 0
