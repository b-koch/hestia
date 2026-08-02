#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/b-koch/hestia-sysext:${HESTIA_SYSEXT_TAG:-latest}"
EXT_DIR="/var/lib/extensions/hestia"
DIGEST_PATH="/var/lib/extensions.d/hestia.digest"

mkdir -p /var/lib/extensions.d /var/lib/extensions

echo "=== Checking sysext ==="

remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${IMAGE}" 2>/dev/null || echo "")
if [[ -z "$remote_digest" ]]; then
    echo "  x Failed to inspect remote image ${IMAGE}, skipping."
    exit 1
fi

local_digest=""
if [[ -f "$DIGEST_PATH" ]]; then
    local_digest=$(<"$DIGEST_PATH")
fi

if [[ "$local_digest" == "$remote_digest" && -d "$EXT_DIR" ]]; then
    echo "  - Up to date (${remote_digest:0:19}), skipping."
    exit 0
fi

echo "  > Changes detected or missing local files. Pulling updates..."

if ! podman pull --quiet "$IMAGE"; then
    echo "  x Failed to pull ${IMAGE}, leaving existing state untouched."
    exit 1
fi

systemctl stop systemd-sysext.service 2>/dev/null || true

tmp_dir="$(mktemp -d)"

ctr="$(podman create "$IMAGE")" || {
    echo "  x podman create failed"
    rm -rf "$tmp_dir"
    exit 1
}

if podman cp "${ctr}:/." "$tmp_dir/"; then
    rm -rf "$EXT_DIR"
    mv "$tmp_dir" "$EXT_DIR"
    
    # Fix SELinux contexts across all subdirectories using path substitution
    if command -v restorecon >/dev/null 2>&1 && selinuxenabled 2>/dev/null; then
        echo "  > Relabeling SELinux contexts..."
        restorecon -R -F -s "${EXT_DIR}/usr"=/usr "${EXT_DIR}"
        if [[ -d "${EXT_DIR}/opt" ]]; then
            restorecon -R -F -s "${EXT_DIR}/opt"=/opt "${EXT_DIR}/opt"
        fi
    fi

    printf '%s\n' "$remote_digest" > "$DIGEST_PATH"
    echo "  + Installed hestia sysext directory directly to ${EXT_DIR}"
else
    echo "  x Failed to extract files from ${IMAGE}"
    rm -rf "$tmp_dir"
    podman rm "$ctr" >/dev/null 2>&1
    exit 1
fi

podman rm "$ctr" >/dev/null 2>&1

systemctl daemon-reload
systemctl enable --now systemd-sysext.service >/dev/null 2>&1 || true
systemctl restart systemd-sysext.service

update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fc-cache -f 2>/dev/null || true

echo "Sysext refresh complete."