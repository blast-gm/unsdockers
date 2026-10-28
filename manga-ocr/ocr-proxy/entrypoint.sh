#!/bin/bash
# O volume persistente do Pterodactyl fica em /home/container - o resto do
# sistema de arquivos e SOMENTE LEITURA (mesma licao aprendida com o
# LibreTranslate: HOME precisa apontar pra dentro do volume, senao o
# manga-ocr/easyocr/transformers quebram tentando criar cache em /root ou
# /home/<usuario-da-imagem>, que nao sao graváveis aqui).
cd /home/container
exec > >(tee -a /home/container/boot.log) 2>&1
echo "=== boot $(date -u +%FT%TZ) ==="

export HOME=/home/container
export XDG_CACHE_HOME="$HOME/cache"
export HF_HOME="$HOME/cache/huggingface"
mkdir -p "$XDG_CACHE_HOME" "$HF_HOME"

cd /app
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8091}"
