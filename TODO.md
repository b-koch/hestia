# Hestia TODOs

* Make sure systemd-sysext is enabled by default!
* Move package installs to sysext builds! (Inspiration: [fedora-sysexts](https://github.com/fedora-sysexts/community))
* Virtualization: native or sysext?
* Automatically find the correct base image version number (e.g.: 44 for fedora 44) by looking at the version of ghcr.io/b-koch/hestia:latest in the relevant /sysext/.. scripts, for the sysext workflows and the workflow templates and wherever else needed. So it auto updates the image versions, etc...
* enable services (libvirtd)
* sudo usermod -aG libvirt $USER