#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

FAILED=0

for file in /ctx/verify/commands/*; do
    [ -f "$file" ] || continue

    echo "Verifying commands: $(basename "$file")"

    while read -r command; do
        [[ -z "$command" || "$command" =~ ^# ]] && continue

        if command -v "$command" >/dev/null 2>&1; then
            echo "  OK: $command"
        else
            echo "  MISSING: $command"
            FAILED=1
        fi
    done < <(read_list "$file")
done

exit "$FAILED"
