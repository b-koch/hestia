#!/usr/bin/env bash

set -ouex pipefail

for repo in /ctx/repos/*.repo; do
    [ -e "$repo" ] || continue

    repo_name="$(basename "$repo")"
    rm -f "/etc/yum.repos.d/${repo_name}"
done
