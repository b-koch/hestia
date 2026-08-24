#!/usr/bin/env bash
set -euo pipefail

dnf5 install -y --setopt=install_weak_deps=False \
    --exclude=openrazer-kernel-modules-dkms --exclude=dkms \
    openrazer-daemon