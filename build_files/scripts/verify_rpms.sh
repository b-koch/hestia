#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

FAILED=0

for file in /ctx/rpms/verify/*; do
    [ -f "$file" ] || continue

    echo "Verifying rpms: $(basename "$file")"

    while read -r rpm; do
        [[ -z "$rpm" || "$rpm" =~ ^# ]] && continue

        if rpm -q "$rpm" >/dev/null 2>&1; then
            echo "  OK: $rpm"
        else
            echo "  MISSING: $rpm"
            FAILED=1
        fi
    done < <(read_list "$file")
done

exit "$FAILED"
