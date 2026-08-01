#!/usr/bin/env bash
set -euo pipefail

source /ctx/lib/read_list.sh

SERVICES_ENABLE_DIR="/ctx/build_files/services/enable"

shopt -s nullglob

if [ -d "$SERVICES_ENABLE_DIR" ]; then
    for file in "$SERVICES_ENABLE_DIR"/*; do
        if [ -f "$file" ]; then
            echo "Enabling services from: $(basename "$file")"

            while IFS= read -r service; do
                if [[ "$service" != *.* ]]; then
                    service="${service}.service"
                fi

                echo "  Enabling: $service"
                systemctl enable --now "$service"
            done < <(read_list "$file")
        fi
    done
else
    echo "No service files found in ${SERVICES_ENABLE_DIR}."
fi

shopt -u nullglob
