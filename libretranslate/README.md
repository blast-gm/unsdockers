# LibreTranslate (translate-proxy)

Tradução de texto 100% local (sem depender de nenhuma API externa de tradução,
sem chave, sem cota) para o CoopIA. O LibreTranslate (Argos Translate / modelos
OPUS-MT em ONNX via CTranslate2) roda dentro do container, escutando só em
`127.0.0.1:5000` — **nunca exposto direto**. Na frente dele, o `translate-proxy`
(o mesmo padrão de proxy com token do [`clamav/teamdrive-scanner`](../clamav)):
autenticação Bearer, lista de IPs permitidos e fila de concorrência, e devolve
502/504 em vez de travar enquanto o LibreTranslate ainda está baixando os
modelos de idioma na primeira subida.

## Rotas do proxy (porta configurável, padrão 8090)

- `GET /health` — sem autenticação, só para healthcheck do Docker/Pterodactyl.
- `GET /v1/status` — contadores e fila (autenticado).
- `GET /v1/languages` — idiomas disponíveis.
- `POST /v1/translate` — `{ q, source, target, format? }` → `{ translatedText, detectedLanguage }`.
- `POST /v1/translate-batch` — `{ q: [textos...], source, target }` → `{ results: [...] }` (uma fala por item; é aqui que o CoopIA bate 1 chamada por página em vez de N).
- `POST /v1/detect` — `{ q }` → idiomas detectados.

Todas (exceto `/health`) exigem `Authorization: Bearer <TRANSLATE_TOKEN>`.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `TRANSLATE_TOKEN` | Segredo compartilhado com quem chama (o CoopIA). `openssl rand -hex 32`. |
| `ALLOWED_IPS` | IPs/CIDRs autorizados, separados por vírgula. Vazio = qualquer IP com o token certo (recomendado limitar ao IP do servidor CoopIA). |
| `LT_LOAD_ONLY` | Idiomas a carregar (ex.: `en,pt,ja,es,zh,ko,fr,de,ru,it`). Vazio = carrega todos os pares disponíveis (mais lento na 1ª subida, usa mais disco). |
| `PORT` | Porta do proxy (defina a mesma na alocação do servidor). |
| `MAX_TEXT_CHARS` | Tamanho máximo de um texto por chamada. |
| `MAX_BATCH` | Máximo de textos por chamada de `/v1/translate-batch`. |
| `MAX_CONCURRENT_TRANSLATIONS` / `QUEUE_MAX` / `QUEUE_WAIT_SECONDS` | Concorrência e fila, iguais em espírito ao scanner do ClamAV. |

Os modelos de idioma baixados pelo LibreTranslate ficam em
`/home/container/libretranslate/packages` — sobrevivem a reinícios do
servidor (volume persistente do Pterodactyl), não são baixados de novo
a cada deploy.

## Egg

[`eggs/egg-libretranslate.json`](../eggs/egg-libretranslate.json), exportada
do painel Pterodactyl. Imagem: `ghcr.io/blast-gm/unsdockers:libretranslate_translate-proxy`
(construída a partir deste diretório pelo workflow `libretranslate.yml`).

Recursos recomendados: pelo menos 200% CPU / 8GB RAM / 32GB disco — tradução
neural com vários idiomas carregados ao mesmo tempo consome bastante RAM.
