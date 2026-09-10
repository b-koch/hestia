#!/usr/bin/env bash
set -euo pipefail
source /ctx/lib/read_list.sh

FLATPAK_DIR="/ctx/definitions/flatpaks/install"
OVERRIDE_DIR="/ctx/definitions/flatpaks/overrides"

SCRIPT="/usr/libexec/hestia/install-flatpaks.sh"

mkdir -p /usr/libexec/hestia
mkdir -p /var/lib/hestia

APPS=()

# Read Flatpak install lists.
if [[ -d "$FLATPAK_DIR" ]]; then
    for list in "$FLATPAK_DIR"/*; do
        [[ -f "$list" ]] || continue

        while IFS= read -r app; do
            APPS+=("$app")
        done < <(read_list "$list")
    done
fi

echo "Generating Hestia Flatpak installer..."

cat > "$SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

flatpak remote-add \
    --if-not-exists \
    flathub \
    https://dl.flathub.org/repo/flathub.flatpakrepo
EOF

# Install Flatpaks.
for app in "${APPS[@]}"; do
    printf 'flatpak install --system --noninteractive --assumeyes flathub %q\n' "$app" >> "$SCRIPT"
done

# Apply overrides.
if [[ -d "$OVERRIDE_DIR" ]]; then
    for file in "$OVERRIDE_DIR"/*; do
        [[ -f "$file" ]] || continue

        app_id="$(basename "$file")"

        mapfile -t args < <(read_list "$file")

        if [[ ${#args[@]} -gt 0 ]]; then
            printf 'flatpak override --system ' >> "$SCRIPT"
            printf '%q ' "${args[@]}" >> "$SCRIPT"
            printf '%q\n' "$app_id" >> "$SCRIPT"
        fi
    done
fi

chmod +x "$SCRIPT"

echo "Flatpak installer created."