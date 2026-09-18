#!/usr/bin/env bash
set -euo pipefail

systemctl --global enable fix-startup-notify.service
systemctl --global enable dmemcg-appslice-limit.service