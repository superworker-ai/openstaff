FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04

ARG TARGETARCH
ARG KASMVNC_VERSION=1.5.0
ARG PLAYWRIGHT_VERSION=1.63.0
ARG S6_OVERLAY_VERSION=3.2.3.2

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    HOME=/home/worker \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl dbus-x11 fonts-dejavu \
      fonts-noto-color-emoji git jq openbox procps python3 ripgrep scrot \
      tint2 tmux unzip util-linux wmctrl x11-utils xauth xclip xdotool xz-utils \
    && case "$TARGETARCH" in \
      amd64) \
        kasm_sha=f599fe02e2175b9817b6165f74a5d2bebdc73118dde9181ba3410963bed7ae1e; \
        s6_arch=x86_64; \
        s6_sha=e6befcc96a437a3831386ecfc51808c5d3e939dc5fe3c02ae9284599e8aa2408 ;; \
      arm64) \
        kasm_sha=c9199cf4753208bfb69fd016a9780242bebfc43370cc38c97d61e90a3c783e04; \
        s6_arch=aarch64; \
        s6_sha=b17f17a82e7a515c682a91edaf2ffdabb73f891981b6c1fd712115693a2f8b4c ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && kasm_deb="kasmvncserver_noble_${KASMVNC_VERSION}_${TARGETARCH}.deb" \
    && curl -fsSL "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/${kasm_deb}" -o /tmp/kasmvnc.deb \
    && echo "${kasm_sha}  /tmp/kasmvnc.deb" | sha256sum -c - \
    && apt-get install -y --no-install-recommends /tmp/kasmvnc.deb \
    && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" -o /tmp/s6-noarch.tar.xz \
    && echo "5379750ed30a84bbd2e2dd74847ba6b5bd29cd0b2e3ea2ec58049b57eb2eda12  /tmp/s6-noarch.tar.xz" | sha256sum -c - \
    && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${s6_arch}.tar.xz" -o /tmp/s6-arch.tar.xz \
    && echo "${s6_sha}  /tmp/s6-arch.tar.xz" | sha256sum -c - \
    && tar -C / -Jxpf /tmp/s6-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-arch.tar.xz \
    && npx --yes "playwright@${PLAYWRIGHT_VERSION}" install chromium --with-deps \
    && chrome_path="$(find /opt/ms-playwright -type f -path '*/chrome-linux*/chrome' | head -n 1)" \
    && test -n "$chrome_path" \
    && ln -s "$chrome_path" /usr/local/bin/chromium \
    && find /opt/ms-playwright -type f -name chrome_sandbox -exec chown root:root {} \; -exec chmod 4755 {} \; \
    && chmod -R a+rX /opt/ms-playwright \
    && if id ubuntu >/dev/null 2>&1; then \
      usermod -l worker -d /home/worker -m ubuntu; \
      groupmod -n worker ubuntu; \
      usermod -g worker worker; \
    else \
      groupadd -g 1000 worker; \
      useradd -m -u 1000 -g 1000 -s /bin/bash worker; \
    fi \
    && mkdir -p /workspace /home/worker/setup.d /home/worker/.config/superworkers/chrome \
    && chown -R worker:worker /workspace /home/worker \
    && rm -rf /root/.cache/ms-playwright /root/.npm /tmp/kasmvnc.deb /tmp/s6-*.tar.xz /var/lib/apt/lists/*

COPY rootfs /
COPY --chown=worker:worker setup.d /etc/superworkers/setup.d

RUN chmod +x /usr/local/bin/* /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true \
    && chown worker:worker /run \
    && chmod u-s /package/admin/s6-overlay-helpers/command/s6-overlay-suexec

VOLUME ["/workspace", "/home/worker"]
WORKDIR /workspace
USER worker

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 CMD ["/usr/local/bin/healthcheck.sh"]
ENTRYPOINT ["/init"]
