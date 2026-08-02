#!/usr/bin/env bash
set -euo pipefail

source /ctx/lib/read_list.sh

ROOTFS="/build/root"
OUT_DIR="/out"
OUT="${OUT_DIR}/sysext.raw"

RELEASEVER="$(rpm -E '%{fedora}')"
ARCH_ID="$(uname -m | sed 's/x86_64/x86-64/;s/aarch64/arm64/')"

mkdir -p "$ROOTFS" "$OUT_DIR"

echo "--- Preparing image-build RPM environment ---"

mkdir -p "$ROOTFS/etc/rpm"

cat > "$ROOTFS/etc/rpm/macros.image-build" <<'EOF'
%_install_langs C.UTF-8
%_netsharedpath /proc:/sys:/dev
%_excludedocs 1
EOF

# Prevent services from being started/enabled during RPM transactions
mkdir -p "$ROOTFS/usr/lib/rpm/macros.d"

cat > "$ROOTFS/usr/lib/rpm/macros.d/macros.image-build" <<'EOF'
%_netsharedpath /proc:/sys:/dev
EOF


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

    done < <(
        grep -E '^\s*gpgkey\s*=' "$repo" |
        sed 's/.*=\s*//'
    )
done


echo "--- Installing packages ---"

packages=()

for file in /ctx/sysext/categories/*/packages/*; do
    [ -f "$file" ] || continue

    echo "Reading package list: $(basename "$file")"

    while IFS= read -r pkg; do
        packages+=("$pkg")
    done < <(read_list "$file")
done


if [ "${#packages[@]}" -gt 0 ]; then

    echo "Installing packages:"
    printf ' - %s\n' "${packages[@]}"

    dnf5 \
        --installroot="$ROOTFS" \
        --releasever="$RELEASEVER" \
        --use-host-config \
        --setopt=install_weak_deps=False \
        --setopt=disable_excludes=* \
        -y install \
        "${packages[@]}"

else
    echo "No packages requested"
fi


echo "--- Installing external RPMs ---"

for script in /ctx/sysext/categories/*/rpms/*.sh; do
    [ -f "$script" ] || continue

    url="$(bash "$script")"

    echo "Installing: $url"

    dnf5 \
        --installroot="$ROOTFS" \
        --releasever="$RELEASEVER" \
        --use-host-config \
        --setopt=install_weak_deps=False \
        --setopt=disable_excludes=* \
        -y install "$url"

done


echo "--- Running custom installers/fixes ---"

for script in \
    /ctx/sysext/categories/*/scripts/*.sh \
    /ctx/sysext/categories/*/fixes/*.sh
do
    [ -f "$script" ] || continue

    echo "Running $(basename "$script")"

    ROOTFS="$ROOTFS" bash "$script"
done


echo "--- Applying overlays ---"

for overlay in /ctx/sysext/categories/*/overlay; do
    [ -d "$overlay" ] || continue

    cp -av "$overlay"/. "$ROOTFS"/
done


echo "--- Applying SELinux labels ---"

setfiles -F \
    /etc/selinux/targeted/contexts/files/file_contexts \
    "$ROOTFS"
    

echo "--- Writing extension metadata ---"

mkdir -p "$ROOTFS/usr/lib/extension-release.d"

cat > "$ROOTFS/usr/lib/extension-release.d/extension-release.hestia" <<EOF
ID=_any
VERSION_ID=${RELEASEVER}
ARCHITECTURE=${ARCH_ID}
EOF


echo "--- Removing everything except runtime payload ---"

find "$ROOTFS" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name usr \
    ! -name opt \
    -exec rm -rf {} +


rm -f "$ROOTFS/usr/lib/os-release"

rm -rf "$ROOTFS/usr/share/man"
rm -rf "$ROOTFS/usr/share/doc"
rm -rf "$ROOTFS/usr/share/info"
rm -rf "$ROOTFS/usr/share/licenses"


echo "--- Building SquashFS ---"

dnf5 -y install erofs-utils >/dev/null

mkfs.erofs -zzstd "$OUT" "$ROOTFS"

echo "=== Built Hestia sysext ==="
du -h "$OUT"
