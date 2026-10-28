#!/usr/bin/env python3
"""Motores extras de tradução japonês->inglês, especializados em texto de mangá/diálogo casual -
o LibreTranslate/Argos (modelo genérico) fica "colado"/palavra-por-palavra nesse tipo de frase
(sujeito implícito, gírias, reticências). Os dois rodam em CPU, leves, sem GPU/CUDA:

  - fumeto-manga: fumetodev/manga-ja-en-translator-onnx (int8, ~443MB) - treinado especificamente
    em diálogo de mangá, roda via onnxruntime (beam search portado do run.py de referência do
    modelo). Licença do fine-tune em si NÃO declarada pelo autor - zona cinzenta pra uso comercial,
    por isso os dois motores ficam disponíveis e quem chama escolhe qual usar.
  - fugumt: staka/fugumt-ja-en (via transformers/MarianMT) - licença CC-BY-SA-4.0, clara. Genérico
    (não treinado especificamente em mangá), mas boa reputação pra japonês em geral.

Servido num processo Python SEPARADO (porta local, 127.0.0.1 só) dentro do MESMO container do
translate-proxy/LibreTranslate - o proxy Node (server.js) é quem expõe pra fora, com o MESMO token
Bearer de sempre. Sem rede nenhuma pública nova: um processo a mais no mesmo entrypoint.sh.
"""
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ja-engines")

