// translate-proxy — autentica (Bearer + IP), limita concorrência/tamanho e repassa pro LibreTranslate
// que roda em localhost dentro do MESMO container (ver entrypoint.sh). Zero dependências npm.
const http = require('http');
const { load } = require('./config');
const log = require('./log');
const { Gate } = require('./gate');
const { makeAuth } = require('./auth');
const VERSION = require('../package.json').version;

function send(res, status, body, extra = {}) {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(data);
}
function reject(res, status, error, fields = {}, extraHeaders = {}) {
  if (res.headersSent) return;
  send(res, status, { error, ...fields }, extraHeaders);
}
const safeId = (v) => (/^[A-Za-z0-9._-]{1,64}$/.test(String(v || '')) ? String(v) : require('crypto').randomUUID());

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); return reject(Object.assign(new Error('too_large'), { code: 'too_large' })); }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('bad_json'), { code: 'bad_json' })); }
    });
    req.on('error', reject);
  });
}

/** Chama o LibreTranslate local (upstream) e devolve o JSON já decodificado. */
function upstreamFetch(cfg, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(cfg.upstream + path);
    const r = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (res.statusCode >= 400) return reject(Object.assign(new Error(data.error || `upstream_${res.statusCode}`), { code: 'upstream', status: res.statusCode, detail: data.error }));
        resolve(data);
      });
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('upstream_timeout'), { code: 'timeout' })));
    r.on('error', (e) => reject(Object.assign(e, { code: e.code || 'upstream_unavailable' })));
    r.end(payload);
  });
}

