#!/usr/bin/env bash

set -euox pipefail

PACKAGES_INSTALL_DIR="/ctx/packages/install"
packages=()

shopt -s nullglob

if [ -d "$PACKAGES_INSTALL_DIR" ]; then
    for file in "$PACKAGES_INSTALL_DIR"/*; do
        if [ -f "$file" ]; then
            echo "Reading packages from: $(basename "$file")"
            
            while IFS= read -r pkg; do
                packages+=("$pkg")
            done < <(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$file")
        fi
    done
fi

shopt -u nullglob

if [ ${#packages[@]} -gt 0 ]; then
    echo "Installing ${#packages[@]} packages..."
    dnf5 install -y "${packages[@]}"
else
    echo "No package files found in ${PACKAGES_INSTALL_DIR}."
fi
