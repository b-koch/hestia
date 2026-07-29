#!/usr/bin/env bash

set -ouex pipefail

SCRIPT_DIR="/ctx/scripts/external"

for script in "$SCRIPT_DIR"/*.sh; do
    [ -f "$script" ] || continue

    echo "Running external installer: $(basename "$script")"

    chmod +x "$script"
    "$script"
done