#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/manage_coprs.sh

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    repo_name="$(basename "$repo")"
    target="/etc/yum.repos.d/${repo_name}"

    if [ -f "$target" ]; then
        echo "Enabling: $target"
        sed -i 's/^enabled=0/enabled=1/' "$target"
    fi
done

# Debug
shopt -s dotglob nullglob

dir="${1:-/ctx/repos}"

for f in "$dir"/*; do
    echo "$f"
done