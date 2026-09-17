#!/usr/bin/env bash
set -euo pipefail

dir="${HOME}/.local/share/applications"
[ -d "$dir" ] || exit 0

shopt -s nullglob
files=("$dir"/*.desktop)
[ ${#files[@]} -eq 0 ] && exit 0

sed -i 's/StartupNotify=true/StartupNotify=false/g' "${files[@]}"