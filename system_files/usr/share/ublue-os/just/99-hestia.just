# vim: set ft=make :

# Prevent automatic suspend/sleep/hibernate.
[group("hestia")]
hestia-disable-suspend:
    #!/usr/bin/env bash
    sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
    gsettings set org.gnome.desktop.session idle-delay 0

# Add switch/move-to workspace shortcuts (meta and shift+meta for "<" and "y").
[group("hestia")]
hestia-set-workspace-shortcuts:
    #!/usr/bin/env bash
    gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Left', '<Super><Control>Left', '<Super>less']"
    gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Right', '<Super><Control>Right', '<Super>y']"
    gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Shift><Super>Left', '<Shift><Super>less']"
    gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Shift><Super>Right', '<Shift><Super>y']"

# Set the volume step amount (default: 2).
[group("hestia")]
hestia-set-volume-step step="2":
    #!/usr/bin/env bash
    gsettings set org.gnome.settings-daemon.plugins.media-keys volume-step {{ step }}

# Create GNOME overview categories.
[group("hestia")]
hestia-setup-app-folders:
    #!/usr/bin/env bash
    dconf reset -f "/org/gnome/desktop/app-folders/"
    gsettings set org.gnome.desktop.app-folders folder-children "['Office', 'Graphics', 'Development', 'Audio&Video', 'Games', 'Education', 'Network', 'Science', 'Settings', 'System', 'Utilities', 'GamingUtilities', 'Containers', 'Misc', 'Wine', 'YaST', 'Pardus']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Office/ categories "['Office', 'WordProcessor', 'Spreadsheet', 'Presentation', 'Scanning']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Office/ name "Office"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Development/ categories "['Development', 'IDE']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Development/ name "Development"
    gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" categories "['AudioVideo', 'Audio', 'Video', 'Recorder']"
    gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" name "Audio & Video"
    gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" apps "['com.blackmagicdesign.resolve.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ categories "['Game']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ name "Games"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ excluded-apps "['wine-winemine.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Education/ categories "['Education']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Education/ name "Education"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ categories "['Network', 'WebBrowser', 'FileTransfer']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ name "Web"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ excluded-apps "['steam.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Science/ categories "['Science']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Science/ name "Science"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Settings/ categories "['Settings']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Settings/ name "Settings"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/System/ categories "['System']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/System/ name "System"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Utilities/ categories "['Utility']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Utilities/ name "Utilities"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ categories "['Graphics', '2DGraphics', 'RasterGraphics']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ name "Graphics"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ excluded-apps "['org.gnome.Evince.desktop', 'simple-scan.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Wine/ categories "['X-Wine']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Wine/ name "Wine"
    gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Wine/" apps "['wine-winemine.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Containers/ name "Containers"
    gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Containers/" apps "['org.gnome.Boxes.desktop', 'virt-manager.desktop']"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Misc/ name "Misc"
    gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Misc/ apps "['com.blackmagicdesign.resolve-Panels.desktop', 'com.blackmagicdesign.resolve-Installer.desktop', 'com.blackmagicdesign.resolve-CaptureLogs.desktop']"

# Install default Hestia flatpaks.
[group("hestia")]
hestia-install-flatpaks:
    #!/usr/bin/env bash
    /usr/lib/hestia/install-flatpaks.sh

# Fetch steam art for non-steam games.
[group("hestia")]
hestia-fetch-steam-art:
    #!/usr/bin/env bash
    /usr/lib/hestia/steam-art-fetch.py

# Remove orphaned steam/proton prefixes.
[group("hestia")]
hestia-remove-orphaned-prefixes:
    #!/usr/bin/env bash
    /usr/lib/hestia/steam-remove-orphaned-prefixes.sh

# Disable StartupNotify for user .desktop entries.
[group("hestia")]
hestia-fix-startup-notify:
    #!/usr/bin/env bash
    /usr/lib/hestia/fix-startup-notify.sh

# Apply Samsung Odyssey G5 EDID fix to prevent AMD GPUs from being stuck at the lowest vram clock.
# The DisplayPort connector is detected automatically (matched by the monitor's EDID vendor/product ID).
# To skip detection, pass the port: ujust hestia-fix-edid DP-1
[group("hestia")]
hestia-fix-edid port="":
    #!/usr/bin/env bash
    set -euo pipefail

    EDID="edid/samsung-odyssey-g5-2560x1440-159hz-mclkfix.bin"
    PORT="{{ port }}"
    ODYSSEY_ID="4c2da774"   # EDID bytes 8-11: Samsung (SAM) + product 0x74A7

    if [[ ! -f "/usr/lib/firmware/$EDID" ]]; then
        echo "ERROR: /usr/lib/firmware/$EDID is missing from this image." >&2
        exit 1
    fi

    # Collect connected DisplayPort connectors (name without the "cardN-" prefix)
    # and the subset whose EDID identifies the Odyssey G5.
    connected=()
    matches=()
    for dir in /sys/class/drm/card*-DP-*; do
        [[ -e "$dir/status" ]] || continue
        [[ "$(cat "$dir/status")" == "connected" ]] || continue
        name="${dir##*/}"
        name="${name#card*-}"
        connected+=("$name")
        id="$(od -An -tx1 -j8 -N4 -v "$dir/edid" 2>/dev/null | tr -d ' \n' || true)"
        if [[ "$id" == "$ODYSSEY_ID" ]]; then
            matches+=("$name")
        fi
    done
    uniq_sorted() { if [[ $# -gt 0 ]]; then printf '%s\n' "$@" | sort -u; fi; }
    mapfile -t connected < <(uniq_sorted "${connected[@]}")
    mapfile -t matches < <(uniq_sorted "${matches[@]}")

    ports=()
    if [[ -n "$PORT" ]]; then
        ports=("$PORT")
    elif [[ ${#matches[@]} -gt 0 ]]; then
        ports=("${matches[@]}")
        echo "Odyssey G5 detected on: ${ports[*]}"
    elif [[ ${#connected[@]} -gt 0 ]]; then
        echo "Odyssey G5 not detected. Connected DisplayPort connectors:"
        PS3="Select the port to fix: "
        select choice in "${connected[@]}"; do
            if [[ -n "$choice" ]]; then
                ports=("$choice")
                break
            fi
        done
    else
        echo "ERROR: no connected DisplayPort connector found." >&2
        echo "Plug in the monitor, or pass the port explicitly: ujust hestia-fix-edid DP-1" >&2
        exit 1
    fi
    if [[ ${#ports[@]} -eq 0 ]]; then
        echo "No port selected, nothing changed." >&2
        exit 1
    fi

    value=""
    for p in "${ports[@]}"; do
        value+="${value:+,}$p:$EDID"
    done

    # Remove earlier entries for this file so switching ports does not stack kargs.
    delete_args=()
    for karg in $(sudo rpm-ostree kargs); do
        if [[ "$karg" == drm.edid_firmware=*"$EDID"* ]]; then
            delete_args+=(--delete-if-present="$karg")
        fi
    done

    sudo rpm-ostree kargs "${delete_args[@]}" --append-if-missing="drm.edid_firmware=$value"
    echo
    echo "Applied drm.edid_firmware=$value"
    echo "Reboot to activate it, then verify with:"
    echo "  sha256sum /sys/class/drm/card*-DP-*/edid /usr/lib/firmware/$EDID"

