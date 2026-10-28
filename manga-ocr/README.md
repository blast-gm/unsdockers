# manga-ocr (OCR com 2 IAs auto-hospedadas)

Serviço de OCR para o CoopIA, sem depender de API externa/chave nenhuma, rodando no
próprio hardware (CPU, sem GPU/CUDA). Combina **duas IAs**, cada uma melhor num caso:

- **[manga-ocr](https://github.com/kha-white/manga-ocr)** (kha-white) - especializada em
  mangá **japonês**: fonte estilizada, texto vertical, furigana. Não foi treinada pra
  outros idiomas - usar ela numa página coreana (manhwa) dá texto sem sentido.
- **[EasyOCR](https://github.com/JaidedAI/EasyOCR)** - multi-idioma (coreano, inglês,
  chinês...). Cobre manhwa/webtoon coreano e o resto que o manga-ocr não cobre.

## Como o motor é escolhido

`POST /v1/ocr` recebe `{ image, lang, engine }`:

1. Se `engine` vier explícito (`"manga-ocr"` ou `"easyocr"`), usa esse - é assim que a
   extensão deixa a pessoa **trocar de IA no meio da sessão** sem reiniciar nada (cada
   chamada escolhe por conta própria, não há estado preso ao processo).
2. Senão, se `lang` começar com `jpn`/`ja`, usa manga-ocr; qualquer outro idioma
   explícito usa EasyOCR (mapeado pro código de idioma dele - `kor`→`ko`, etc.).
3. Se `lang` vier vazio ou `"auto"`, decide pela **proporção da página**
   (altura/largura): manhwa/webtoon coreano costuma vir em tiras bem mais altas que uma
   página de mangá japonês comum (`WEBTOON_RATIO`, padrão 2.2) - acima disso, EasyOCR;
   abaixo, manga-ocr.

Os modelos são baixados sozinhos na 1ª chamada de cada motor (manga-ocr ~450MB,
EasyOCR ~100MB por idioma) e ficam guardados no volume persistente do Pterodactyl -
não baixa de novo a cada reinício.

## Egg

`../eggs/egg-manga-ocr.json` - mesmo padrão de import manual do `egg-libretranslate.json`
(a API do Pterodactyl não tem endpoint de import de egg). Recursos sugeridos: like o
LibreTranslate só que com mais RAM por causa do PyTorch em dois modelos - pelo menos
**300% CPU / 10GB RAM / 20GB storage**.
