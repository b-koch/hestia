#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/b-koch/hestia-antideadzone"
ARCHIVE_URL="${REPO_URL}/archive/refs/heads/main.tar.gz"

echo "Installing hestia-antideadzone from ${REPO_URL}..."

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$ARCHIVE_URL" | tar -xz -C "$tmp_dir" --strip-components=1

# Install executable zipapp + /usr/bin symlink
install -Dm755 "$tmp_dir/dist/adz" /usr/lib/hestia/anti-deadzone/adz
ln -sf /usr/lib/hestia/anti-deadzone/adz /usr/bin/adz

# Install fallback system config & udev rule for /dev/uinput
install -Dm644 "$tmp_dir/config.example.json" /etc/hestia/anti-deadzone/config.json
install -Dm644 "$tmp_dir/packaging/udev/99-uinput.rules" /usr/lib/udev/rules.d/99-uinput.rules

# Install systemd user unit (seeds ~/.config/hestia/anti-deadzone/config.json on first start)
mkdir -p /usr/lib/systemd/user /usr/lib/systemd/user-preset
cat > /usr/lib/systemd/user/antideadzone.service <<'UNIT_EOF'
[Unit]
Description=Hestia Stick & Trigger Anti-Deadzone Daemon
After=graphical-session.target

[Service]
Type=simple
ExecStartPre=/usr/bin/sh -c 'mkdir -p "%h/.config/hestia/anti-deadzone" && { [ -f "%h/.config/hestia/anti-deadzone/config.json" ] || { [ -f /etc/hestia/anti-deadzone/config.json ] && cp /etc/hestia/anti-deadzone/config.json "%h/.config/hestia/anti-deadzone/config.json"; }; } || true'
ExecStart=/usr/lib/hestia/anti-deadzone/adz daemon
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
UNIT_EOF
chmod 0644 /usr/lib/systemd/user/antideadzone.service

printf 'enable antideadzone.service\n' > /usr/lib/systemd/user-preset/90-hestia-antideadzone.preset
chmod 0644 /usr/lib/systemd/user-preset/90-hestia-antideadzone.preset

echo "hestia-antideadzone installed successfully."
