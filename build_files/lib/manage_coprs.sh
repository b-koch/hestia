#!/usr/bin/env bash
set -euo pipefail

COPRS_DIR="/ctx/repos/"
COPRS_FILE="${COPRS_DIR}/coprs.list"

manage_coprs() {
    local action="$1"   # "enable" or "disable"

    if [[ ! -f "$COPRS_FILE" ]]; then
        echo "Copr list not found:"
        echo "  $COPRS_FILE"
        exit 1
    fi

    while IFS='|' read -r name copr; do
        # Skip comments and blank lines
        [[ -z "${name// }" ]] && continue
        [[ "$name" =~ ^# ]] && continue

        dnf copr "$action" -y "$copr"
    done < "$COPRS_FILE"
}