#!/usr/bin/env bash

set -euox pipefail

echo "Debug Info..."
ls -la / | grep -E 'opt|var|usr'
stat /opt 2>&1 || echo "opt does not exist"

echo "Installing Filen..."

curl -Lo /tmp/filen.rpm https://cdn.filen.io/@filen/desktop/release/latest/Filen_linux_x86_64.rpm
mkdir -p /tmp/filen-extract
rpm2cpio /tmp/filen.rpm | cpio -idmv -D /tmp/filen-extract

mkdir -p /opt/Filen
cp -a /tmp/filen-extract/opt/Filen/. /opt/Filen/

cp -a /tmp/filen-extract/usr/share/applications/*.desktop /usr/share/applications/ 2>/dev/null || true
rm -rf /tmp/filen.rpm /tmp/filen-extract

echo "Filen installed successfully."
