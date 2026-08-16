#!/usr/bin/env bash

set -euo pipefail

ENABLE_EXTENSIONS=(
    "force-max-brightness@b-koch.github.com",
    "caffeine@patapon.info",
    "advanced-media-controller@sanjai.com",
    "AlphabeticalAppGrid@stuarthayhurst",
    "copyous@boerdereinar.dev",
    "grand-theft-focus@zalckos.github.com",
    "no-overwiew@fthx",
    "pip-on-top@rafostar.github.com",
    "rounded-window-corners@fxgn",
    "status-area-horizontal-spacing@mathematical.coffee.gmail.com"
    "weatheroclock@CleaMenezesJr.github.io"
    "bluetooth-battery-monitor@v8v88v8v88.com"
)

DISABLE_EXTENSIONS=(
    "block-caribou-36@lxylxy123456.ercli.dev",
    "blur-my-shell@aunetx",
    "burn-my-windows@schneegans.github.com",
    "compiz-alike-magic-lamp-effect@hermes83.github.com",
    "compiz-windows-effect@hermes83.github.com",
    "desktop-cube@schneegans.github.com",
    "gsconnect@andyholmes.github.io",
    "user-theme@gnome-shell-extensions.gcampax.github.com"
)

OUTPUT="/usr/share/glib-2.0/schemas/zz1-01-hestia-extensions.gschema.override"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

get_extensions()
{
    local key="$1"

    gsettings get org.gnome.shell "$key" \
        | sed \
            -e 's/^@as //' \
            -e 's/^\[//' \
            -e 's/\]$//' \
            -e "s/'//g" \
            -e 's/, /\n/g' \
        | sed '/^[[:space:]]*$/d'
}


contains()
{
    local needle="$1"
    shift

    local item
    for item in "$@"; do
        [[ "$item" == "$needle" ]] && return 0
    done

    return 1
}


remove_item()
{
    local needle="$1"
    shift

    local item
    for item in "$@"; do
        [[ "$item" == "$needle" ]] || printf '%s\n' "$item"
    done
}


add_if_missing()
{
    local needle="$1"
    shift

    printf '%s\n' "$@"

    if ! contains "$needle" "$@"; then
        printf '%s\n' "$needle"
    fi
}


format_gvariant_array()
{
    local first=true
    local item

    printf '['

    for item in "$@"; do
        if [[ "$first" == true ]]; then
            first=false
        else
            printf ', '
        fi

        printf "'%s'" "$item"
    done

    printf ']'
}


# ---------------------------------------------------------------------------
# Read base image defaults
# ---------------------------------------------------------------------------

mapfile -t enabled_extensions < <(
    get_extensions enabled-extensions
)

mapfile -t disabled_extensions < <(
    get_extensions disabled-extensions
)


echo "Bazzite enabled extensions:"
printf '  %s\n' "${enabled_extensions[@]:-<none>}"

echo "Bazzite disabled extensions:"
printf '  %s\n' "${disabled_extensions[@]:-<none>}"


# ---------------------------------------------------------------------------
# Apply Hestia's changes
# ---------------------------------------------------------------------------

for extension in "${ENABLE_EXTENSIONS[@]}"; do
    if contains "$extension" "${disabled_extensions[@]}"; then
        echo "Enabling: $extension"

        mapfile -t disabled_extensions < <(
            remove_item "$extension" "${disabled_extensions[@]}"
        )

        if ! contains "$extension" "${enabled_extensions[@]}"; then
            enabled_extensions+=("$extension")
        fi
    else
        echo "Not disabled, ignoring enable request: $extension"
    fi
done

for extension in "${DISABLE_EXTENSIONS[@]}"; do
    if contains "$extension" "${enabled_extensions[@]}"; then
        echo "Disabling: $extension"

        mapfile -t enabled_extensions < <(
            remove_item "$extension" "${enabled_extensions[@]}"
        )

        if ! contains "$extension" "${disabled_extensions[@]}"; then
            disabled_extensions+=("$extension")
        fi
    else
        echo "Not enabled, ignoring disable request: $extension"
    fi
done


# ---------------------------------------------------------------------------
# Generate Hestia's override
# ---------------------------------------------------------------------------

mkdir -p "$(dirname "$OUTPUT")"

{
    echo "[org.gnome.shell]"
    printf 'enabled-extensions=%s\n' \
        "$(format_gvariant_array "${enabled_extensions[@]}")"
    printf 'disabled-extensions=%s\n' \
        "$(format_gvariant_array "${disabled_extensions[@]}")"
} > "$OUTPUT"


echo
echo "Generated:"
echo "  $OUTPUT"
echo
cat "$OUTPUT"