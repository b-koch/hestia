#!/usr/bin/env bash
set -uo pipefail

IMAGE="ghcr.io/b-koch/hestia-sysext:${HESTIA_SYSEXT_TAG:-latest}"
RAW_PATH="/var/lib/extensions.d/hestia.raw"
EXT_LINK_DIR="/var/lib/extensions"

mkdir -p /var/lib/extensions.d "$EXT_LINK_DIR"

echo "=== Checking sysext ==="

remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${IMAGE}" 2>/dev/null || echo "")
if [[ -z "$remote_digest" ]]; then
    echo "  x Failed to inspect remote image ${IMAGE}, skipping."
    exit 1
fi

local_digest=$(podman image inspect --format '{{.Digest}}' "$IMAGE" 2>/dev/null || echo "")

if [[ "$local_digest" == "$remote_digest" && -f "$RAW_PATH" ]]; then
    echo "  - Up to date (${remote_digest:0:19}), skipping."
    exit 0
fi

echo "  > Changes detected or missing local file. Pulling updates..."

if ! podman pull --quiet "$IMAGE"; then
    echo "  x Failed to pull ${IMAGE}, leaving existing state untouched."
    exit 1
fi

ctr="$(podman create "$IMAGE")" || { echo "  x podman create failed"; exit 1; }
tmp_raw="$(mktemp)"

if podman cp "${ctr}:/sysext.raw" "$tmp_raw"; then
    mv -f "$tmp_raw" "$RAW_PATH"
    ln -sf "$RAW_PATH" "${EXT_LINK_DIR}/hestia.raw"
    echo "  + Installed hestia.raw ($(du -h "$RAW_PATH" | cut -f1))"
else
    echo "  x Failed to extract sysext.raw from ${IMAGE}"
    rm -f "$tmp_raw"
    podman rm "$ctr" >/dev/null 2>&1
    exit 1
fi

podman rm "$ctr" >/dev/null 2>&1
podman rmi "$IMAGE" >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl enable --now systemd-sysext.service >/dev/null 2>&1 || true
systemctl restart systemd-sysext.service

update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fc-cache -f 2>/dev/null || true

echo "Sysext refresh complete."
echo "A reboot is recommended so services newly provided by sysexts (e.g. libvirtd) start cleanly."