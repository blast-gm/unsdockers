# OCR com DUAS IAs auto-hospedadas, escolhidas por pagina (sem API externa, sem chave):
#  - manga-ocr (kha-white): especializado em mangá JAPONÊS - fonte estilizada,
#    texto vertical, furigana. NÃO foi treinado pra outros idiomas (lê japonês
#    errado quando a página é, por exemplo, manhwa coreano - daí a 2a IA abaixo).
#  - EasyOCR: multi-idioma (coreano, inglês, chinês, ...) - cobre o que o
#    manga-ocr não cobre. Pensado pra manhwa/webtoon coreano e o resto.
#
# A escolha do motor usa, nesta ordem: 1) "engine" explícito no pedido (a
# extensão deixa a pessoa trocar na hora, por sessão); 2) o idioma pedido
# ("lang"); 3) se "lang" vier vazio/"auto", usa a PROPORÇÃO da página como
# pista - manhwa/webtoon coreano costuma vir em tiras bem mais altas que
# largas (rolagem vertical) do que uma página de mangá japonês comum.
import base64
import io
import logging
import os
import time
from typing import Optional

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ocr-proxy")

TOKENS = [t.strip() for t in os.environ.get("OCR_TOKENS", os.environ.get("OCR_TOKEN", "")).split(",") if t.strip()]
if not TOKENS:
    raise RuntimeError("Defina OCR_TOKEN (gere com: openssl rand -hex 32).")
if any(len(t) < 24 for t in TOKENS):
    raise RuntimeError("OCR_TOKEN curto demais: use pelo menos 24 caracteres aleatorios.")

MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))
# proporcao altura/largura a partir da qual uma pagina "sem idioma definido" e
# tratada como manhwa/webtoon (tira vertical) em vez de pagina de manga comum
WEBTOON_RATIO = float(os.environ.get("WEBTOON_RATIO", "2.2"))

app = FastAPI()

_manga_ocr = None
_easy_readers: dict[tuple, object] = {}

LANG_TO_EASYOCR = {
    "kor": ["ko", "en"], "ko": ["ko", "en"],
    "eng": ["en"], "en": ["en"],
    "chi_sim": ["ch_sim", "en"], "zh": ["ch_sim", "en"], "zh-cn": ["ch_sim", "en"],
    "chi_tra": ["ch_tra", "en"], "zh-tw": ["ch_tra", "en"],
}
DEFAULT_EASYOCR_LANGS = ["en"]


def get_manga_ocr():
    global _manga_ocr
    if _manga_ocr is None:
        log.info("carregando manga-ocr (1a chamada, baixa o modelo - pode levar um instante)...")
        from manga_ocr import MangaOcr
        _manga_ocr = MangaOcr()
        log.info("manga-ocr pronto")
    return _manga_ocr


def get_easyocr(lang_list):
    key = tuple(sorted(lang_list))
    reader = _easy_readers.get(key)
    if reader is None:
        log.info(f"carregando easyocr {key} (1a chamada, baixa o modelo - pode levar um instante)...")
        import easyocr
        reader = easyocr.Reader(list(key), gpu=False)
        _easy_readers[key] = reader
        log.info(f"easyocr {key} pronto")
    return reader


def pick_engine(lang: Optional[str], width: int, height: int) -> str:
    l = (lang or "").lower().strip()
    if l.startswith("jpn") or l.startswith("ja"):
        return "manga-ocr"
    if l in ("", "auto"):
        ratio = (height / width) if width else 0
        return "easyocr" if ratio >= WEBTOON_RATIO else "manga-ocr"
    return "easyocr"


class OcrIn(BaseModel):
    image: str  # base64 (sem prefixo "data:..."), PNG/JPEG
    lang: Optional[str] = "auto"
    # forca um motor especifico (manga-ocr | easyocr) - sobrepoe a escolha automatica;
    # e assim que a extensao deixa trocar de IA no meio da sessao sem reiniciar nada
    engine: Optional[str] = None


def check_auth(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    if authorization[7:] not in TOKENS:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {
        "ok": True,
        "engines": {
            "manga_ocr_loaded": _manga_ocr is not None,
            "easyocr_loaded": [list(k) for k in _easy_readers.keys()],
        },
    }


@app.post("/v1/ocr")
def ocr(body: OcrIn, authorization: Optional[str] = Header(None)):
    check_auth(authorization)

    try:
        raw = base64.b64decode(body.image, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="image invalida (base64)")
    if not raw:
        raise HTTPException(status_code=400, detail="image vazia")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="imagem grande demais")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="nao foi possivel abrir a imagem")

    if body.engine and body.engine not in ("manga-ocr", "easyocr"):
        raise HTTPException(status_code=400, detail='engine invalido - use "manga-ocr" ou "easyocr"')
    engine = body.engine or pick_engine(body.lang, img.width, img.height)

    t0 = time.time()
    try:
        if engine == "manga-ocr":
            text = str(get_manga_ocr()(img))
        else:
            langs = LANG_TO_EASYOCR.get((body.lang or "").lower().strip(), DEFAULT_EASYOCR_LANGS)
            reader = get_easyocr(langs)
            lines = reader.readtext(np.array(img), detail=0, paragraph=True)
            text = "\n".join(lines)
    except Exception as e:
        log.exception("falha no OCR")
        raise HTTPException(status_code=500, detail=f"ocr_failed: {e}")
    dt_ms = int((time.time() - t0) * 1000)
    log.info(f'evt=ocr engine={engine} lang={body.lang} tam={img.width}x{img.height} ms={dt_ms}')
    return {"text": text.strip(), "engine": engine, "ms": dt_ms}
