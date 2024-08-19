FROM debian:slim

# Instale as dependências e o PHP com extensões necessárias
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    php \
    php-xml \
    php-exif \
    php-fpm \
    php-session \
    php-soap \
    php-openssl \
    php-gmp \
    php-pdo-odbc \
    php-json \
    php-dom \
    php-pdo \
    php-zip \
    php-mysqli \
    php-sqlite3 \
    php-pgsql \
    php-bcmath \
    php-gd \
    php-odbc \
    php-mysql \
    php-pdo-mysql \
    php-sqlite3 \
    php-gettext \
    php-xmlreader \
    php-bz2 \
    php-iconv \
    php-curl \
    php-ctype \
    php-phar \
    php-fileinfo \
    php-mbstring \
    php-tokenizer \
    php-simplexml \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copie o Composer da imagem oficial para o contêiner
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configuração de usuário e diretório de trabalho
USER container
ENV USER container
ENV HOME /home/container

WORKDIR /home/container
COPY ./../entrypoint.sh /entrypoint.sh

# Defina o comando de inicialização do contêiner
CMD ["/bin/bash", "/entrypoint.sh"]
