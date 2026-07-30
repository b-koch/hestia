#!/usr/bin/bash
set -euo pipefail

trap '[[ $BASH_COMMAND != echo* ]] && [[ $BASH_COMMAND != log* ]] && echo "+ $BASH_COMMAND"' DEBUG

log() {
  echo "=== $* ==="
}

log "Starting system cleanup"

gtk-update-icon-cache -f /usr/share/icons/hicolor
update-desktop-database /usr/share/applications

# Remove autostart files
# Example: rm /etc/skel/.config/autostart/steam.desktop

# Remove remnants
REMNANTS=(
  "/usr/share/applications/Waydroid"
  "/usr/share/applications/waydroid-container-restart.desktop"
  "/usr/share/applications/bazzite-documentation.desktop"
  "/usr/share/applications/discourse.desktop"
  "/usr/share/applications/com.gerbilsoft.rom-properties.rp-config.desktop"
  "/usr/share/applications/net.lutris.Lutris.desktop"
  "/usr/share/applications/net.lutris.Lutris1.desktop"
)

for target in "${REMNANTS[@]}"; do
  rm -rf "$target"
done

log "Cleanup completed"
