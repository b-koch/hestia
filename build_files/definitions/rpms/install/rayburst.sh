#!/usr/bin/env bash
set -euo pipefail

latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/AnInsomniacy/rayburst/releases/latest)


tag="${latest_url##*/}"
version="${tag#v}-1"

echo "https://github.com/AnInsomniacy/rayburst/releases/download/${tag}/Rayburst-${version}.x86_64.rpm"