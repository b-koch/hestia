#!/usr/bin/env bash
set -euo pipefail

MANIFEST_DIR="/usr/lib/hestia"
MANIFEST_FILE="${MANIFEST_DIR}/sysext-categories.list"
CATEGORIES_DIR="/ctx/sysext-categories"

mkdir -p "$MANIFEST_DIR"
: > "$MANIFEST_FILE"

if [ -d "$CATEGORIES_DIR" ]; then
    for dir in "$CATEGORIES_DIR"/*/; do
        [ -d "$dir" ] || continue
        basename "$dir" >> "$MANIFEST_FILE"
    done
fi

echo "Sysext categories baked into manifest (${MANIFEST_FILE}):"
cat "$MANIFEST_FILE"
