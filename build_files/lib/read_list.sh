#!/usr/bin/env bash

read_list() {
    local file="${1:-/dev/stdin}"

    if [[ "$file" != "/dev/stdin" && ! -f "$file" ]]; then
        echo "Error: File '$file' not found." >&2
        return 1
    fi

    while IFS= read -r line || [[ -n "$line" ]]; do
        # Strip trailing inline comments
        line="${line%%#*}"

        # Remove leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"

        # Remove trailing whitespace
        line="${line%"${line##*[![:space:]]}"}"

        # Skip empty lines
        [[ -z "$line" ]] && continue

        printf '%s\n' "$line"
    done < "$file"
}