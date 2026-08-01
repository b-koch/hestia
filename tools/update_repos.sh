#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

command -v curl >/dev/null || {
    echo "curl is required."
    exit 1
}

# Define repository configurations
# Format: "repo_dir|sources_file"
REPO_CONFIGS=(
    "${SCRIPT_DIR}/../repos|${SCRIPT_DIR}/../repos/sources.list"
    "${SCRIPT_DIR}/../sysext/repos|${SCRIPT_DIR}/../sysext/repos/sources.list"
)

update_repositories() {
    local repo_dir="$1"
    local sources_file="$2"
    
    echo "=== Processing: ${repo_dir} ==="
    
    mkdir -p "$repo_dir"
    
    if [[ ! -f "$sources_file" ]]; then
        echo "Warning: Repository source list not found:"
        echo "  $sources_file"
        echo "Skipping..."
        echo
        return 1
    fi
    
    local updated_count=0
    local failed_count=0
    local unchanged_count=0
    
    while IFS='|' read -r filename url; do
        # Skip comments and blank lines
        [[ -z "${filename// }" ]] && continue
        [[ "$filename" =~ ^# ]] && continue
        
        echo "  Updating $filename..."
        
        local tmp
        tmp="$(mktemp)"
        
        if curl -fsSL "$url" -o "$tmp"; then
            if cmp -s "$tmp" "${repo_dir}/${filename}" 2>/dev/null; then
                rm "$tmp"
                echo "    ✓ Already up to date"
                ((unchanged_count++))
            else
                mv "$tmp" "${repo_dir}/${filename}"
                echo "    ✓ Updated"
                ((updated_count++))
            fi
        else
            rm -f "$tmp"
            echo "    ✗ Failed to download"
            ((failed_count++))
        fi
    done < "$sources_file"
    
    echo "  Summary: ${updated_count} updated, ${unchanged_count} unchanged, ${failed_count} failed"
    echo
}

# Process all repository configurations
for config in "${REPO_CONFIGS[@]}"; do
    IFS='|' read -r repo_dir sources_file <<< "$config"
    update_repositories "$repo_dir" "$sources_file"
done

echo "Repository update complete."