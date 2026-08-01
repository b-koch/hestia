#!/usr/bin/env bash
set -euo pipefail

groupadd --system libvirt
getent group libvirt