#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

FAILED=0

for file in /ctx/packages/verify/*; do
    [ -f "$file" ] || continue

    echo "Verifying packages: $(basename "$file")"

    while IFS= read -r package; do
        if rpm -q "$package" >/dev/null 2>&1; then
            echo "  OK: $package"
        else
            echo "  MISSING: $package"
            FAILED=1
        fi
    done < <(read_list "$file")
done

exit "$FAILED"
