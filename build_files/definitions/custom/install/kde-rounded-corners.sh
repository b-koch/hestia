#!/bin/bash
set -euo pipefail

echo "Building KDE-Rounded-Corners..."

PACKAGES="git cmake gcc-c++ extra-cmake-modules kwin-devel kf6-kconfigwidgets-devel libepoxy-devel kf6-kcmutils-devel kf6-ki18n-devel qt6-qtbase-private-devel wayland-devel libdrm-devel"

BEFORE_FILE=$(mktemp)
rpm -qa --qf '%{NAME}\n' | sort -u > "$BEFORE_FILE"

echo "Installing build dependencies..."
sudo dnf install -y $PACKAGES

AFTER_FILE=$(mktemp)
rpm -qa --qf '%{NAME}\n' | sort -u > "$AFTER_FILE"

NEW_PACKAGES=$(comm -13 "$BEFORE_FILE" "$AFTER_FILE")
rm -f "$BEFORE_FILE" "$AFTER_FILE"

echo "Building application..."
git clone https://github.com/matinlotfali/KDE-Rounded-Corners
cd KDE-Rounded-Corners
mkdir build
cd build
cmake ..
cmake --build . -j
sudo make install

if [ -n "$NEW_PACKAGES" ]; then
    echo "Removing newly installed build dependencies..."
    echo "$NEW_PACKAGES" | xargs sudo dnf remove -y
else
    echo "No new packages were installed; skipping cleanup."
fi

echo "KDE-Rounded-Corners installed successfully."
