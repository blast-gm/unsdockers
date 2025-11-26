FROM        --platform=$TARGETOS/$TARGETARCH node:21-bookworm-slim

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

RUN apt update \
    && apt -y install ffmpeg yarn nasm iproute2 git sqlite3 libsqlite3-dev python3 python3-dev ca-certificates dnsutils tzdata zip tar curl build-essential libtool iputils-ping libnss3 tini \
    && useradd -m -d /home/container container

# criar prefixo npm global
RUN mkdir -p /usr/local/.npm-global \
    && npm config set prefix /usr/local/.npm-global

# instalar pacotes globais de forma segura
RUN npm install -g npx typescript ts-node @types/node nrm npm-check

# ajustar PATH
ENV PATH="/usr/local/.npm-global/bin:${PATH}"

USER        container
ENV         USER=container HOME=/home/container
WORKDIR     /home/container

STOPSIGNAL  SIGINT

COPY        --chown=container:container ./../entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

ENTRYPOINT  ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
