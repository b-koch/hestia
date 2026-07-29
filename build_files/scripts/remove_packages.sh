#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

for list in /ctx/packages/remove/*; do
    [ -f "$list" ] || continue

    echo "Removing $(basename "$list")"

    mapfile -t packages < <(read_list "$list")

    if [ "${#packages[@]}" -gt 0 ]; then
        dnf5 remove -y --skip-unavailable "${packages[@]}" || true
    fi
done
