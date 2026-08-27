#!/bin/bash
set -euo pipefail

POLICY="/usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy"

echo "Downloading policy to $POLICY..."
wget --no-hsts -O "$POLICY" https://raw.githubusercontent.com/bitwarden/clients/main/apps/desktop/resources/com.bitwarden.desktop.policy

echo "Changing owner for $POLICY..."
chown root:root "$POLICY"
chmod 0644 "$POLICY"