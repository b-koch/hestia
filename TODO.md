# Hestia TODOs
* Copy anti-deadzone script from /anti-deadzone during image build instead of having 2 files.
* Add installation of flatpaks from custom sources (e.g. Hylki)
* Check additions (packages/rpms) for updates daily and trigger a build in case they have updates.
* Partially move remnant cleanup to individual package removal. (/scripts/cleanup.sh)
* ?check if still relevant?: enable services (libvirtd)
* ?check if still relevant?: sudo usermod -aG libvirt $USER
