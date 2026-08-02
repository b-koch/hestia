#!/usr/bin/env bash

# Reads a file line by line, stripping surrounding whitespace, blank lines
# and '#' comments. Mirrors build_files/lib/read_list.sh so this directory
# stays self-contained (see sysext/README.md).

read_list() {
    local file="$1"

    while IFS= read -r line || [[ -n "$line" ]]; do
        # Remove leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"

        # Remove trailing whitespace
        line="${line%"${line##*[![:space:]]}"}"

        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^# ]] && continue

        printf '%s\n' "$line"
    done < "$file"
}
