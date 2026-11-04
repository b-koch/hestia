#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/manage_coprs.sh

for repo in /etc/yum.repos.d/*.repo; do
    [ -e "$repo" ] || continue

    if [ -f "$repo" ]; then
        sed -i 's/^enabled=1/enabled=0/' "$target"
    fi
done

disable_coprs