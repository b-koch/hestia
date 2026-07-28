#!/usr/bin/env bash

set -ouex pipefail

FAILED=0

for file in /ctx/verify/packages/*; do
    [ -f "$file" ] || continue

    echo "Verifying packages: $(basename "$file")"

    while read -r package; do
        [[ -z "$package" || "$package" =~ ^# ]] && continue

        if rpm -q "$package" >/dev/null 2>&1; then
            echo "  OK: $package"
        else
            echo "  MISSING: $package"
            FAILED=1
        fi
    done < "$file"
done

exit "$FAILED"
