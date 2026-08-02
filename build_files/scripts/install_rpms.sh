#!/usr/bin/env bash
set -euo pipefail

RPMS_INSTALL_DIR="/ctx/rpms/install"

urls=()

# Handle empty matches cleanly without throwing errors
shopt -s nullglob

if [ -d "$RPMS_INSTALL_DIR" ]; then
    for script in "$RPMS_INSTALL_DIR"/*.sh; do
        if [ -f "$script" ]; then
            echo "Resolving RPM URL from: $(basename "$script")"
            
            rpm_url=$("$script")
            urls+=("$rpm_url")
        fi
    done
fi

# Reset nullglob
shopt -u nullglob

if [ ${#urls[@]} -gt 0 ]; then
    echo "Installing ${#urls[@]} RPM packages..."
    dnf5 install -y "${urls[@]}"
else
    echo "No RPM scripts found in ${RPMS_INSTALL_DIR}."
fi
