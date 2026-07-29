#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SCRIPT_DIR}/../build_files/repos"
SOURCE_FILE="${REPO_DIR}/sources.list"

mkdir -p "$REPO_DIR"

command -v curl >/dev/null || {
    echo "curl is required."
    exit 1
}

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "Repository source list not found:"
    echo "  $SOURCE_FILE"
    exit 1
fi

while IFS='|' read -r filename url; do
    # Skip comments and blank lines
    [[ -z "${filename// }" ]] && continue
    [[ "$filename" =~ ^# ]] && continue

    echo "Updating $filename..."

    tmp="$(mktemp)"

    if curl -fsSL "$url" -o "$tmp"; then
        if cmp -s "$tmp" "${REPO_DIR}/${filename}" 2>/dev/null; then
            rm "$tmp"
            echo "  ✓ Already up to date"
        else
            mv "$tmp" "${REPO_DIR}/${filename}"
            echo "  ✓ Updated"
        fi
    else
        rm -f "$tmp"
        echo "  ✗ Failed"
    fi
done < "$SOURCE_FILE"


echo
echo "Repository update complete."
