#!/usr/bin/env bash
set -euo pipefail

: "${ROOTFS:?ROOTFS must be set by the caller}"

cd "$ROOTFS"

echo "Relocating Bitwarden out of /opt..."

mv opt/Bitwarden usr/lib/Bitwarden
rmdir opt

mkdir -p usr/bin
ln -sf /usr/lib/Bitwarden/bitwarden usr/bin/bitwarden
ln -sf /usr/lib/Bitwarden/bitwarden-app usr/bin/bitwarden-app
chmod 4755 usr/lib/Bitwarden/chrome-sandbox

sed -i 's|^Exec=/opt/Bitwarden|Exec=/usr/bin|g' usr/share/applications/bitwarden.desktop
