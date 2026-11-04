#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/manage_coprs.sh

for repo in /etc/yum.repos.d/*.repo; do
    [ -e "$repo" ] || continue

    if [ -f "$repo" ]; then
        echo "Enabling: $target"
        sed -i 's/^enabled=0/enabled=1/' "$target"
    fi
done

# Debug
shopt -s dotglob nullglob

dir="${1:-/etc/yum.repos.d/}"

for f in "$dir"/*; do
    echo "$f"
done