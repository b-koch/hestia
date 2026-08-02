#!/usr/bin/env bash
set -euo pipefail

echo "Fixing SoftMaker Office NX icon names and desktop entries..."

# Rename icon files in-place inside the 'apps' directories
find /usr/share/icons/hicolor/ -type f -name "application-x-tmlnx.png" -execdir mv {} textmaker-nx.png \; 2>/dev/null || true
find /usr/share/icons/hicolor/ -type f -name "application-x-pmlnx.png" -execdir mv {} planmaker-nx.png \; 2>/dev/null || true
find /usr/share/icons/hicolor/ -type f -name "application-x-prlnx.png" -execdir mv {} presentations-nx.png \; 2>/dev/null || true

# Update .desktop files to reference the corrected icon names
if [ -d /usr/share/applications ]; then
    sed -i 's/Icon=application-x-tmlnx/Icon=textmaker-nx/' /usr/share/applications/*textmaker*.desktop 2>/dev/null || true
    sed -i 's/Icon=application-x-pmlnx/Icon=planmaker-nx/' /usr/share/applications/*planmaker*.desktop 2>/dev/null || true
    sed -i 's/Icon=application-x-prlnx/Icon=presentations-nx/' /usr/share/applications/*presentation*.desktop 2>/dev/null || true
fi

# Refresh desktop database and GTK icon cache
update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true

echo "SoftMaker icons successfully standardized."