#!/usr/bin/env bash

set -ouex pipefail

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    repo_name="$(basename "$repo")"
    target="/etc/yum.repos.d/${repo_name}"

    if [ -f "$target" ]; then
        sed -i 's/^enabled=1/enabled=0/' "$target"
    fi
done
