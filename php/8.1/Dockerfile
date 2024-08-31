FROM        php:8.1-cli

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

RUN         apt-get update && \
            apt-get install -y libpng-dev libjpeg-dev libfreetype6-dev curl ca-certificates \
            libzip-dev unzip git \
            && docker-php-ext-configure gd --with-freetype --with-jpeg \
            && docker-php-ext-install gd zip mysqli pdo pdo_mysql

COPY        --from=composer:latest  /usr/bin/composer /usr/bin/composer

USER        container
ENV         USER container
ENV         HOME /home/container

WORKDIR     /home/container
COPY       ./../entrypoint.sh /entrypoint.sh


CMD       ["/bin/ash", "../php/entrypoint.sh"]
