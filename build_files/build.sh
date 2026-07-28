#!/usr/bin/env bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

echo "Adding repositories..."
/ctx/scripts/repos.sh

echo "Removing unwanted packages..."
/ctx/scripts/remove_packages.sh

echo "Installing packages..."
/ctx/scripts/install_packages.sh

echo "Applying configuration..."
/ctx/scripts/configure.sh

echo "Verifying important packages, services and commands..."
/ctx/scripts/verify_packages.sh
/ctx/scripts/verify_services.sh
/ctx/scripts/verify_commands.sh

### Install packages

# Packages can be installed from any enabled yum repo on the image.
# RPMfusion repos are available by default in ublue main images
# List of rpmfusion packages can be found here:
# https://mirrors.rpmfusion.org/mirrorlist?path=free/fedora/updates/43/x86_64/repoview/index.html&protocol=https&redirect=1

# this installs a package from fedora repos
dnf5 install -y tmux

# Use a COPR Example:
#
# dnf5 -y copr enable ublue-os/staging
# dnf5 -y install package
# Disable COPRs so they don't end up enabled on the final image:
# dnf5 -y copr disable ublue-os/staging

#### Example for enabling a System Unit File

systemctl enable podman.socket
