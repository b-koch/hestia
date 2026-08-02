#!/usr/bin/env bash
set -euo pipefail

REQUIRED_GROUPS=(
    libvirt
)

for group in "${REQUIRED_GROUPS[@]}"; do
    if ! getent group "$group" > /dev/null; then
        echo "Creating missing system group: $group"
        groupadd --system "$group"
    fi
done