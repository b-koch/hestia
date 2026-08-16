#!/usr/bin/bash
set -euxo pipefail

log() {
  echo "$*..."
}

log "Starting system cleanup"

log "Deleting broken icon symlinks"
find /usr/share/icons -xtype l -delete

# Remove autostart files
# Example: rm /etc/skel/.config/autostart/steam.desktop

log "Removing remnants"
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

log "Cleaning non-mounted /var state left behind in the layer"
rm -rf /var/lib/dnf /var/lib/rpm-state /var/log/*

log "Ensuring /var/tmp exists for ostree runtime"
mkdir -p /var/tmp
chmod 1777 /var/tmp

log "Cleanup completed"
