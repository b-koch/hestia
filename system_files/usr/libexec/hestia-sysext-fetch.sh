#!/usr/bin/env bash
set -euo pipefail

APPS_LIST="/etc/hestia/sysext-apps.list"
REGISTRY="ghcr.io/b-koch"
TAG="${HESTIA_SYSEXT_TAG:-latest}"
EXT_BASE="/var/lib/extensions"
DIGEST_DIR="/var/lib/extensions.d"

mkdir -p "$DIGEST_DIR" "$EXT_BASE"

if [[ ! -f "$APPS_LIST" ]]; then
    echo "No sysext app list found at ${APPS_LIST}, nothing to do."
    exit 0
fi

mapfile -t apps < <(grep -vE '^[[:space:]]*(#|$)' "$APPS_LIST")

if [[ "${#apps[@]}" -eq 0 ]]; then
    echo "Sysext app list is empty, nothing to do."
    exit 0
fi

changed=0

for app in "${apps[@]}"; do
    image="${REGISTRY}/sysext-${app}:${TAG}"
    ext_dir="${EXT_BASE}/${app}"
    digest_path="${DIGEST_DIR}/${app}.digest"

    echo "=== Checking sysext: ${app} ==="

    remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${image}" 2>/dev/null || echo "")
    if [[ -z "$remote_digest" ]]; then
        echo "  x Failed to inspect remote image ${image}, skipping."
        continue
    fi

    local_digest=""
    if [[ -f "$digest_path" ]]; then
        local_digest=$(<"$digest_path")
    fi

    if [[ "$local_digest" == "$remote_digest" && -d "$ext_dir" ]]; then
        echo "  - Up to date (${remote_digest:0:19}), skipping."
        continue
    fi

    echo "  > Changes detected or missing local files. Pulling updates..."

    if ! podman pull --quiet "$image"; then
        echo "  x Failed to pull ${image}, leaving existing state untouched."
        continue
    fi

    tmp_dir="$(mktemp -d -p "$EXT_BASE")"

    ctr="$(podman create "$image")" || {
        echo "  x podman create failed for ${app}"
        rm -rf "$tmp_dir"
        continue
    }

    if podman cp "${ctr}:/." "$tmp_dir/"; then
        rm -rf "$ext_dir"
        mv "$tmp_dir" "$ext_dir"

        if command -v restorecon >/dev/null 2>&1 && selinuxenabled 2>/dev/null; then
            echo "  > Relabeling SELinux contexts..."
            restorecon -R -F -s "${ext_dir}/usr"=/usr "${ext_dir}"
        fi

        printf '%s\n' "$remote_digest" > "$digest_path"
        echo "  + Installed ${app} to ${ext_dir}"
        changed=1
    else
        echo "  x Failed to extract files from ${image}"
        rm -rf "$tmp_dir"
    fi

    podman rm "$ctr" >/dev/null 2>&1 || true
done

if [[ "$changed" -eq 1 ]]; then
    systemctl daemon-reload
    systemctl restart systemd-sysext.service

    update-desktop-database /usr/share/applications 2>/dev/null || true
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
    fc-cache -f 2>/dev/null || true

    echo "Sysext refresh complete."
else
    echo "No sysext changes."
fi
