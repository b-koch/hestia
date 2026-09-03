#!/usr/bin/env bash
set -euox pipefail

CUSTOM_INSTALL_DIR="/ctx/definitions/custom/install"

executed_count=0

# Handle empty matches cleanly without throwing errors
shopt -s nullglob

if [ -d "$CUSTOM_INSTALL_DIR" ]; then
    for script in "$CUSTOM_INSTALL_DIR"/*.sh; do
        if [ -f "$script" ]; then
            echo "Running custom application installation script: $(basename "$script")"
            
            bash "$script"
            executed_count=$((executed_count + 1))
        fi
    done
fi

# Reset nullglob
shopt -u nullglob

if [ "$executed_count" -gt 0 ]; then
    echo "Successfully executed ${executed_count} custom application installation script(s)."
else
    echo "No custom application scripts found in ${CUSTOM_INSTALL_DIR}."
fi
