#!/usr/bin/env bash

set -euox pipefail

echo "Installing Filen..."

install -d /opt/Filen

dnf5 install -y \
    https://cdn.filen.io/@filen/desktop/release/latest/Filen_linux_x86_64.rpm

echo "Filen installed successfully."
