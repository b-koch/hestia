#!/usr/bin/env bash
set -euo pipefail

mkdir -p /etc/yum.repos.d

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    echo "Installing repo: $(basename "$repo")"
    cp "$repo" /etc/yum.repos.d/

    # Extract all gpgkey URLs from the repo file and import them
    while IFS= read -r key_url; do
        if [[ -n "$key_url" ]]; then
            echo "Importing GPG key: $key_url"
            rpm --import "$key_url"
        fi
    done < <(grep -E '^\s*gpgkey\s*=' "$repo" | sed 's/.*=\s*//')
done
