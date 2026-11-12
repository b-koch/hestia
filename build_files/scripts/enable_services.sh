#!/usr/bin/env bash
set -euo pipefail

systemctl --global enable fix-startup-notify.service
systemctl --global enable mullvad-early-boot-blocking
systemctl --global enable mullvad-daemon