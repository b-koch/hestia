#!/usr/bin/env bash
set -euo pipefail

source /ctx/lib/read_list.sh

SERVICES_DISABLE_DIR="/ctx/build_files/services/disable"

shopt -s nullglob

if [ -d "$SERVICES_DISABLE_DIR" ]; then
    for file in "$SERVICES_DISABLE_DIR"/*; do
        if [ -f "$file" ]; then
            echo "Disabling services from: $(basename "$file")"

            while IFS= read -r service; do
                if [[ "$service" != *.* ]]; then
                    service="${service}.service"
                fi

                echo "  Disabling: $service"
                systemctl disable --now "$service"
            done < <(read_list "$file")
        fi
    done
else
    echo "No service files found in ${SERVICES_DISABLE_DIR}."
fi

shopt -u nullglob