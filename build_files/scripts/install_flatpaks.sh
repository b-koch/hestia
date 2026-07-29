#!/usr/bin/env bash
set -ouex pipefail

FLATPAK_DIR="/ctx/flatpaks/install"

if [[ ! -d "$FLATPAK_DIR" ]]; then
    echo "No Flatpak installation directory found."
    exit 0
fi

echo "Ensuring Flathub remote exists..."

flatpak remote-add \
    --if-not-exists \
    flathub \
    https://dl.flathub.org/repo/flathub.flatpakrepo

for list in "$FLATPAK_DIR"/*; do
    [[ -f "$list" ]] || continue

    echo
    echo "Installing Flatpak group: $(basename "$list")"

    mapfile -t apps < <(
        grep -Ev '^\s*(#|$)' "$list"
    )

    if [[ ${#apps[@]} -eq 0 ]]; then
        echo "  No Flatpaks to install."
        continue
    fi

    flatpak install \
        --noninteractive \
        --assumeyes \
        flathub \
        "${apps[@]}"
done

echo
echo "Flatpak installation complete."