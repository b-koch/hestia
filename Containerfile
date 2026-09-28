# Allow build scripts to be referenced without being copied into the final image
FROM scratch AS ctx
COPY build_files /
COPY system_files /system_files

# Base Image
# Universal Blue Images: https://github.com/orgs/ublue-os/packages
FROM ghcr.io/ublue-os/bazzite-gnome:stable@sha256:ef1a79e7df811fa5c5b0bddde8af1f4729c945918556697d18eff91a62183c91

RUN rm -rf /opt && mkdir -p /opt

RUN --mount=type=bind,from=ctx,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/build.sh
    
### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
