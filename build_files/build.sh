#!/usr/bin/env bash
set -euo pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

echo "Removing unwanted packages..."
/ctx/scripts/remove_packages.sh

echo "Installing packages..."
/ctx/scripts/install_packages.sh

echo "Installing flatpaks..."
/ctx/scripts/install_flatpaks.sh

echo "Applying configuration..."
/ctx/scripts/configure.sh

echo "Add Hestia branding..."
/ctx/scripts/hestia_branding.sh

echo "Build initramfs"
/ctx/scripts/build-initramfs.sh

echo "Disable services..."
/ctx/scripts/disable_services.sh

echo "Enabling services..."
/ctx/scripts/enable_services.sh

echo "Manage groups..."
/ctx/scripts/manage_groups.sh

echo "Final cleanup..."
/ctx/scripts/cleanup.sh
