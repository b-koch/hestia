#!/usr/bin/env bash
set -oue pipefail

OVERRIDE_DIR="/ctx/flatpaks/overrides"

if [[ ! -d "$OVERRIDE_DIR" ]]; then
    echo "No Flatpak overrides directory found."
    exit 0
fi

for file in "$OVERRIDE_DIR"/*; do
    [[ -f "$file" ]] || continue

    app_id="$(basename "$file")"
    
    if ! flatpak info "$app_id" >/dev/null 2>&1; then
		echo "  Skipping (Flatpak not installed)"
		continue
	fi

    echo
    echo "Applying Flatpak override: $app_id"

    args=()

    while IFS= read -r line; do
        [[ -z "${line// }" ]] && continue
        [[ "$line" =~ ^# ]] && continue

        args+=("$line")
    done < "$file"

    if [[ ${#args[@]} -eq 0 ]]; then
        echo "  No arguments found in $app_id."
        continue
    fi

    flatpak override --system "${args[@]}" "$app_id"

    echo "  ✓ Applied"
done

echo
echo "Flatpak overrides complete."
