#!/usr/bin/env bash

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
