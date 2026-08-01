#!/usr/bin/env bash
set -euo pipefail

STAMP="/var/lib/hestia/firstboot.done"

mkdir -p /var/lib/hestia

# Already ran?
[[ -f "$STAMP" ]] && exit 0

# Find the first "real" user (UID >= 1000)
USER_NAME=$(
    getent passwd |
    awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }'
)

if [[ -n "${USER_NAME:-}" ]]; then
    echo "Adding ${USER_NAME} to libvirt group..."
    usermod -aG libvirt "$USER_NAME"
fi

touch "$STAMP"
