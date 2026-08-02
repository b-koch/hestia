#!/usr/bin/env bash
set -euo pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

echo "Adding repositories..."
/ctx/scripts/add_repos.sh

echo "Removing unwanted packages..."
/ctx/scripts/remove_packages.sh

echo "Installing packages..."
/ctx/scripts/install_packages.sh

echo "Installing external rpms..."
/ctx/scripts/install_rpms.sh

echo "Installing flatpaks..."
/ctx/scripts/install_flatpaks.sh

echo "Installing fonts..."
/ctx/scripts/install_fonts.sh

echo "Applying configuration..."
/ctx/scripts/configure.sh

echo "Enabling Hestia sysext auto-update..."
/ctx/scripts/enable_hestia_sysext.sh

echo "Disable repositories..."
/ctx/scripts/disable_repos.sh

echo "Add Hestia branding..."
/ctx/scripts/hestia_branding.sh

echo "Build initramfs"
/ctx/scripts/build-initramfs.sh

echo "Fixing Softmaker Office NX icons"
/ctx/scripts/fix_softmaker_icons.sh

echo "Final cleanup..."
/ctx/scripts/cleanup.sh
