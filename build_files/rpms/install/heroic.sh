#!/usr/bin/env bash
set -euo pipefail

API="https://api.github.com/repos/Heroic-Games-Launcher/HeroicGamesLauncher/releases/latest"

curl -fsSL -H "User-Agent: BuildScript" "$API" | jq -r '.assets[] | select(.name | test("linux-x86_64\\.rpm$")) | .browser_download_url'
