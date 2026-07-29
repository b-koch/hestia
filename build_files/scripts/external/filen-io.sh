#!/usr/bin/env bash

set -euox pipefail

dnf5 clean all
rm -rf /opt/Filen

echo "Installing Filen..."

mkdir -p /usr/lib/opt
dnf5 install -y https://cdn.filen.io/@filen/desktop/release/latest/Filen_linux_x86_64.rpm

echo "Filen installed successfully."
