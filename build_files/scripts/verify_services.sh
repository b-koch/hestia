#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

FAILED=0

for file in /ctx/services/verify/*; do
    [ -f "$file" ] || continue

    echo "Verifying services: $(basename "$file")"

    while read -r service; do
        [[ -z "$service" || "$service" =~ ^# ]] && continue

        if systemctl list-unit-files "$service" >/dev/null 2>&1; then
            echo "  OK: $service"
        else
            echo "  MISSING: $service"
            FAILED=1
        fi
    done < <(read_list "$file")
done

exit "$FAILED"
