FROM        --platform=$TARGETOS/$TARGETARCH libretranslate/libretranslate:latest

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

ENV         DEBIAN_FRONTEND=noninteractive
USER        root

# A imagem base roda como o usuario "libretranslate" (uid 1032) e /app (onde fica
# o venv do LibreTranslate) pertence a ele - ficamos como root pra nao ter que
# mexer em permissao nenhuma (nem do /app da imagem base, nem do volume
# persistente que o Pterodactyl monta em /home/container).
RUN         apt update \
            && apt -y install curl ca-certificates gnupg tini \
            && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
            && apt -y install nodejs \
            && apt clean && rm -rf /var/lib/apt/lists/*

COPY        ./translate-proxy/app /opt/translate-proxy

COPY        ./translate-proxy/entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

WORKDIR     /home/container

EXPOSE      8090

STOPSIGNAL SIGINT

ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
