# Allow build scripts to be referenced without being copied into the final image
FROM scratch AS ctx
COPY build_files /
COPY system_files /system_files

# Base Image
# Universal Blue Images: https://github.com/orgs/ublue-os/packages
FROM ghcr.io/ublue-os/bazzite-gnome:stable@sha256:ceb6f9ff57ac47bae560945b0a3fa61a14350c8c416d2a9ba91f33eb5860aa34

RUN rm -rf /opt && mkdir -p /opt

RUN --mount=type=bind,from=ctx,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/build.sh
    
### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
