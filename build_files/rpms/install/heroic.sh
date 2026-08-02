#!/usr/bin/env bash
set -euo pipefail

latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/releases/latest)

tag="${latest_url##*/}"
version="${tag#v}"

echo "https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/releases/download/${tag}/Heroic-${version}-linux-x86_64.rpm"
