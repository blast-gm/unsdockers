#!/bin/bash

echo "Iniciando o Servidor.."
php -S 0.0.0.0:{{server.build.default.port}}
