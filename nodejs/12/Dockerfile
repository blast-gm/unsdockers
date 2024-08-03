# Use a imagem base Node.js
FROM --platform=$TARGETOS/$TARGETARCH node:12-bullseye-slim

LABEL author="Blast" maintainer="blastlindu@gmail.com"

# Atualiza e instala dependências necessárias
RUN apt update && \
    apt-get install -y \
        git \
        ffmpeg \
        iproute2 \
        sqlite3 \
        libsqlite3-dev \
        python3 \
        python3-dev \
        ca-certificates \
        dnsutils \
        tzdata \
        zip \
        tar \
        curl \
        build-essential \
        libtool \
        iputils-ping \
        libnss3 \
        tini && \
    rm -rf /var/lib/apt/lists/*

# Instala pacotes npm globalmente
RUN npm install -g \
        npm@9.8.1 \
        typescript \
        ts-node \
        @types/node \
        npx \
        yarn

# Adiciona o usuário 'container'
RUN useradd -m -d /home/container container

# Configura o ambiente e o diretório de trabalho
USER container
ENV USER=container HOME=/home/container
WORKDIR /home/container

# Instala hexo-cli como usuário container
RUN npm install -g hexo-cli

# Define o sinal de parada
STOPSIGNAL SIGINT

# Copia e configura o script de entrada
COPY --chown=container:container ./../entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Define o entrypoint e o comando padrão
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/entrypoint.sh"]
