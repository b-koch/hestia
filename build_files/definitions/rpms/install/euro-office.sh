#!/usr/bin/env bash
set -euo pipefail

latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/Euro-Office/DesktopEditors/releases/latest)

tag="${latest_url##*/}"
version="${tag#v}"

echo "https://github.com/Euro-Office/DesktopEditors/releases/download/${tag}/euro-office-euro-office-${version}.x86_64.rpm"