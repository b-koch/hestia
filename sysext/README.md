# Hestia sysext extensions

Builds [systemd-sysext](https://www.freedesktop.org/software/systemd/man/latest/systemd-sysext.html)
extensions for apps that don't belong baked into the base `hestia` image, and
publishes each one as its own OCI image on GHCR. The running system pulls
and merges them at boot / daily (see `../system_files/usr/libexec/hestia-sysext-fetch.sh`).

Everything needed to build lives in this directory. Only the workflow file
(`../.github/workflows/sysext.yml`) has to live outside it, because GitHub
requires workflows to be under `.github/workflows/`.

## Layout

```
sysext/
  Containerfile       # multi-stage build; context is this directory
  Justfile             # just build/push helpers
  build-sysext.sh      # generic builder, runs inside the container
  lib/read_list.sh     # shared helper (comment/blank stripping)
  apps/<name>/
    packages           # optional: plain list of repo package names
    rpms/*.sh           # optional: each script echoes an RPM URL to install
    repos/*.repo        # optional: yum repo files, gpgkey= is auto-imported
    install.sh          # optional: post-install fixups, $ROOTFS is set
```

At least one of `packages`, `rpms/*.sh` must produce something to install,
unless `install.sh` populates the rootfs itself.

## How it builds

Each app is built by running `dnf5 --installroot=/out --use-host-config`
**inside a container based on `ghcr.io/b-koch/hestia:latest`** (see
`Containerfile`). This means:

- No nested/privileged containers, no downloading+extracting RPMs by hand.
- Packages resolve against exactly the repos and versions already
  configured in your own image, so there's no risk of a sysext linking
  against a different glibc/library set than the host.
- Only your current image is targeted -- no multi-Fedora-version matrix.

After installing, `build-sysext.sh` writes
`usr/lib/extension-release.d/extension-release.<app>` (`ID=_any` so it
applies regardless of the host's `ID=`, `VERSION_ID` pinned to the Fedora
release baked into `hestia:latest` at build time), strips everything except
`/usr`, and fails the build if anything is left under `/opt` (Bazzite/Fedora
here don't reliably merge `/opt` from sysext -- relocate it into `/usr/lib`
in `install.sh` instead, see `apps/bitwarden/install.sh`).

The final image is `FROM scratch` containing just that payload -- pulling
`ghcr.io/b-koch/sysext-<app>:latest` and extracting it
(`podman create` + `podman cp ctr:/. dest/`) gives exactly the directory
layout `systemd-sysext` expects under `/var/lib/extensions/<app>/`.

## Adding your own app

1. `mkdir -p sysext/apps/<name>`
2. Add `packages` and/or `repos/*.repo` and/or `rpms/*.sh`, plus an
   `install.sh` if the package drops files somewhere other than `/usr`
   (look at `apps/bitwarden` for the `/opt` relocation pattern, and
   `apps/vscode` for the plain-repo-package pattern).
3. Test locally: `cd sysext && just build <name> && podman run --rm -it
   localhost/... ` (or just inspect `/out` from the builder stage).
4. Add `<name>` to `../system_files/etc/hestia/sysext-apps.list` so the
   running image actually pulls it -- this file lives outside `sysext/`, so
   editing it triggers a normal image rebuild via `../.github/workflows/build.yml`.
5. Push -- `.github/workflows/sysext.yml` picks up any new directory under
   `sysext/apps/` automatically, no workflow changes needed.

## Registry visibility

The workflow pushes to `ghcr.io/b-koch/sysext-<app>` using the repo's own
`GITHUB_TOKEN`, same as the main image build. Because the source repo is
private, each of these packages is private-by-default on first push, and
`hestia-sysext-fetch.sh` on the client pulls anonymously (no credentials
baked into the image). So each new package needs a **one-time manual**
visibility flip to public after its first push:

GitHub -> your profile -> Packages -> `sysext-<app>` -> Package settings ->
Change visibility -> Public.

(This can't safely be automated from the workflow's `GITHUB_TOKEN` -- package
visibility changes need to be made as you, not as the Actions bot. If you'd
rather keep them private, use a read-only PAT baked into the image instead
and I can wire that up.)
