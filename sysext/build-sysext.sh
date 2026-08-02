#!/usr/bin/env bash
set -euo pipefail

# Builds a single systemd-sysext payload for one app directory under
# sysext/apps/<name>/ by dnf-installing into an --installroot inside a
# container based on our own hestia:latest image. Run inside the builder
# stage of sysext/Containerfile. See sysext/README.md for the layout.

source /sysext/lib/read_list.sh

APP="${1:?Usage: build-sysext.sh <app>}"
APP_DIR="/sysext/apps/${APP}"
ROOTFS="/out"

if [[ ! -d "$APP_DIR" ]]; then
    echo "Unknown sysext app: ${APP} (no directory at ${APP_DIR})" >&2
    exit 1
fi

RELEASEVER="$(rpm -E '%{fedora}')"
ARCH_ID="$(uname -m | sed 's/x86_64/x86-64/;s/aarch64/arm64/')"

if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "This build system only targets x86_64." >&2
    exit 1
fi

mkdir -p "$ROOTFS"

echo "=== Building sysext '${APP}' (Fedora ${RELEASEVER}, ${ARCH_ID}) ==="

echo "--- Adding repositories ---"
if [[ -d "${APP_DIR}/repos" ]]; then
    shopt -s nullglob
    for repo in "${APP_DIR}"/repos/*.repo; do
        echo "Installing repo: $(basename "$repo")"
        cp "$repo" /etc/yum.repos.d/

        while IFS= read -r key_url; do
            [[ -n "$key_url" ]] || continue
            key_url="${key_url//\$releasever/$RELEASEVER}"
            echo "Importing GPG key: $key_url"
            rpm --import "$key_url"
        done < <(grep -E '^\s*gpgkey\s*=' "$repo" | sed 's/.*=\s*//')
    done
    shopt -u nullglob
fi

echo "--- Resolving install targets ---"
targets=()

if [[ -f "${APP_DIR}/packages" ]]; then
    while IFS= read -r pkg; do
        targets+=("$pkg")
    done < <(read_list "${APP_DIR}/packages")
fi

if [[ -d "${APP_DIR}/rpms" ]]; then
    shopt -s nullglob
    for script in "${APP_DIR}"/rpms/*.sh; do
        echo "Resolving RPM URL from: $(basename "$script")"
        url="$(bash "$script")"
        targets+=("$url")
    done
    shopt -u nullglob
fi

if [[ "${#targets[@]}" -gt 0 ]]; then
    echo "Installing (${#targets[@]}): ${targets[*]}"
    dnf5 \
        --installroot="$ROOTFS" \
        --releasever="$RELEASEVER" \
        --use-host-config \
        --setopt=install_weak_deps=False \
        --setopt=disable_excludes=* \
        -y install "${targets[@]}"
else
    echo "No packages or RPMs listed for ${APP}."
fi

echo "--- Running install/fixup script ---"
if [[ -f "${APP_DIR}/install.sh" ]]; then
    ROOTFS="$ROOTFS" bash "${APP_DIR}/install.sh"
fi

echo "--- Writing extension-release metadata ---"
mkdir -p "$ROOTFS/usr/lib/extension-release.d"
cat > "$ROOTFS/usr/lib/extension-release.d/extension-release.${APP}" <<EOF
ID=_any
VERSION_ID=${RELEASEVER}
ARCHITECTURE=${ARCH_ID}
EOF

echo "--- Cleaning up ---"
rm -f "$ROOTFS/usr/lib/os-release"
rm -rf "$ROOTFS"/usr/share/man "$ROOTFS"/usr/share/doc "$ROOTFS"/usr/share/info "$ROOTFS"/usr/share/licenses

dnf5 clean all --installroot="$ROOTFS" || true
rm -rf "$ROOTFS/var/cache/dnf" "$ROOTFS/var/cache/libdnf5" "$ROOTFS/var/lib/dnf" "$ROOTFS/var/lib/rpm" "$ROOTFS/var/log"

echo "--- Pruning rootfs to /usr only ---"
# /opt is not reliably merged by systemd-sysext on our target, so apps must
# relocate anything under /opt into /usr/lib themselves (see install.sh).
if [[ -d "$ROOTFS/opt" ]] && [[ -n "$(ls -A "$ROOTFS/opt" 2>/dev/null)" ]]; then
    echo "ERROR: ${APP} still has content under /opt after install.sh." >&2
    echo "Move it into usr/lib in the app's install.sh instead." >&2
    ls -alh "$ROOTFS/opt" >&2
    exit 1
fi
find "$ROOTFS" -mindepth 1 -maxdepth 1 ! -name usr -exec rm -rf {} +

echo "=== Built ${APP}: $(du -sh "$ROOTFS" | cut -f1) ==="
