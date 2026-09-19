#!/usr/bin/env bash

# Keep a small VRAM reserve to avoid hitting the physical limit.
RESERVE_MIB=100
RESERVE=$((RESERVE_MIB * 1024 * 1024))

wait_for() {
    local description=$1
    shift

    for _ in {1..120}; do
        if "$@"; then
            return 0
        fi
        sleep 1
    done

    echo "ERROR: timed out waiting for $description." >&2
    return 1
}

USER_ID=${1:?usage: $0 UID}

ensure_dmem_enabled() {
    local cgroup=$1

    grep -qw dmem "$cgroup/cgroup.controllers" || return 1
    grep -qw dmem "$cgroup/cgroup.subtree_control" 2>/dev/null && return 0

    printf '+dmem\n' > "$cgroup/cgroup.subtree_control" 2>/dev/null || true
    grep -qw dmem "$cgroup/cgroup.subtree_control" 2>/dev/null
}

USER_CGROUP="/sys/fs/cgroup/user.slice/user-${USER_ID}.slice/user@${USER_ID}.service"
APP_CGROUP="$USER_CGROUP/app.slice"

wait_for "user cgroup" test -d "$USER_CGROUP" || exit 1
wait_for "app.slice" test -d "$APP_CGROUP" || exit 1

wait_for "dmem controller enabled" ensure_dmem_enabled "$USER_CGROUP" || exit 1
wait_for "dmem controller enabled on app.slice" ensure_dmem_enabled "$APP_CGROUP" || exit 1

wait_for "app.slice dmem.max" test -f "$APP_CGROUP/dmem.max" || exit 1
wait_for "app.slice dmem.current" test -f "$APP_CGROUP/dmem.current" || exit 1

DEVICE=$(awk '/\/vram / { print $1; exit }' /sys/fs/cgroup/dmem.capacity)
CAPACITY=$(awk '/\/vram / { print $2; exit }' /sys/fs/cgroup/dmem.capacity)

if [[ -z "$DEVICE" || -z "$CAPACITY" ]]; then
    echo "ERROR: could not read GPU VRAM capacity." >&2
    exit 1
fi

LIMIT=$((CAPACITY - RESERVE))

if (( LIMIT <= 0 )); then
    echo "ERROR: VRAM reserve exceeds GPU capacity." >&2
    exit 1
fi

CURRENT=$(awk '/\/vram$/ { print $2; exit }' "$APP_CGROUP/dmem.current")

if [[ -n "$CURRENT" ]] && (( CURRENT > LIMIT )); then
    echo "ERROR: current VRAM usage exceeds the requested limit." >&2
    exit 1
fi

printf '%s %s\n' "$DEVICE" "$LIMIT" > "$APP_CGROUP/dmem.max"

echo "VRAM limit set to $LIMIT bytes for UID $USER_ID."