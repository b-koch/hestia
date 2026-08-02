#!/usr/bin/env bash
set -euo pipefail

# Fetches image-mode systemd-sysext extensions: each app is shipped as a
# single EROFS .raw file, already relabeled with the correct SELinux
# contexts at build time (see sysext/relabel-and-pack.sh). There is
# deliberately no relabeling here: the labels live inside the erofs image's
# own inode metadata, so systemd-sysext loop-mounts it as-is. All this
# script does on the host is download one file and atomically swap it into
# place -- if a reboot interrupts it mid-download, the previous good .raw
# (if any) is untouched and the system boots exactly as before.

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
    image="${REGISTRY}/sysext-${app}-raw:${TAG}"
    raw_path="${EXT_BASE}/${app}.raw"
    digest_path="${DIGEST_DIR}/${app}.digest"

    echo "=== Checking sysext: ${app} ==="

    remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${image}" 2>/dev/null || echo "")
    if [[ -z "$remote_digest" ]]; then
        echo "  x Failed to inspect remote artifact ${image}, skipping."
        continue
    fi

    local_digest=""
    if [[ -f "$digest_path" ]]; then
        local_digest=$(<"$digest_path")
    fi

    if [[ "$local_digest" == "$remote_digest" && -f "$raw_path" ]]; then
        echo "  - Up to date (${remote_digest:0:19}), skipping."
        continue
    fi

    echo "  > Changes detected or missing local file. Pulling update..."

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
        fetched="$(find "$tmp_dir" -maxdepth 1 -type f -name '*.raw' -print -quit)"

        if [[ -z "$fetched" ]]; then
            echo "  x No .raw payload found in ${image}"
            rm -rf "$tmp_dir"
            podman rm "$ctr" >/dev/null 2>&1 || true
            continue
        fi

        chmod 0644 "$fetched"
        # Atomic swap: same filesystem, so this is a rename, not a copy.
        # No relabeling here -- see header comment.
        mv -f "$fetched" "$raw_path"

        printf '%s\n' "$remote_digest" > "$digest_path"
        echo "  + Installed ${app} to ${raw_path}"
        changed=1
    else
        echo "  x Failed to extract files from ${image}"
    fi

    rm -rf "$tmp_dir"
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
