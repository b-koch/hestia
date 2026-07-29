#!/usr/bin/env bash
set -euo pipefail

echo "Restoring stock Fedora logos/icons/plymouth watermark..."
dnf5 reinstall -y fedora-logos

echo "Removing unreferenced Bazzite-only logo assets..."
rm -f /usr/share/icons/hicolor/scalable/places/bazzite-logo-le.svg
for size in 16x16 22x22 24x24 32x32 36x36 48x48 96x96 256x256; do
    rm -f "/usr/share/icons/hicolor/${size}/bazzite-logo-icon.png"
done

echo "Rewriting /usr/lib/os-release for Hestia..."
sed -i \
  -e 's/^ID=.*/ID=hestia/' \
  -e 's/^VARIANT_ID=.*/VARIANT_ID=hestia/' \
  -e 's/^PRETTY_NAME=.*/PRETTY_NAME="Hestia"/' \
  -e 's/^NAME=.*/NAME="Hestia"/' \
  -e 's/^DEFAULT_HOSTNAME=.*/DEFAULT_HOSTNAME="hestia"/' \
  -e 's/^LOGO=.*/LOGO=fedora-logo-icon/' \
  -e 's|^HOME_URL=.*|HOME_URL="https://github.com/b-koch/hestia"|' \
  -e 's|^DOCUMENTATION_URL=.*|DOCUMENTATION_URL="https://github.com/b-koch/hestia#readme"|' \
  -e 's|^SUPPORT_URL=.*|SUPPORT_URL="https://github.com/b-koch/hestia/discussions"|' \
  -e 's|^BUG_REPORT_URL=.*|BUG_REPORT_URL="https://github.com/b-koch/hestia/issues"|' \
  -e 's|^CPE_NAME="cpe:/o:universal-blue:bazzite|CPE_NAME="cpe:/o:b-koch:hestia|' \
  -e 's/^BOOTLOADER_NAME=.*/BOOTLOADER_NAME="Hestia"/' \
  /usr/lib/os-release

echo "Fixing /etc/system-release..."
sed -i 's/Bazzite/Hestia/g' /etc/system-release

echo "Catching any remaining literal Bazzite/bazzite references (BUILD_ID, IMAGE_ID, etc.)..."
sed -i \
  -e 's/Bazzite/Hestia/g' \
  -e 's/bazzite/hestia/g' \
  /usr/lib/os-release

echo "Pointing fastfetch at its built-in Fedora logo instead of Bazzite's ASCII art..."

cat > /usr/share/ublue-os/bazzite/fastfetch.jsonc <<'HESTIA_FASTFETCH_EOF'
{
    "$schema": "https://github.com/fastfetch-cli/fastfetch/raw/dev/doc/json_schema.json",
    "logo": {
        "type": "builtin",
        "source": "Fedora"
    },
    "display": {
        "separator": "  ",
        "color": {
            "keys": "light_blue"
        }
    },
    "modules": [
        {
            "type": "title",
            "key": " ",
            "color": {
                "user": "light_blue",
                "at": "white",
                "host": "magenta"
            }
        },
        "break",
        {
            "type": "command",
            "key": " 󱋩",
            "text": "/usr/libexec/bazzite-fetch-image"
        },
        {
            "type": "os",
            "key": " 󰣛",
            "format": "{pretty-name}"
        },
        {
            "type": "kernel",
            "key": " ",
            "format": "{1} {2}"
        },
        {
            "type": "uptime",
            "key": " 󰅐"
        },
        "break",
        {
            "type": "host",
            "key": " 󰾰"
        },
        {
            "type": "cpu",
            "key": " 󰻠"
        },
        {
            "type": "gpu",
            "key": " 󰍛"
        },
        {
            "type": "memory",
            "key": " "
        },
        {
            "type": "disk",
            "key": " ",
            "hideFS": "overlay"
        },
        {
            "type": "display",
            "key": " 󰍹"
        },
        {
            "type": "battery",
            "key": " "
        },
        {
            "type": "gamepad",
            "key": " 󰖺"
        },
        "break",
        {
            "type": "de",
            "key": " 󰕮"
        },
        {
            "type": "wm",
            "key": " "
        },
        {
            "type": "shell",
            "key": " "
        },
        {
            "type": "terminal",
            "key": " "
        },
        {
            "type": "packages",
            "key": " 󰏖"
        },
        "break",
        {
            "type": "colors",
            "paddingLeft": 2,
            "symbol": "circle"
        }
    ]
}
HESTIA_FASTFETCH_EOF

echo "Checking whether a genuine Fedora default wallpaper is available..."
FEDORA_VERSION="$(rpm -E %fedora)"
BAZZITE_BG_OVERRIDE="/usr/share/glib-2.0/schemas/zz0-04-bazzite-desktop-silverblue-theme.gschema.override"
if dnf5 install -y "f${FEDORA_VERSION}-backgrounds-gnome" 2>/dev/null; then
    FEDORA_BG_XML="$(find /usr/share/gnome-background-properties -maxdepth 1 -iname "f${FEDORA_VERSION}*.xml" 2>/dev/null | head -n1)"
    if [[ -n "$FEDORA_BG_XML" ]]; then
        FEDORA_BG_LIGHT="$(grep -oP '(?<=<filename>).*?(?=</filename>)' "$FEDORA_BG_XML" | head -n1)"
        FEDORA_BG_DARK="$(grep -oP '(?<=<filename-dark>).*?(?=</filename-dark>)' "$FEDORA_BG_XML" | head -n1)"
        [[ -z "$FEDORA_BG_DARK" ]] && FEDORA_BG_DARK="$FEDORA_BG_LIGHT"
        if [[ -n "$FEDORA_BG_LIGHT" ]]; then
            echo "Found $FEDORA_BG_XML -> switching default wallpaper to $FEDORA_BG_LIGHT"
            sed -i \
              -e "s|picture-uri='file:///usr/share/backgrounds/convergence-dynamic.xml'|picture-uri='file://${FEDORA_BG_LIGHT}'|" \
              -e "s|picture-uri-dark='file:///usr/share/backgrounds/convergence-dynamic.xml'|picture-uri-dark='file://${FEDORA_BG_DARK}'|" \
              "$BAZZITE_BG_OVERRIDE"
            glib-compile-schemas /usr/share/glib-2.0/schemas
        else
            echo "WARNING: f${FEDORA_VERSION}-backgrounds-gnome installed but no <filename> found in $FEDORA_BG_XML; leaving Bazzite wallpaper as default."
        fi
    else
        echo "WARNING: f${FEDORA_VERSION}-backgrounds-gnome installed but no matching gnome-background-properties XML found; leaving Bazzite wallpaper as default."
    fi
else
    echo "WARNING: f${FEDORA_VERSION}-backgrounds-gnome is not available; leaving Bazzite's wallpaper as the default for now. Nothing was broken - install it manually later if you want to switch."
fi