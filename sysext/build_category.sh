#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

CATEGORY="${1:?Usage: build_category.sh <category>}"
CAT_DIR="/ctx/sysext/categories/${CATEGORY}"
ROOTFS="/build/root"
OUT_DIR="/out"
OUT="${OUT_DIR}/sysext.raw"

RELEASEVER="$(rpm -E '%{fedora}')"
ARCH_ID="$(uname -m | sed 's/x86_64/x86-64/;s/aarch64/arm64/')"

if [ ! -d "$CAT_DIR" ]; then
    echo "Unknown sysext category: ${CATEGORY} (no directory at ${CAT_DIR})" >&2
    exit 1
fi

mkdir -p "$ROOTFS" "$OUT_DIR"

echo "::group::Sysext category '${CATEGORY}' (Fedora ${RELEASEVER}, ${ARCH_ID})"

echo "--- Adding shared repositories ---"
mkdir -p /etc/yum.repos.d
for repo in /ctx/sysext/repos/*.repo; do
    [ -e "$repo" ] || continue
    echo "Installing repo: $(basename "$repo")"
    cp "$repo" /etc/yum.repos.d/

    while IFS= read -r key_url; do
        [[ -n "$key_url" ]] || continue
        key_url="${key_url//\$releasever/$RELEASEVER}"
        key_url="${key_url//\$\{releasever\}/$RELEASEVER}"
        echo "Importing GPG key: $key_url"
        rpm --import "$key_url"
    done < <(grep -E '^\s*gpgkey\s*=' "$repo" | sed 's/.*=\s*//')
done

echo "--- Installing packages for ${CATEGORY} ---"
packages=()
PACKAGES_INSTALL_DIR="${CAT_DIR}/packages"
if [ -d "$PACKAGES_INSTALL_DIR" ]; then
    shopt -s nullglob
    for file in "$PACKAGES_INSTALL_DIR"/*; do
        [ -f "$file" ] || continue
        echo "Reading package file: $(basename "$file")"
        while IFS= read -r pkg; do
            packages+=("$pkg")
        done < <(read_list "$file")
    done
    shopt -u nullglob
fi

if [ "${#packages[@]}" -gt 0 ]; then
    echo "Installing (${#packages[@]}): ${packages[*]}"
    dnf5 --installroot="$ROOTFS" --use-host-config --releasever="$RELEASEVER" \
        --setopt=install_weak_deps=False -y install "${packages[@]}"
else
    echo "No packages listed for ${CATEGORY}."
fi

echo "--- Installing external RPMs for ${CATEGORY} ---"
RPMS_INSTALL_DIR="${CAT_DIR}/rpms"
urls=()
if [ -d "$RPMS_INSTALL_DIR" ]; then
    shopt -s nullglob
    for script in "$RPMS_INSTALL_DIR"/*.sh; do
        [ -f "$script" ] || continue
        echo "Resolving RPM URL from: $(basename "$script")"
        urls+=("$(bash "$script")")
    done
    shopt -u nullglob
fi

if [ "${#urls[@]}" -gt 0 ]; then
    dnf5 --installroot="$ROOTFS" --use-host-config --releasever="$RELEASEVER" \
        -y install "${urls[@]}"
else
    echo "No external RPM scripts for ${CATEGORY}."
fi

echo "--- Installing bundled scripts for ${CATEGORY} ---"
SCRIPTS_INSTALL_DIR="${CAT_DIR}/scripts"
if [ -d "$SCRIPTS_INSTALL_DIR" ]; then
    shopt -s nullglob
    for script in "$SCRIPTS_INSTALL_DIR"/*.sh; do
        [ -f "$script" ] || continue
        echo "Running script installer: $(basename "$script")"
        ROOTFS="$ROOTFS" bash "$script"
    done
    shopt -u nullglob
fi

echo "--- Category-specific postprocessing ---"
FIXES_DIR="${CAT_DIR}/fixes"
if [ -d "${FIXES_DIR}" ]; then
    echo "Running modular fixes from ${FIXES_DIR}..."
    shopt -s nullglob
    for fix_script in "${FIXES_DIR}"/*.sh; do
        [ -f "$fix_script" ] || continue
        fix_name="$(basename "$fix_script" .sh)"
        echo "Applying fix: ${fix_name}"
        
        # Run the fix script with ROOTFS environment variable
        if ROOTFS="$ROOTFS" bash "$fix_script"; then
            echo "✓ ${fix_name} completed successfully"
        else
            echo "✗ ${fix_name} failed with exit code $?" >&2
        fi
    done
    shopt -u nullglob
else
    echo "No fixes directory found at ${FIXES_DIR}, skipping..."
fi

if [ -d "${CAT_DIR}/overlay" ]; then
    echo "Applying static overlay files..."
    cp -av "${CAT_DIR}/overlay"/. "$ROOTFS"/
fi

echo "--- Writing extension-release metadata ---"
mkdir -p "$ROOTFS/usr/lib/extension-release.d"
cat > "$ROOTFS/usr/lib/extension-release.d/extension-release.${CATEGORY}" <<EOF
ID=_any
ARCHITECTURE=${ARCH_ID}
EOF

echo "--- Pruning rootfs to /usr and /opt only ---"
find "$ROOTFS" -mindepth 1 -maxdepth 1 ! -name usr ! -name opt -exec rm -rf {} +

echo "--- Packaging as EROFS ---"
dnf5 -y install erofs-utils >/dev/null
mkfs.erofs -zzstd "$OUT" "$ROOTFS"

echo "=== Built ${CATEGORY}: $(du -h "$OUT" | cut -f1) ==="
echo "::endgroup::"
