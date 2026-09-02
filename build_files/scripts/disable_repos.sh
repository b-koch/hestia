#!/usr/bin/env bash
set -euo pipefail

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    repo_name="$(basename "$repo")"
    target="/etc/yum.repos.d/${repo_name}"

    if [ -f "$target" ]; then
        sed -i 's/^enabled=1/enabled=0/' "$target"
    fi
done

echo "Disabling COPRs..."
dnf copr disable -y deltacopy/darkly
dnf copr disable -y matinlotfali/KDE-Rounded-Corners
dnf copr disable -y cboxdoerfer/fsearch 