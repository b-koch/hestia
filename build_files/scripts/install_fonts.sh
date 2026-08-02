#!/usr/bin/env bash
set -euox pipefail

FONTS_INSTALL_DIR="/ctx/definitions/fonts/install"

executed_count=0

# Handle empty matches cleanly without throwing errors
shopt -s nullglob

if [ -d "$FONTS_INSTALL_DIR" ]; then
    for script in "$FONTS_INSTALL_DIR"/*.sh; do
        if [ -f "$script" ]; then
            echo "Running font installation script: $(basename "$script")"
            
            bash "$script"
            executed_count=$((executed_count + 1))
        fi
    done
fi

# Reset nullglob
shopt -u nullglob

if [ "$executed_count" -gt 0 ]; then
    echo "Successfully executed ${executed_count} font installation script(s)."
    echo "Updating system font cache..."
    fc-cache -f /usr/share/fonts
else
    echo "No font scripts found in ${FONTS_INSTALL_DIR}."
fi
