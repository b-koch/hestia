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

echo "Installing custom external applications..."
/ctx/scripts/install_custom.sh

echo "Disabling repositories..."
/ctx/scripts/disable_repos.sh

echo "Updating ujust imports..."
/ctx/scripts/update_ujust_imports.sh

echo "Adding Bitwarden Policy to Polkit"
/ctx/scripts/add_bitwarden_polkit_policy.sh

echo "Applying configurations..."
/ctx/scripts/configure.sh # should be the last configuration script to be run

echo "Adding Hestia branding..."
/ctx/scripts/hestia_branding.sh

echo "Building initramfs..."
/ctx/scripts/build-initramfs.sh

echo "Final cleanup..."
/ctx/scripts/cleanup.sh