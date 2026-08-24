#!/usr/bin/env bash
set -euo pipefail

dnf5 install -y --setopt=tsflags=noscripts openrazer-daemon

if ! grep -q "^plugdev:" /etc/group; then
    grep "^plugdev:" /lib/group >> /etc/group
fi