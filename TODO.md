# Hestia TODOs

* Add proper copr installation logic
* Add/Fix Merkuro
* Rip out GNOME remnants
* Plasma Default settings
    * Caps Lock -> 3rd level chooser & Ctrl + Caps Lock -> default Caps Lock behavior
* Add Darkly GTK theme
* Add Fedora bold font fix: echo 'QT_NO_SYNTHESIZED_BOLD=1' | sudo tee -a /etc/environment.d/QT_NO_SYNTHESIZED_BOLD.conf
* Add additional widgets
* Check additions (packages/rpms) for updates daily and trigger a build in case they have updates.
* Partially move remnant cleanup to individual package removal. (/scripts/cleanup.sh)
* Make sure systemd-sysext is enabled by default!
* Figure out how to use sysext and if it's even good for my needs.
* Move package installs to sysext builds! (Inspiration: [fedora-sysexts](https://github.com/fedora-sysexts/community))
* Virtualization: native or sysext?
* Automatically find the correct base image version number (e.g.: 44 for fedora 44) by looking at the version of ghcr.io/b-koch/hestia:latest in the relevant /sysext/.. scripts, for the sysext workflows and the workflow templates and wherever else needed. So it auto updates the image versions, etc...
* ?check if still relevant?: enable services (libvirtd)
* ?check if still relevant?: sudo usermod -aG libvirt $USER
