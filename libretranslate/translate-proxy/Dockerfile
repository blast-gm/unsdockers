FROM        --platform=$TARGETOS/$TARGETARCH libretranslate/libretranslate:latest

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

ENV         DEBIAN_FRONTEND=noninteractive
USER        root

RUN         apt update \
            && apt -y install curl ca-certificates gnupg tini \
            && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
            && apt -y install nodejs \
            && apt clean && rm -rf /var/lib/apt/lists/* \
            && useradd -m -d /home/container container || true

# O app fica fora de /home/container: o Pterodactyl monta o volume persistente
# do servidor nesse caminho, o que esconderia qualquer arquivo colocado ali no build.
COPY        --chown=container:container ./translate-proxy/app /opt/translate-proxy

COPY        ./translate-proxy/entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

USER        container
ENV         USER=container HOME=/home/container
WORKDIR     /home/container

EXPOSE      8090

STOPSIGNAL SIGINT

ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
