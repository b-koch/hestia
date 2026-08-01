#!/usr/bin/env bash
set -euo pipefail

: "${ROOTFS:?ROOTFS must be set by the caller}"

TARGET_DIR="${ROOTFS}/usr/share/fonts/AdwaitaMono"

latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/ryanoasis/nerd-fonts/releases/latest)
tag="${latest_url##*/}"
download_url="https://github.com/ryanoasis/nerd-fonts/releases/download/${tag}/AdwaitaMono.zip"

tmp_zip=$(mktemp --suffix=.zip)
trap 'rm -f "$tmp_zip"' EXIT

echo "Downloading AdwaitaMono font..."
curl -fsSL "$download_url" -o "$tmp_zip"

echo "Extracting to ${TARGET_DIR}..."
mkdir -p "$TARGET_DIR"
unzip -o "$tmp_zip" -d "$TARGET_DIR"

echo "AdwaitaMono staged successfully at ${TARGET_DIR}."
echo "NOTE: font cache is rebuilt on the live host by hestia-sysext-fetch.sh after activation."
