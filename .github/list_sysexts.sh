#!/bin/bash

# SPDX-FileCopyrightText: Timothée Ravier <tim@siosm.fr>
# SPDX-License-Identifier: CC0-1.0

# Dynamically generate the list of sysexts to publish. Mainly used for the
# gather action in CI.

set -euo pipefail
# set -x

main() {
    # Ensure execution happens at the repository root
    cd "$(git rev-parse --show-toplevel)" || { echo "This script must be run within a git repository"; exit 1; }

    if [[ ! -d .github ]]; then
        echo "Could not find .github directory at the repository root."
        exit 1
    fi

    # Get the list of sysexts specifically from the sysext/ directory
    sysexts=()
    for s in $(git ls-tree -d --name-only HEAD sysext/ 2>/dev/null || true); do
        # Extract just the base directory name (e.g., 'vscode' from 'sysext/vscode')
        ext_name="${s#sysext/}"
        
        # Verify it exists locally and skip if it has an .ignore file
        if [[ ! -d "sysext/${ext_name}" ]] || [[ -f "sysext/${ext_name}/.ignore" ]]; then
            continue
        fi
        
        sysexts+=("${ext_name}")
    done
    
    echo "${sysexts[@]}"
}

main "${@}"