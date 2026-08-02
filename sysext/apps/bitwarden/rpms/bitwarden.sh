#!/usr/bin/env bash
set -euo pipefail

# Bitwarden don't publish versioned URLs for their RPM; this redirect always
# resolves to the current release.
echo "https://bitwarden.com/download/?app=desktop&platform=linux&variant=rpm"
