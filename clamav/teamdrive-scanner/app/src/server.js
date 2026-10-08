// teamdrive-scanner — recebe um arquivo EM STREAM, escaneia com o ClamAV (clamd INSTREAM) e devolve um veredito assinado.
// Zero dependências npm. O arquivo nunca é gravado em disco aqui.
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const { load } = require('./config');
const log = require('./log');
const clamd = require('./clamd');
const { Gate } = require('./gate');
const { makeAuth } = require('./auth');
const verdictLib = require('./verdict');
const VERSION = require('../package.json').version;

/** Mede tamanho e SHA-256 enquanto o arquivo passa, e corta se passar do limite. */
class Meter extends Transform {
  constructor(max) { super({ readableHighWaterMark: 256 * 1024 }); this.max = max; this.size = 0; this.hash = crypto.createHash('sha256'); }
  _transform(chunk, _enc, cb) {
    this.size += chunk.length;
    if (this.size > this.max) return cb(Object.assign(new Error('Arquivo maior que o limite do scanner.'), { code: 'too_large' }));
    this.hash.update(chunk);
    cb(null, chunk);
  }
}

function send(res, status, body, extra = {}) {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(data);
}
/** Erro respondido ANTES de ler o corpo: fecha a conexão (não vamos engolir gigabytes que ninguém vai usar). */
function reject(req, res, status, error, fields = {}, extraHeaders = {}) {
  if (res.headersSent) return;
  const data = JSON.stringify({ error, ...fields });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', Connection: 'close', ...extraHeaders });
  res.end(data, () => setTimeout(() => req.destroy(), 100));
}
const safeId = (v) => (/^[A-Za-z0-9._-]{1,64}$/.test(String(v || '')) ? String(v) : crypto.randomUUID());
const decodeName = (v) => { try { return log.clean(decodeURIComponent(String(v || '')), 200); } catch { return log.clean(v, 200); } };

