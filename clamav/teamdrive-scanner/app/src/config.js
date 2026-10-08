// Configuração por variáveis de ambiente. Falha logo na partida se algo essencial estiver errado
// (melhor do que subir "aberto" por engano).
const MB = 1024 * 1024;
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
  const tokens = String(env.SCANNER_TOKENS || env.SCANNER_TOKEN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) throw new Error('Defina SCANNER_TOKEN (gere com: openssl rand -hex 32).');
  if (tokens.some((t) => t.length < 24)) throw new Error('SCANNER_TOKEN curto demais: use pelo menos 24 caracteres aleatórios (openssl rand -hex 32).');
  const cfg = {
    host: env.HOST || '0.0.0.0',
    port: num(env.PORT, 8080),
    tokens, // aceita vários para poder trocar o token sem derrubar o TeamDrive
    clamd: { host: env.CLAMD_HOST || '127.0.0.1', port: num(env.CLAMD_PORT, 3310), socket: env.CLAMD_SOCKET || '' },
    maxFileBytes: num(env.MAX_FILE_MB, 2047) * MB, // o ClamAV não escaneia arquivo >= 2 GiB (MaxFileSize máx. 2147483645); deve ser <= StreamMaxLength do clamd.conf
    maxConcurrent: num(env.MAX_CONCURRENT_SCANS, 2), // escaneamentos simultâneos (<= MaxThreads do clamd)
    queueMax: num(env.QUEUE_MAX, 20, { min: 0 }), // quantos esperam vaga antes de levar 429
    queueWaitMs: num(env.QUEUE_WAIT_SECONDS, 120) * 1000,
    scanTimeoutMs: num(env.SCAN_TIMEOUT_SECONDS, 1800) * 1000, // teto por arquivo
    clientIdleMs: num(env.CLIENT_IDLE_SECONDS, 60) * 1000, // sem receber bytes do cliente por tanto tempo: derruba
    clamdIdleMs: num(env.CLAMD_IDLE_SECONDS, 600) * 1000, // clamd sem responder depois de receber tudo
    frameBytes: 64 * 1024, // tamanho de cada pedaço enviado ao clamd
    allowedIps: parseIpList(env.ALLOWED_IPS),
    trustProxy: env.TRUST_PROXY === '1', // atrás de Caddy/nginx: usa X-Forwarded-For para o IP real
    tls: env.TLS_CERT && env.TLS_KEY ? { certFile: env.TLS_CERT, keyFile: env.TLS_KEY } : null,
    authFailLimit: num(env.AUTH_FAIL_LIMIT, 20),
  };
  if (cfg.maxConcurrent > 16) throw new Error('MAX_CONCURRENT_SCANS muito alto (máx. 16).');
  return cfg;
}

module.exports = { load, ipAllowed, normalizeIp, parseIpList, MB };
