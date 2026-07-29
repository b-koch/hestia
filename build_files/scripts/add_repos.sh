#!/usr/bin/env bash

set -ouex pipefail

mkdir -p /etc/yum.repos.d

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    echo "Installing repo: $(basename "$repo")"
    cp "$repo" /etc/yum.repos.d/
done
