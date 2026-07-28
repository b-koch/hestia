#!/usr/bin/env bash

set -ouex pipefail

for list in /ctx/packages/remove/*; do
    [ -f "$list" ] || continue

    echo "Removing $(basename "$list")"

    mapfile -t packages < <(
        grep -v '^#' "$list" | grep -v '^$'
    )

    if [ "${#packages[@]}" -gt 0 ]; then
        dnf5 remove -y "${packages[@]}" || true
    fi
done
