#!/usr/bin/env bash
set -euo pipefail

: "${ROOTFS:?ROOTFS must be set by the caller}"

echo "Fixing SoftMaker Office NX icon names and desktop entries..."

# Rename icon files in-place inside the 'apps' directories
find "${ROOTFS}/usr/share/icons/hicolor/" -type f -name "application-x-tmlnx.png" -execdir mv {} textmaker-nx.png \; 2>/dev/null || true
find "${ROOTFS}/usr/share/icons/hicolor/" -type f -name "application-x-pmlnx.png" -execdir mv {} planmaker-nx.png \; 2>/dev/null || true
find "${ROOTFS}/usr/share/icons/hicolor/" -type f -name "application-x-prlnx.png" -execdir mv {} presentations-nx.png \; 2>/dev/null || true

# Update .desktop files to reference the corrected icon names
if [ -d "${ROOTFS}/usr/share/applications" ]; then
    sed -i 's/Icon=application-x-tmlnx/Icon=textmaker-nx/' "${ROOTFS}"/usr/share/applications/*textmaker*.desktop 2>/dev/null || true
    sed -i 's/Icon=application-x-pmlnx/Icon=planmaker-nx/' "${ROOTFS}"/usr/share/applications/*planmaker*.desktop 2>/dev/null || true
    sed -i 's/Icon=application-x-prlnx/Icon=presentations-nx/' "${ROOTFS}"/usr/share/applications/*presentation*.desktop 2>/dev/null || true
fi

echo "SoftMaker icons standardized inside the sysext image."
