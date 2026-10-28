FROM        --platform=$TARGETOS/$TARGETARCH libretranslate/libretranslate:latest

LABEL       author="Blast" maintainer="blastlindu@gmail.com"

ENV         DEBIAN_FRONTEND=noninteractive
USER        root

# A imagem base roda como o usuario "libretranslate" (uid 1032) e /app (onde fica
# o venv do LibreTranslate) pertence a ele - ficamos como root pra nao ter que
# mexer em permissao nenhuma (nem do /app da imagem base, nem do volume
# persistente que o Pterodactyl monta em /home/container).
RUN         apt update \
            && apt -y install curl ca-certificates gnupg tini python3-venv python3-pip \
            && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
            && apt -y install nodejs \
            && apt clean && rm -rf /var/lib/apt/lists/*

# venv SEPARADO do venv do LibreTranslate (em /app, da imagem base) - evita qualquer conflito de
# versao de dependencia (numpy etc) entre os dois. torch CPU-only explicito (sem CUDA - o node de
# producao nao tem GPU, mesma licao do manga-ocr/ocr-proxy e do sTrawStudio-CoopIA).
RUN         python3 -m venv /opt/ja-engines-venv \
            && /opt/ja-engines-venv/bin/pip install --no-cache-dir --upgrade pip \
            && /opt/ja-engines-venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
            && /opt/ja-engines-venv/bin/pip install --no-cache-dir fastapi "uvicorn[standard]" onnxruntime numpy tokenizers sentencepiece huggingface_hub transformers

COPY        ./translate-proxy/app /opt/translate-proxy

COPY        ./translate-proxy/entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh

WORKDIR     /home/container

EXPOSE      8090

STOPSIGNAL SIGINT

ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
