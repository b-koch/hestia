#!/usr/bin/env bash
set -euo pipefail

echo "Ensuring runtime dependencies are installed..."
if command -v dnf &>/dev/null; then
    echo "Installing runtime dependencies (python3-pyside6, libxcb)..."
    dnf install -y python3-pyside6 libxcb
fi

echo "Getting latest release tag from GitHub..."
latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/pythonlover02/volt-gui/releases/latest)
tag="${latest_url##*/}"
version="${tag#v}"

download_url="https://github.com/pythonlover02/volt-gui/releases/download/${tag}/volt-gui-${version}.tar.gz"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading volt-gui ${tag}..."
curl -fsSL "$download_url" | tar -xz -C "$tmp_dir" --strip-components=1

echo "Installing volt-gui system-wide..."
cd "$tmp_dir"
make install

echo "volt-gui ${tag} installed successfully."
