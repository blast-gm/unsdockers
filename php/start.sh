#!/bin/ash
rm -rf /home/container/tmp/*

echo "Iniciando o PHP-FPM..."
/usr/sbin/php-fpm8 --fpm-config /home/container/php-fpm/php-fpm.conf --daemonize
