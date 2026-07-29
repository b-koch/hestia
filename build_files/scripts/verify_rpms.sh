#!/usr/bin/env bash

set -ouex pipefail

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
    done < "$file"
done

exit "$FAILED"
