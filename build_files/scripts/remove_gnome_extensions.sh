#!/usr/bin/env bash
set -euo pipefail

EXTENSIONS=(
  "block-caribou-36@lxylxy123456.ercli.dev"
  "blur-my-shell@aunetx"
  "burn-my-windows@schneegans.github.com"
  "compiz-alike-magic-lamp-effect@hermes83.github.com"
  "compiz-windows-effect@hermes83.github.com"
  "desktop-cube@schneegans.github.com"
  "gsconnect@andyholmes.github.io"
  "user-theme@gnome-shell-extensions.gcampax.github.com"
)

for extension in "${EXTENSIONS[@]}"; do
  rm -rf "/usr/share/gnome-shell/extensions/${extension}"
done