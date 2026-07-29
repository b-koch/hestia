#!/usr/bin/env bash

read_list() {
    local file="$1"

    while IFS= read -r line; do
        # Remove leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"

        # Remove trailing whitespace
        line="${line%"${line##*[![:space:]]}"}"

        # Skip comments and blank lines
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^# ]] && continue

        printf '%s\n' "$line"
    done < "$file"
}
