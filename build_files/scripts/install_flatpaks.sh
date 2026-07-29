#!/usr/bin/env bash
set -ouex pipefail

FLATPAK_DIR="/ctx/flatpaks/install"
OVERRIDE_DIR="/ctx/flatpaks/overrides"

APPS=()
OVERRIDE_CMDS=()

# Parse install list files
if [[ -d "$FLATPAK_DIR" ]]; then
    for list in "$FLATPAK_DIR"/*; do
        [[ -f "$list" ]] || continue
        while IFS= read -r line; do
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            APPS+=("$line")
        done < "$list"
    done
fi

if [[ ${#APPS[@]} -eq 0 ]]; then
    echo "No Flatpaks configured for installation."
    exit 0
fi

# Parse override files and build exact 'flatpak override' command strings
if [[ -d "$OVERRIDE_DIR" ]]; then
    for file in "$OVERRIDE_DIR"/*; do
        [[ -f "$file" ]] || continue
        app_id="$(basename "$file")"

        args=()
        while IFS= read -r line; do
            [[ -z "${line// }" ]] && continue
            [[ "$line" =~ ^# ]] && continue
            args+=("$line")
        done < "$file"

        if [[ ${#args[@]} -gt 0 ]]; then
            OVERRIDE_CMDS+=("/usr/bin/flatpak override --system ${args[*]} $app_id")
        fi
    done
fi

# Format override commands for inline execution
OVERRIDES_INLINE=""
if [[ ${#OVERRIDE_CMDS[@]} -gt 0 ]]; then
    OVERRIDES_INLINE=" && $(IFS=" && "; echo "${OVERRIDE_CMDS[*]}")"
fi

echo "Baking ${#APPS[@]} Flatpak(s) and ${#OVERRIDE_CMDS[@]} override command(s) into systemd service..."

# Write the fully self-contained systemd oneshot service
cat <<EOF > /usr/lib/systemd/system/install-custom-flatpaks.service
[Unit]
Description=Install Custom Flatpaks and Overrides on First Boot
After=network-online.target flatpak-system-helper.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStartPre=/usr/bin/flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
ExecStart=/usr/bin/bash -c '\
  if [ ! -f /var/lib/custom-flatpaks-installed ]; then \
    /usr/bin/flatpak install --system --noninteractive --assumeyes flathub ${APPS[*]}${OVERRIDES_INLINE} && \
    touch /var/lib/custom-flatpaks-installed; \
  fi'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# 5. Enable service for host execution post-boot
systemctl enable install-custom-flatpaks.service
