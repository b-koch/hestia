#!/usr/bin/env bash
set -uo pipefail

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

    echo "=== Checking sysext '${category}' ==="

    # Get remote digest without pulling
    remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${image}" 2>/dev/null || echo "")
    if [[ -z "$remote_digest" ]]; then
        echo "  x Failed to inspect remote image ${image}, skipping."
        failed_any=1
        continue
    fi

    # Get local digest if the image exists locally
    local_digest=$(podman image inspect --format '{{.Digest}}' "$image" 2>/dev/null || echo "")

    if [[ "$local_digest" == "$remote_digest" && -f "$raw_path" ]]; then
        echo "  - Up to date (${remote_digest:0:19}), skipping."
        continue
    fi

    echo "  > Changes detected or missing local file. Pulling updates..."

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
    podman rmi "$image" >/dev/null 2>&1 || true
done < "$MANIFEST"

if [[ "$fetched_any" -eq 1 ]]; then
    systemctl daemon-reload
    systemctl enable --now systemd-sysext.service >/dev/null 2>&1 || true
    systemctl restart systemd-sysext.service

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