// Configuração por variáveis de ambiente. Falha logo na partida se algo essencial estiver errado
// (melhor do que subir "aberto" por engano). Mesmo padrão do teamdrive-scanner.
const num = (v, d, { min = 1 } = {}) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : d; };

const isV4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const toInt = (v4) => v4.split('.').reduce((a, o) => ((a << 8) + Number(o)) >>> 0, 0);
function normalizeIp(ip) {
  if (!ip) return null;
  ip = String(ip).trim().toLowerCase();
  if (ip.startsWith('::ffff:') && isV4(ip.slice(7))) ip = ip.slice(7); // IPv4 "embrulhado" em IPv6
  if (isV4(ip)) return ip.split('.').every((o) => Number(o) <= 255) ? ip : null;
  return /^[0-9a-f:]+$/.test(ip) && ip.includes(':') ? ip : null;
}
function parseIpList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [addr, bits] = entry.split('/');
    const norm = normalizeIp(addr);
    if (!norm) throw new Error(`ALLOWED_IPS: endereço inválido "${entry}"`);
    if (bits === undefined) return { ip: norm };
    if (!/^\d+$/.test(bits) || !isV4(norm) || Number(bits) > 32) throw new Error(`ALLOWED_IPS: só aceito CIDR IPv4 válido ("${entry}")`);
    return { cidr: toInt(norm), bits: Number(bits) };
  });
}
function ipAllowed(list, ip) {
  if (!list.length) return true; // sem lista: libera (a autenticação por token continua valendo)
  const n = normalizeIp(ip);
  if (!n) return false;
  return list.some((e) => (e.ip ? e.ip === n : isV4(n) && (e.bits === 0 || (toInt(n) >>> (32 - e.bits)) === (e.cidr >>> (32 - e.bits)))));
}

function load(env = process.env) {
  const tokens = String(env.TRANSLATE_TOKENS || env.TRANSLATE_TOKEN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) throw new Error('Defina TRANSLATE_TOKEN (gere com: openssl rand -hex 32).');
  if (tokens.some((t) => t.length < 24)) throw new Error('TRANSLATE_TOKEN curto demais: use pelo menos 24 caracteres aleatórios (openssl rand -hex 32).');
  const cfg = {
    host: env.HOST || '0.0.0.0',
    port: num(env.PORT, 8090),
    tokens, // aceita vários para poder trocar o token sem derrubar quem chama (ex.: o CoopIA)
    upstream: (env.LT_UPSTREAM || 'http://127.0.0.1:5000').replace(/\/+$/, ''), // LibreTranslate local, dentro do mesmo container
    maxTextChars: num(env.MAX_TEXT_CHARS, 20000), // tamanho máximo de UM texto por chamada
    maxBatch: num(env.MAX_BATCH, 50, { min: 1 }), // quantos textos cabem numa chamada /v1/translate-batch
    maxConcurrent: num(env.MAX_CONCURRENT_TRANSLATIONS, 4),
    queueMax: num(env.QUEUE_MAX, 40, { min: 0 }),
    queueWaitMs: num(env.QUEUE_WAIT_SECONDS, 60) * 1000,
    translateTimeoutMs: num(env.TRANSLATE_TIMEOUT_SECONDS, 60) * 1000,
    allowedIps: parseIpList(env.ALLOWED_IPS),
    trustProxy: env.TRUST_PROXY === '1',
    authFailLimit: num(env.AUTH_FAIL_LIMIT, 20),
  };
  if (cfg.maxConcurrent > 32) throw new Error('MAX_CONCURRENT_TRANSLATIONS muito alto (máx. 32).');
  return cfg;
}

module.exports = { load, ipAllowed, normalizeIp, parseIpList };
