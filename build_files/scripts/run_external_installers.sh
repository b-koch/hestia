#!/usr/bin/env bash

set -ouex pipefail

SCRIPT_DIR="/ctx/scripts/external"

for script in "$SCRIPT_DIR"/*.sh; do
    [ -f "$script" ] || continue

    echo "Running external installer: $(basename "$script")"

    # Copy to /tmp to make it writable
    TMP_SCRIPT="/tmp/$(basename "$script")"
    cp "$script" "$TMP_SCRIPT"
    
    chmod +x "$TMP_SCRIPT"
    "$TMP_SCRIPT"
    
    rm -f "$TMP_SCRIPT"
done
