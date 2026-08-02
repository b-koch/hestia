#!/usr/bin/env bash
set -euo pipefail

echo '"Hestia sysexts" = "sudo /usr/libexec/hestia-sysext-fetch.sh"' \
    >> /etc/ublue-os/topgrade.toml


