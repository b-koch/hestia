#!/usr/bin/env bash
set -euo pipefail

# Find the last import line
LAST_IMPORT_LINE=$(grep -n '^import[[:space:]]\+["\x27].*["\x27]' /usr/share/ublue-os/justfile | tail -n 1 | cut -d: -f1)

# Insert your custom imports after the last import
sed -i "${LAST_IMPORT_LINE}a import \"/usr/share/ublue-os/just/99-hestia.just\"" /usr/share/ublue-os/justfile