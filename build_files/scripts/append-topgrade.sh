#!/usr/bin/env bash
set -euo pipefail

echo '"Hestia sysexts" = "/usr/libexec/hestia-sysext-fetch.sh"' \
    >> /etc/ublue-os/topgrade.toml
