# vim: set ft=make :

# Prevent automatic suspend/sleep/hibernate.
[group("hestia")]
hestia-disable-suspend ACTION="":
    #!/usr/bin/bash
    sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
    gsettings set org.gnome.desktop.session idle-delay 0

# Install default Hestia flatpaks.
[group("hestia")]
hestia-install-flatpaks ACTION="":
    #!/usr/bin/bash
    /usr/libexec/hestia/install-flatpaks.sh