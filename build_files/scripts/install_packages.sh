#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

PACKAGES_INSTALL_DIR="/ctx/packages/install"
packages=()

shopt -s nullglob

if [ -d "$PACKAGES_INSTALL_DIR" ]; then
    for file in "$PACKAGES_INSTALL_DIR"/*; do
        if [ -f "$file" ]; then
            echo "========================================"
            echo "Reading package file: $(basename "$file")"

            while IFS= read -r pkg; do
                echo "  read_list returned: '$pkg'"
                packages+=("$pkg")
                echo "  added to array:     '$pkg'"
            done < <(read_list "$file")
        fi
    done
fi

shopt -u nullglob

if [ ${#packages[@]} -gt 0 ]; then
    echo "========================================"
	echo "Final package list (${#packages[@]} packages):"

	for pkg in "${packages[@]}"; do
		echo "  - $pkg"
	done

	echo "========================================"
	echo "Running:"
	printf 'dnf5 install -y %q ' "${packages[@]}"
	echo
	echo "========================================"

	set -x
	dnf5 install -y "${packages[@]}"
else
    echo "No package files found in ${PACKAGES_INSTALL_DIR}."
fi