CACHE_DIR = Path(os.environ.get("JA_CACHE_DIR", "/home/container/cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))

app = FastAPI()

# ======================= fumeto-manga (onnxruntime, beam search próprio) =======================
# Porta quase ao pé da letra de run.py (fumetodev/manga-ja-en-translator-onnx) - ver docstring.
FUMETO_REPO = "fumetodev/manga-ja-en-translator-onnx"
_fumeto = None


class FumetoTranslator:
    def __init__(self, model_dir, threads=4):
        import onnxruntime as ort
        import sentencepiece as spm
        from tokenizers import Tokenizer

        d = Path(model_dir)
        meta = json.load(open(d / "meta.json"))
        self.c = meta["config"]
        self.max_src = meta.get("max_src", 128)
        self.tok = Tokenizer.from_file(str(d / "tokenizer" / "tokenizer.json"))
        self.sp = spm.SentencePieceProcessor(model_file=str(d / "tokenizer" / "decoder-spm.model"))
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        self.enc = ort.InferenceSession(str(d / "encoder.int8.onnx"), so, providers=["CPUExecutionProvider"])
        self.dec = ort.InferenceSession(str(d / "decoder.int8.onnx"), so, providers=["CPUExecutionProvider"])
        self.L, self.H = self.c["dec_layers"], self.c["dec_heads"]
        self.dh = self.c["dec_dim"] // self.H
        self.cross_names = [f"cross_{kv}{i}" for i in range(self.L) for kv in "kv"]
        self.self_names = [f"self_{kv}{i}" for i in range(self.L) for kv in "kv"]

    def encode(self, text):
        ids = self.tok.encode(text, add_special_tokens=True).ids
        return ids if len(ids) <= self.max_src else ids[: self.max_src - 1] + [ids[-1]]

    def translate(self, text, beam=4, max_len=128, alpha=1.0):
        if not text.strip():
            return ""
        a = np.array([self.encode(text)], dtype=np.int64)
        out = self.enc.run(None, {"input_ids": a, "attention_mask": np.ones_like(a)})
        bias, cross = out[0], out[1:]
        past = [np.zeros((1, self.H, 0, self.dh), np.float32) for _ in range(2 * self.L)]
        eos, bos = self.c["eos_id"], self.c["bos_id"]
        seqs, scores, finished = [[]], np.zeros(1), []
        toks = np.array([[bos]], np.int64)
        for t in range(max_len):
            r = self.dec.run(
                None,
                {
                    "token": toks,
                    "pos": np.array([t], np.int64),
                    "mem_bias": bias,
                    **dict(zip(self.cross_names, cross)),
                    **dict(zip(self.self_names, past)),
                },
            )
            lg = r[0].astype(np.float64)
            lg -= lg.max(-1, keepdims=True)
            lp = lg - np.log(np.exp(lg).sum(-1, keepdims=True))
            V = lp.shape[1]
            cand = (scores[:, None] + lp).ravel()
            top = np.argpartition(-cand, 2 * beam)[: 2 * beam]
            top = top[np.argsort(-cand[top])]
            new_seqs, new_scores, src = [], [], []
            for ci in top:
                b, tk = divmod(int(ci), V)
                if tk == eos:
                    finished.append((cand[ci] / max(1, len(seqs[b]) + 1) ** alpha, seqs[b]))
                else:
                    new_seqs.append(seqs[b] + [tk])
                    new_scores.append(cand[ci])
                    src.append(b)
                if len(new_seqs) == beam:
                    break
            if finished and len(finished) >= beam and max(f[0] for f in finished) >= max(new_scores) / max(1, t + 1) ** alpha:
                break
            idx = np.array(src)
            past = [x[idx] for x in r[1:]]
            seqs, scores = new_seqs, np.array(new_scores)
            toks = np.array([[s[-1]] for s in seqs], np.int64)
        if not finished:
            finished = [(0.0, seqs[int(np.argmax(scores))])]
        return self.sp.decode(max(finished, key=lambda f: f[0])[1])


def get_fumeto():
    global _fumeto
    if _fumeto is None:
        from huggingface_hub import snapshot_download

        log.info("carregando fumeto-manga (1a chamada, baixa ~443MB se ainda não tiver em cache)...")
        d = Path(snapshot_download(FUMETO_REPO, allow_patterns=["int8/*"], cache_dir=str(CACHE_DIR / "hf-hub"))) / "int8"
        _fumeto = FumetoTranslator(d)
        log.info("fumeto-manga pronto")
    return _fumeto


# ======================= fugumt (transformers/MarianMT, CC-BY-SA-4.0) =======================
FUGUMT_REPO = "staka/fugumt-ja-en"
_fugumt = None


def get_fugumt():
    global _fugumt
    if _fugumt is None:
        from transformers import MarianMTModel, MarianTokenizer

        log.info("carregando fugumt (1a chamada, baixa modelo se ainda não tiver em cache)...")
        tok = MarianTokenizer.from_pretrained(FUGUMT_REPO, cache_dir=str(CACHE_DIR / "hf-hub"))
        model = MarianMTModel.from_pretrained(FUGUMT_REPO, cache_dir=str(CACHE_DIR / "hf-hub"))
        model.eval()
        _fugumt = (tok, model)
        log.info("fugumt pronto")
    return _fugumt


def translate_fugumt(text, max_len=128):
    import torch

    if not text.strip():
        return ""
    tok, model = get_fugumt()
    batch = tok([text], return_tensors="pt", padding=True, truncation=True, max_length=max_len)
    with torch.no_grad():
        gen = model.generate(**batch, max_length=max_len, num_beams=4)
    return tok.batch_decode(gen, skip_special_tokens=True)[0]


# ======================= HTTP =======================
class TranslateIn(BaseModel):
    text: str
    engine: str  # "fumeto-manga" | "fugumt"


@app.get("/health")
def health():
    return {"ok": True, "fumeto_loaded": _fumeto is not None, "fugumt_loaded": _fugumt is not None}


@app.post("/v1/ja-translate")
def ja_translate(body: TranslateIn):
    if body.engine not in ("fumeto-manga", "fugumt"):
        raise HTTPException(status_code=400, detail='engine inválido - use "fumeto-manga" ou "fugumt"')
    t0 = time.time()
    try:
        if body.engine == "fumeto-manga":
            text = get_fumeto().translate(body.text)
        else:
            text = translate_fugumt(body.text)
    except Exception as e:
        log.exception("falha na tradução JA")
        raise HTTPException(status_code=500, detail=f"ja_translate_failed: {e}")
    ms = int((time.time() - t0) * 1000)
    log.info(f"evt=ja_translate engine={body.engine} ms={ms} tam={len(body.text)}")
    return {"translatedText": text, "engine": body.engine, "ms": ms}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("JA_ENGINES_PORT", "8095")))
