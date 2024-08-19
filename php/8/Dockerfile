FROM        --platform=$TARGETOS/$TARGETARCH ubuntu:22.04

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

# Instale as dependências e o PHP com extensões necessárias
# Primeiro, atualize e instale as dependências básicas
RUN         apt update 
RUN         apt install -y curl ca-certificates

# Agora, instale o PHP e as extensões em um comando separado
RUN         apt install -y php php-xml php-exif php-fpm php-session php-soap php-openssl php-gmp php-pdo-odbc php-json php-dom php-pdo php-zip php-mysqli php-sqlite3 php-pgsql php-bcmath php-gd php-odbc php-mysql php-pdo-mysql php-gettext php-xmlreader php-bz2 php-iconv php-curl php-ctype php-phar php-fileinfo php-mbstring php-tokenizer php-simplexml \
            && useradd -m -d /home/container container


# Configuração de usuário e diretório de trabalho
USER        container
ENV         USER=container HOME=/home/container
WORKDIR     /home/container

STOPSIGNAL SIGINT

COPY        ./../entrypoint.sh /entrypoint.sh

# Defina o comando de inicialização do contêiner
COPY        --chown=container:container ./../entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh
ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
