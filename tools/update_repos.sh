# This file is supposed to be run manually to update the .repo (dnf) files in this git-repository.
#!/usr/bin/env bash
set -euo pipefail
source ../build_files/lib/read_list.sh

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
done < <(read_list "$SOURCE_FILE")

echo
echo "Repository update complete."