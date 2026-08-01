# Allow build scripts to be referenced without being copied into the final image
FROM scratch AS ctx
COPY build_files /
COPY system_files /system_files
COPY lib /lib

# Only used to read the category *names* (for the sysext manifest) - the
# package lists/build logic inside sysext/ never run as part of this build.
COPY sysext/categories /sysext-categories

# Base Image
# Universal Blue Images: https://github.com/orgs/ublue-os/packages
FROM ghcr.io/ublue-os/bazzite-gnome:stable

RUN rm -f /opt
RUN sleep 2
RUN mkdir -p /opt

### MODIFICATIONS

RUN --mount=type=bind,from=ctx,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/build.sh
    
### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
