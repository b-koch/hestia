#!/usr/bin/bash
set -euxo pipefail

log() {
  echo "$*..."
}


log "Starting system cleanup"


log "Deleting broken icon symlinks"
find /usr/share/icons -xtype l -delete


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


log "Disabling StartupNotify for installed desktop entries"
sed -i 's/StartupNotify=true/StartupNotify=false/g' /usr/share/applications/*.desktop

remaining=$(grep -l 'StartupNotify=true' /usr/share/applications/*.desktop 2>/dev/null | wc -l || true)
log "Entries still enabling StartupNotify: ${remaining}"


log "Cleaning non-mounted /var state left behind in the layer"
rm -rf /var/lib/dnf /var/lib/rpm-state /var/log/*


log "Ensuring /var/tmp exists for ostree runtime"
mkdir -p /var/tmp
chmod 1777 /var/tmp


log "Cleanup completed"