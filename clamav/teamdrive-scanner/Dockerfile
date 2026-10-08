FROM        --platform=$TARGETOS/$TARGETARCH debian:bookworm-slim

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

ENV         DEBIAN_FRONTEND=noninteractive

RUN         apt update \
            && apt -y install curl ca-certificates gnupg tini iproute2 clamav clamav-daemon clamav-freshclam \
            && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
            && apt -y install nodejs \
            && apt clean && rm -rf /var/lib/apt/lists/* \
            && useradd -m -d /home/container container

# O app fica fora de /home/container: o Pterodactyl monta o volume persistente
# do servidor nesse caminho, o que esconderia qualquer arquivo colocado ali no build.
COPY        --chown=container:container ./teamdrive-scanner/app /opt/teamdrive-scanner

COPY        ./entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

USER        container
ENV         USER=container HOME=/home/container
WORKDIR     /home/container

EXPOSE      8080

STOPSIGNAL SIGINT

ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
