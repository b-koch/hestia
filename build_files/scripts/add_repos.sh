#!/usr/bin/env bash
set -euo pipefail

mkdir -p /etc/yum.repos.d

# Check which Fedora version is currently running
RELEASEVER="$(rpm -E '%{fedora}' 2>/dev/null)"

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    echo "Installing repo: $(basename "$repo")"
    cp "$repo" /etc/yum.repos.d/

    # Extract gpgkey lines, automatically replace variables, and import them
    while IFS= read -r key_url; do
        if [[ -n "$key_url" ]]; then
            # Swaps out $releasever / ${releasever} with the live version
            key_url="${key_url//\$releasever/$RELEASEVER}"
            key_url="${key_url//\$\{releasever\}/$RELEASEVER}"

            echo "Importing GPG key: $key_url"
            rpm --import "$key_url"
        fi
    done < <(grep -E '^\s*gpgkey\s*=' "$repo" | sed 's/.*=\s*//')
done

dnf5 copr enable deltacopy/darkly