FROM        python:3.11-slim

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

ENV         DEBIAN_FRONTEND=noninteractive \
            PIP_NO_CACHE_DIR=1 \
            PYTHONUNBUFFERED=1

# libgl1/libglib2.0-0: dependencia do opencv-python-headless (usado pelo
# EasyOCR) mesmo sem GPU nenhuma. tini: PID 1 decente pra encerrar o
# uvicorn direito num sinal. curl: so pra debug manual dentro do container.
RUN         apt-get update \
            && apt-get install -y --no-install-recommends \
               libgl1 libglib2.0-0 libgomp1 curl tini \
            && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR     /app

# torch CPU-only (SEM CUDA) explicitamente - o node de producao nao tem GPU
# nenhuma, baixar as rodas com CUDA so inflaria a imagem/tempo de build a toa
# (mesma licao do ONNXRUNTIME_NODE_INSTALL=skip no sTrawStudio-CoopIA).
RUN         pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY        ./ocr-proxy/app/requirements.txt .
RUN         pip install --no-cache-dir -r requirements.txt

COPY        ./ocr-proxy/app /app

COPY        ./ocr-proxy/entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

WORKDIR     /home/container

EXPOSE      8091

STOPSIGNAL  SIGINT

ENTRYPOINT  ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
