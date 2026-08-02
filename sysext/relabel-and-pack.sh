#!/usr/bin/env bash
set -euo pipefail

# Takes a sysext OCI image already built by `just build <app>` (Containerfile
# + build-sysext.sh), extracts its payload, relabels it with the *real*
# SELinux policy from ghcr.io/b-koch/hestia:latest (the same base every
# target host runs), and packs the result into a signed EROFS `.raw` sysext
# image.
#
# Why this exists: labels can't be baked in during `podman build` (RUN steps
# there can't reliably get CAP_MAC_ADMIN, see
# https://github.com/containers/podman/issues/5723), and even if they could,
# `security.selinux` is routinely stripped/replaced when container engines
# write or extract OCI layers -- every container gets its own transient
# label from the runtime, unrelated to whatever was on disk at commit time.
# That's why the old hestia-sysext-fetch.sh had to `restorecon` on the
# *host* after every `podman cp`, which is slow and leaves the system
# unbootable if a reboot happens mid-relabel.
#
# Doing it here instead, with a privileged `podman run` against a real
# filesystem, then packing straight into an EROFS image, means the labels
# are baked into the filesystem's own inode metadata. There's nothing left
# to lose in transit: the host just downloads one opaque file and loop-mounts
# it. No on-host SELinux work, ever.
#
# Must run as root (sudo) on a real filesystem (not on an SELinux-less
# system, and preferably not on tmpfs-backed /tmp on exotic setups -- GitHub
# Actions runners are fine).

APP="${1:?Usage: relabel-and-pack.sh <app> [tag]}"
TAG="${2:-latest}"
REGISTRY="${REGISTRY:?REGISTRY must be set, e.g. ghcr.io/b-koch}"
POLICY_IMAGE="${POLICY_IMAGE:-${REGISTRY}/hestia:latest}"
COMPRESSION="${COMPRESSION:-lz4}"

if [[ "${UID}" != "0" ]]; then
    echo "relabel-and-pack.sh must run as root (needed for setfiles/chcon)." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/dist"
mkdir -p "$DIST_DIR"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

IMAGE="${REGISTRY}/sysext-${APP}:${TAG}"
ROOTFS="${WORKDIR}/rootfs"
mkdir -p "$ROOTFS"

echo "=== Extracting ${IMAGE} ==="
ctr="$(podman create "$IMAGE")"
podman cp "${ctr}:/." "$ROOTFS/"
podman rm "$ctr" >/dev/null

RELEASEVER="$(podman run --rm "$POLICY_IMAGE" rpm -E '%{fedora}')"

echo "=== Relabeling SELinux contexts against ${POLICY_IMAGE}'s policy ==="
# --privileged is required (CAP_MAC_ADMIN etc) and is safe here: this is a
# throwaway container on a CI runner / your own machine, not the target
# host, and it only ever touches the bind-mounted $ROOTFS.
podman run --rm --privileged \
    --volume "${ROOTFS}:/rootfs" \
    "$POLICY_IMAGE" \
    bash -c '
        set -euo pipefail
        fc="/etc/selinux/targeted/contexts/files/file_contexts"
        cd /rootfs
        setfiles -v -r . "$fc" .
        chcon --user=system_u --recursive .
    '

echo "=== Packing EROFS image (${COMPRESSION}) ==="
RAW="${DIST_DIR}/sysext-${APP}-${TAG}.raw"
rm -f "$RAW"
mkfs.erofs "-z${COMPRESSION}" "$RAW" "$ROOTFS" >/dev/null

echo "=== Wrote ${RAW} ($(du -h "$RAW" | cut -f1), Fedora ${RELEASEVER}) ==="
