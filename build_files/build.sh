#!/usr/bin/env bash

set -ouex pipefail

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

echo "Applying flatpak overrides..."
/ctx/scripts/apply-flatpak-overrides.sh

echo "Applying configuration..."
/ctx/scripts/configure.sh

echo "Verifying important packages, services and commands..."
#/ctx/scripts/verify_packages.sh
#/ctx/scripts/verify_services.sh
#/ctx/scripts/verify_commands.sh
#/ctx/scripts/verify_rpms.sh

echo "Removing repositories..."
/ctx/scripts/remove_repos.sh