function createService(cfg) {
  const gate = new Gate(cfg.maxConcurrent, cfg.queueMax);
  const auth = makeAuth(cfg);
  const counters = { scanned: 0, clean: 0, infected: 0, errors: 0, busy: 0, bytes: 0 };
  const startedAt = Date.now();
  let engineCache = { at: 0, info: null };

  // StreamMaxLength REAL do clamd, descoberto por sondagem (ver clamd.probeStreamMax). null = ainda não sei / clamd fora do ar.
  let streamMax = null;
  async function refreshStreamMax() {
    try {
      const v = await clamd.probeStreamMax(cfg.clamd);
      if (v !== streamMax) log.info('limite_do_clamd', { streamMaxLengthBytes: v === Infinity ? 'sem limite prático (>= 4 GiB)' : v });
      streamMax = v;
      if (v < cfg.maxFileBytes) log.warn('limite_do_clamd_menor', { aviso: `StreamMaxLength do clamd (${v} bytes) é menor que MAX_FILE_MB (${cfg.maxFileBytes} bytes): arquivos entre os dois serão recusados com 413. Aumente StreamMaxLength no clamd.conf.` });
    } catch { /* clamd fora do ar agora: tenta de novo no próximo ciclo */ }
  }
  /** O menor entre o limite configurado aqui e o que o clamd realmente aceita. */
  const effectiveMax = () => (streamMax === null ? cfg.maxFileBytes : Math.min(cfg.maxFileBytes, streamMax));
  let probedOnce = false;
  const probeReady = refreshStreamMax().finally(() => { probedOnce = true; });
  const probeTimer = setInterval(refreshStreamMax, 15 * 60_000); probeTimer.unref();

  async function engine() {
    if (engineCache.info && Date.now() - engineCache.at < 60_000) return engineCache.info;
    try {
      const [name, dbVersion, dbDate] = (await clamd.version(cfg.clamd, 3000)).split('/');
      engineCache = { at: Date.now(), info: { ok: true, engine: name.trim(), dbVersion: dbVersion ? Number(dbVersion) : null, dbDate: dbDate ? dbDate.trim() : null } };
    } catch (e) { return { ok: false, error: e.message }; }
    return engineCache.info;
  }

  async function route(req, res, expectContinue) {
    const url = new URL(req.url, 'http://x');
    const reqId = safeId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', reqId);

    // saúde sem autenticação (para monitoramento/healthcheck do Docker); não revela nada além de "ok"
    if (req.method === 'GET' && url.pathname === '/health') {
      try { return send(res, (await clamd.ping(cfg.clamd, 3000)) ? 200 : 503, { ok: true }); } catch { return send(res, 503, { ok: false }); }
    }

    const ip = auth.clientIp(req);
    if (!auth.ipOk(ip)) { log.warn('ip_negado', { ip }); return reject(req, res, 403, 'ip_not_allowed'); }
    const a = auth.check(req, ip);
    if (!a.ok) { log.warn('auth_falhou', { ip, path: url.pathname }); return reject(req, res, a.status, a.error, {}, a.status === 429 ? { 'Retry-After': '600' } : {}); }

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      return send(res, 200, {
        ok: true, service: 'teamdrive-scanner', version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        clamd: await engine(),
        queue: { active: gate.active, waiting: gate.waiting, peak: gate.peak, maxConcurrent: cfg.maxConcurrent, queueMax: cfg.queueMax },
        limits: { maxFileBytes: cfg.maxFileBytes, clamdStreamMaxBytes: streamMax === Infinity ? null : streamMax, effectiveMaxFileBytes: effectiveMax() }, counters, memory: { rssMB: Math.round(process.memoryUsage().rss / 1048576) },
      });
    }
    if (url.pathname !== '/v1/scan') return reject(req, res, 404, 'not_found');
    if (req.method !== 'POST') return reject(req, res, 405, 'method_not_allowed', {}, { Allow: 'POST' });

    // ---- POST /v1/scan ----
    if (!probedOnce) await Promise.race([probeReady, new Promise((r) => setTimeout(r, 2500))]); // 1º pedido logo após subir: espera descobrir o limite do clamd
    let declared = null;
    if (req.headers['content-length'] !== undefined) {
      declared = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(declared) || declared < 0) return reject(req, res, 400, 'bad_length');
      if (declared > cfg.maxFileBytes) return reject(req, res, 413, 'too_large', { maxBytes: cfg.maxFileBytes });
      if (declared > effectiveMax()) { // cabe no que configurei aqui, mas NÃO no que o clamd aceita: avisa antes de gastar rede
        log.warn('acima_do_limite_do_clamd', { size: declared, clamd: streamMax });
        return reject(req, res, 413, 'engine_size_limit', { maxBytes: effectiveMax(), hint: 'Aumente StreamMaxLength no clamd.conf (e MAX_FILE_MB aqui deve ser menor ou igual).' });
      }
    }
    const name = decodeName(req.headers['x-file-name']);
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // cliente desistiu

    let release;
    try { release = await gate.acquire({ waitMs: cfg.queueWaitMs, signal: ac.signal }); }
    catch (e) {
      if (e.code === 'aborted') return;
      counters.busy++;
      return reject(req, res, 429, 'busy', { retryAfter: 15 }, { 'Retry-After': '15' });
    }
    const t0 = Date.now();
    let meter;
    try {
      // Só agora o cliente pode mandar os bytes (com Expect: 100-continue, ele ficou esperando este "pode enviar").
      if (expectContinue) res.writeContinue();
      req.socket.setTimeout(cfg.clientIdleMs);
      req.socket.once('timeout', () => req.destroy(Object.assign(new Error('client_idle'), { code: 'client_idle' })));
      req.once('end', () => req.socket.setTimeout(0)); // depois do upload quem demora é o clamd, não o cliente

      meter = new Meter(effectiveMax());
      pipeline(req, meter, () => {}); // se o cliente cair, o erro desce até o clamd.instream
      const r = await clamd.instream(cfg.clamd, meter, { idleMs: cfg.clamdIdleMs, deadlineMs: cfg.scanTimeoutMs, frameBytes: cfg.frameBytes });

      if (r.status === 'error') {
        counters.errors++;
        log.error('scan_erro_engine', { id: reqId, name, size: meter.size, code: r.code, detail: r.detail });
        const tooBig = r.code === 'size_limit';
        return reject(req, res, tooBig ? 413 : 502, tooBig ? 'engine_size_limit' : 'scan_failed', { detail: r.detail, hint: tooBig ? 'Aumente StreamMaxLength no clamd.conf (e MAX_FILE_MB aqui deve ser menor ou igual).' : undefined });
      }
      const verdict = {
        status: r.status, signature: r.signature || null,
        sha256: meter.hash.digest('hex'), size: meter.size, scannedAt: Date.now(),
        id: reqId, scanMs: Date.now() - t0, engine: (await engine()),
      };
      verdict.sig = verdictLib.sign(a.token, verdict);
      counters.scanned++; counters.bytes += meter.size; counters[r.status === 'infected' ? 'infected' : 'clean']++;
      log.info('scan', { id: reqId, ip, name, size: verdict.size, status: verdict.status, signature: verdict.signature, ms: verdict.scanMs });
      send(res, 200, verdict);
    } catch (e) {
      const aborted = ac.signal.aborted || e.code === 'client_idle' || e.code === 'ECONNRESET' || /aborted/i.test(e.message || '');
      if (aborted) { log.warn('cliente_desistiu', { id: reqId, ip, name, recebido: meter?.size }); return; }
      counters.errors++;
      if (e.code === 'too_large') {
        const engineLimited = effectiveMax() < cfg.maxFileBytes;
        log.warn('muito_grande', { id: reqId, name, limite: effectiveMax() });
        return reject(req, res, 413, engineLimited ? 'engine_size_limit' : 'too_large', { maxBytes: effectiveMax(), hint: engineLimited ? 'Aumente StreamMaxLength no clamd.conf.' : undefined });
      }
      if (e.code === 'closed') { // o clamd fechou no meio: se só acontece com arquivos grandes, quase sempre é StreamMaxLength
        log.error('clamd_fechou_no_meio', { id: reqId, name, enviados: meter?.size, limiteConhecido: streamMax });
        refreshStreamMax();
        return reject(req, res, 502, 'engine_closed_connection', { detail: e.message, hint: 'O clamd encerrou a conexão no meio. Se isso só acontece com arquivos grandes, aumente StreamMaxLength no clamd.conf.' }, { 'Retry-After': '30' });
      }
      if (e.code === 'unavailable') { log.error('clamd_indisponivel', { id: reqId, err: e.message }); return reject(req, res, 503, 'engine_unavailable', { detail: e.message }, { 'Retry-After': '30' }); }
      if (e.code === 'timeout') { log.error('scan_timeout', { id: reqId, name, size: meter?.size }); return reject(req, res, 504, 'scan_timeout'); }
      log.error('scan_falhou', { id: reqId, err: String(e.stack || e).slice(0, 400) });
      reject(req, res, 502, 'scan_failed', { detail: e.message });
    } finally { release(); }
  }

  const guard = (expect) => (req, res) => route(req, res, expect).catch((e) => {
    log.error('erro_interno', { err: String(e.stack || e).slice(0, 500) });
    if (!res.headersSent) send(res, 500, { error: 'internal' }); else res.destroy();
  });

  const server = cfg.tls
    ? https.createServer({ cert: fs.readFileSync(cfg.tls.certFile), key: fs.readFileSync(cfg.tls.keyFile) })
    : http.createServer();
  server.on('request', guard(false));
  server.on('checkContinue', guard(true)); // clientes que mandam "Expect: 100-continue": validamos antes de eles enviarem qualquer byte
  server.requestTimeout = 0; // uploads grandes: o limite é "tempo parado" (clientIdleMs), não tempo total
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
      porta: cfg.port, tls: !!cfg.tls, clamd: cfg.clamd.socket || `${cfg.clamd.host}:${cfg.clamd.port}`,
      maxArquivoMB: Math.round(cfg.maxFileBytes / 1048576), simultaneos: cfg.maxConcurrent, ips_permitidos: cfg.allowedIps.length || 'todos',
    });
    if (!cfg.tls) log.warn('sem_tls', { aviso: 'Este serviço fala HTTP puro. Exponha só atrás de um proxy HTTPS (Caddy/nginx) ou numa rede privada (WireGuard/VPC).' });
    if (!cfg.allowedIps.length) log.warn('sem_lista_de_ips', { aviso: 'ALLOWED_IPS vazio: qualquer IP com o token pode usar. Recomendado limitar ao IP do TeamDrive.' });
  });
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true;
    log.info('encerrando', { sinal: sig, ativos: svc.gate.active });
    svc.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 60_000).unref(); // espera os escaneamentos em andamento por até 1 min
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (require.main === module) main();
module.exports = { createService, Meter };
