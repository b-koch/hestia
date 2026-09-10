#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

COPRS_DIR="/ctx/repos/"
COPRS_FILE="${COPRS_DIR}/coprs.list"

_manage_coprs() {
    local action="$1"

    if [[ ! -f "$COPRS_FILE" ]]; then
        echo "Copr list not found:"
        echo "  $COPRS_FILE"
        exit 1
    fi

    while IFS='|' read -r _ copr; do
        dnf copr "$action" -y "$copr"
    done < <(read_list "$COPRS_FILE")
}

enable_coprs() {
    _manage_coprs enable
}

disable_coprs() {
    _manage_coprs disable
}