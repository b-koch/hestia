#!/usr/bin/env bash
set -euo pipefail

latest_url=$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/Windscribe/Desktop-App/releases/latest)

tag="${latest_url##*/}"
version="${tag#v}"

echo "https://github.com/Windscribe/Desktop-App/releases/download/${tag}/windscribe_${version}_amd64_fedora.rpm"