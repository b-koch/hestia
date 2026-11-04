#!/usr/bin/env bash
set -euo pipefail

dnf5 config-manager enable \
    terra \
    terra-extras \
    terra-mesa