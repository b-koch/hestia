# Hestia TODOs

* Check additions (packages/rpms) for updates daily and trigger a build in case they have updates.
* Make sure systemd-sysext is enabled by default!
* Figure out how to use sysext and if it's even good for my needs.
* Move package installs to sysext builds! (Inspiration: [fedora-sysexts](https://github.com/fedora-sysexts/community))
* Virtualization: native or sysext?
* Automatically find the correct base image version number (e.g.: 44 for fedora 44) by looking at the version of ghcr.io/b-koch/hestia:latest in the relevant /sysext/.. scripts, for the sysext workflows and the workflow templates and wherever else needed. So it auto updates the image versions, etc...
* ?check if still relevant?: enable services (libvirtd)
* ?check if still relevant?: sudo usermod -aG libvirt $USER