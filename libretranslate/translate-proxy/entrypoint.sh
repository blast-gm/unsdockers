#!/bin/bash
cd /home/container

# Tudo que sai daqui tambem vai pra um arquivo no volume persistente - da pra
# ler via SFTP/painel mesmo sem console ao vivo, pra depurar um boot que
# travou ou demorou (ex.: baixando modelos de idioma na 1a vez).
exec > >(tee -a /home/container/boot.log) 2>&1
echo "=== boot $(date -u +%FT%TZ) ==="

LT_DIR=/home/container/libretranslate
mkdir -p "$LT_DIR/packages" "$LT_DIR/cache" "$LT_DIR/home"
export ARGOS_PACKAGES_DIR="$LT_DIR/packages"
export XDG_CACHE_HOME="$LT_DIR/cache"
# O filesystem raiz do container e SOMENTE LEITURA (so /home/container, o
# volume persistente do Pterodactyl, e gravavel) - a imagem base define
# HOME=/home/libretranslate, que NAO e gravavel aqui (confirmado: o
# argostranslate tenta criar ~/.local/share e quebra com "Read-only file
# system" se HOME ficar la). Aponta HOME pro volume gravavel.
export HOME="$LT_DIR/home"

echo "==> Iniciando LibreTranslate em 127.0.0.1:5000 (idiomas: ${LT_LOAD_ONLY:-todos}; so acessivel de dentro deste container)..."
# O entrypoint de verdade do LibreTranslate (scripts/entrypoint.sh, dentro de
# /app na imagem base) usa caminhos RELATIVOS (./venv/bin/...), por isso o cd.
# Ele le LT_HOST/LT_PORT/LT_THREADS/LT_DISABLE_WEB_UI/LT_LOAD_ONLY/LT_UPDATE_MODELS
# do ambiente (documentados no README do LibreTranslate).
cd /app
LT_HOST=127.0.0.1 LT_PORT=5000 LT_DISABLE_WEB_UI=true LT_UPDATE_MODELS=true \
LT_LOAD_ONLY="${LT_LOAD_ONLY}" LT_THREADS="${LT_THREADS:-4}" \
  ./scripts/entrypoint.sh &
LT_PID=$!
cd /home/container

echo "==> Esperando o LibreTranslate responder (1a vez pode levar minutos: baixando os modelos de idioma)..."
for i in $(seq 1 180); do
  curl -sf http://127.0.0.1:5000/languages >/dev/null 2>&1 && break
  sleep 5
done
curl -sf http://127.0.0.1:5000/languages >/dev/null 2>&1 \
  && echo "LibreTranslate respondendo" \
  || echo "AVISO: LibreTranslate nao respondeu a tempo; o proxy vai subir mesmo assim e devolver 502/504 pros clientes ate ele ficar pronto."

export LT_UPSTREAM=http://127.0.0.1:5000

node -v

MODIFIED_STARTUP=$(echo -e ${STARTUP} | sed -e 's/{{/${/g' -e 's/}}/}/g')
echo ":/home/container$ ${MODIFIED_STARTUP}"

eval ${MODIFIED_STARTUP} &
PROXY_PID=$!

trap 'kill -TERM $PROXY_PID $LT_PID 2>/dev/null' TERM INT
wait $PROXY_PID
