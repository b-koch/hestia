#!/bin/bash
set -euo pipefail

echo "Downloadaing policy to /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy..."
wget -O /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy https://raw.githubusercontent.com/bitwarden/clients/main/apps/desktop/resources/com.bitwarden.desktop.policy

echo "Changing owner for /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy..."
chown root:root /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy

echo "Changing security context for /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy..."
chcon system_u:object_r:usr_t:s0 /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy