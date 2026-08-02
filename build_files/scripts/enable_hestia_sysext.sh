#!/usr/bin/env bash
set -euo pipefail

chmod +x /usr/libexec/hestia-sysext-fetch.sh

# systemd-sysext.service itself ships with systemd; it's just not enabled by
# default. hestia-sysext-fetch.timer pulls/refreshes the configured apps
# from GHCR and restarts systemd-sysext.service whenever anything changed.
systemctl enable systemd-sysext.service
systemctl enable hestia-sysext-fetch.timer
