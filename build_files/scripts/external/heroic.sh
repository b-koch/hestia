#!/usr/bin/env bash
set -ouex pipefail

API="https://api.github.com/repos/Heroic-Games-Launcher/HeroicGamesLauncher/releases/latest"

rpm_url=$(
    curl -fsSL "$API" |
    jq -r '.assets[]
        | select(.name | test("linux-x86_64\\.rpm$"))
        | .browser_download_url'
)

tmp=$(mktemp --suffix=.rpm)

curl -L "$rpm_url" -o "$tmp"

dnf5 install -y "$tmp"

rm -f "$tmp"
