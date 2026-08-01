#!/usr/bin/env bash
set -euo pipefail

if ! getent group libvirt > /dev/null; then
    groupadd --system libvirt
fi