function createService(cfg) {
  const gate = new Gate(cfg.maxConcurrent, cfg.queueMax);
  const auth = makeAuth(cfg);
  const counters = { translated: 0, chars: 0, errors: 0, busy: 0 };
  const startedAt = Date.now();

  function cleanText(s, max) {
    const t = String(s ?? '');
    if (!t.length) throw Object.assign(new Error('empty_text'), { code: 'bad_request' });
    if (t.length > max) throw Object.assign(new Error('text_too_long'), { code: 'bad_request', maxChars: max });
    return t;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const reqId = safeId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', reqId);

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    const ip = auth.clientIp(req);
    if (!auth.ipOk(ip)) { log.warn('ip_negado', { ip }); return reject(res, 403, 'ip_not_allowed'); }
    const a = auth.check(req, ip);
    if (!a.ok) { log.warn('auth_falhou', { ip, path: url.pathname }); return reject(res, a.status, a.error, {}, a.status === 429 ? { 'Retry-After': '600' } : {}); }

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      return send(res, 200, {
        ok: true, service: 'translate-proxy', version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        queue: { active: gate.active, waiting: gate.waiting, peak: gate.peak, maxConcurrent: cfg.maxConcurrent, queueMax: cfg.queueMax },
        counters,
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/languages') {
      try {
        const http2 = require('http');
        const data = await new Promise((resolve, rej) => {
          const r = http2.get(cfg.upstream + '/languages', (r2) => {
            const chunks = []; r2.on('data', (c) => chunks.push(c));
            r2.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { rej(e); } });
          });
          r.on('error', rej);
          r.setTimeout(10_000, () => r.destroy(new Error('timeout')));
        });
        return send(res, 200, { languages: data });
      } catch (e) {
        return reject(res, 502, 'languages_unavailable', { detail: e.message });
      }
    }

    if (url.pathname !== '/v1/translate' && url.pathname !== '/v1/translate-batch' && url.pathname !== '/v1/detect') return reject(res, 404, 'not_found');
    if (req.method !== 'POST') return reject(res, 405, 'method_not_allowed', {}, { Allow: 'POST' });

    let body;
    try { body = await readJsonBody(req, 2 * 1024 * 1024); }
    catch (e) { return reject(res, e.code === 'too_large' ? 413 : 400, e.code === 'too_large' ? 'too_large' : 'bad_json'); }

    let release;
    try { release = await gate.acquire({ waitMs: cfg.queueWaitMs }); }
    catch { counters.busy++; return reject(res, 429, 'busy', { retryAfter: 15 }, { 'Retry-After': '15' }); }

    const t0 = Date.now();
    try {
      if (url.pathname === '/v1/detect') {
        const q = cleanText(body.q, cfg.maxTextChars);
        const data = await upstreamFetch(cfg, '/detect', { q }, cfg.translateTimeoutMs);
        counters.translated++;
        return send(res, 200, { id: reqId, detections: data });
      }

      const source = String(body.source || 'auto').slice(0, 10);
      const target = String(body.target || '').slice(0, 10);
      if (!target) return reject(res, 400, 'missing_target');

      if (url.pathname === '/v1/translate') {
        const q = cleanText(body.q, cfg.maxTextChars);
        const data = await upstreamFetch(cfg, '/translate', { q, source, target, format: body.format === 'html' ? 'html' : 'text' }, cfg.translateTimeoutMs);
        counters.translated++; counters.chars += q.length;
        return send(res, 200, { id: reqId, translatedText: data.translatedText, detectedLanguage: data.detectedLanguage || null });
      }

      // /v1/translate-batch: traduz várias falas de uma vez (1 crédito por fala, no CoopIA) — mas cada uma
      // vira uma chamada separada ao LibreTranslate (ele não tem batch nativo), em série dentro desta mesma
      // requisição HTTP, pra não precisar abrir N conexões lá de fora.
      const texts = Array.isArray(body.q) ? body.q : null;
      if (!texts || !texts.length) return reject(res, 400, 'missing_q_array');
      if (texts.length > cfg.maxBatch) return reject(res, 400, 'batch_too_large', { maxBatch: cfg.maxBatch });
      const out = [];
      for (const raw of texts) {
        const q = cleanText(raw, cfg.maxTextChars);
        const data = await upstreamFetch(cfg, '/translate', { q, source, target, format: 'text' }, cfg.translateTimeoutMs);
        out.push({ translatedText: data.translatedText, detectedLanguage: data.detectedLanguage || null });
        counters.translated++; counters.chars += q.length;
      }
      send(res, 200, { id: reqId, results: out });
    } catch (e) {
      counters.errors++;
      if (e.code === 'bad_request') return reject(res, 400, e.message, { maxChars: e.maxChars });
      if (e.code === 'timeout') { log.error('traducao_timeout', { id: reqId }); return reject(res, 504, 'translate_timeout'); }
      if (e.code === 'upstream') return reject(res, 502, 'translate_failed', { detail: e.detail });
      log.error('traducao_falhou', { id: reqId, err: String(e.stack || e).slice(0, 400) });
      reject(res, 502, 'translate_failed', { detail: e.message });
    } finally {
      release();
      log.info('traduzido', { id: reqId, ip, ms: Date.now() - t0, path: url.pathname });
    }
  }

  const guard = (req, res) => route(req, res).catch((e) => {
    log.error('erro_interno', { err: String(e.stack || e).slice(0, 500) });
    if (!res.headersSent) send(res, 500, { error: 'internal' }); else res.destroy();
  });

  const server = http.createServer();
  server.on('request', guard);
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  return { server, gate, counters, close: () => new Promise((r) => server.close(() => r())) };
}

function main() {
  let cfg;
  try { cfg = load(); } catch (e) { console.error('Configuração inválida: ' + e.message); process.exit(1); }
  const svc = createService(cfg);
  svc.server.listen(cfg.port, cfg.host, () => {
    log.info('iniciado', {
      porta: cfg.port, upstream: cfg.upstream, simultaneas: cfg.maxConcurrent, ips_permitidos: cfg.allowedIps.length || 'todos',
    });
    if (!cfg.allowedIps.length) log.warn('sem_lista_de_ips', { aviso: 'ALLOWED_IPS vazio: qualquer IP com o token pode usar. Recomendado limitar ao IP do CoopIA.' });
  });
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true;
    log.info('encerrando', { sinal: sig, ativos: svc.gate.active });
    svc.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (require.main === module) main();
module.exports = { createService };
