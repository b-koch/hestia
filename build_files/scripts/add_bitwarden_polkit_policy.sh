#!/bin/bash
set -euo pipefail

sudo wget -O /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy https://raw.githubusercontent.com/bitwarden/clients/main/apps/desktop/resources/com.bitwarden.desktop.policy
sudo chown root:root /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy
sudo chcon system_u:object_r:usr_t:s0 /usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy