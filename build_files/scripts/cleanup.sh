#!/usr/bin/bash
set -euo pipefail

trap '[[ $BASH_COMMAND != echo* ]] && [[ $BASH_COMMAND != log* ]] && echo "+ $BASH_COMMAND"' DEBUG

log() {
  echo "=== $* ==="
}

log "Starting system cleanup"

# Delete broken icon symlinks
find /usr/share/icons -xtype l -delete

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
