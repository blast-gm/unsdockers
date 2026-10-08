// Autenticação por token (Bearer), comparação em tempo constante, e freio para tentativas erradas.
// Importante: o freio só segura quem ERRA o token; quem acerta nunca é bloqueado
// (senão um atacante atrás do mesmo proxy conseguiria travar o TeamDrive de propósito).
const crypto = require('crypto');
const { ipAllowed, normalizeIp } = require('./config');

function makeAuth(cfg) {
  const digests = cfg.tokens.map((t) => ({ token: t, d: crypto.createHash('sha256').update(t).digest() }));
  const fails = new Map(); // ip -> { n, reset }
  setInterval(() => { const now = Date.now(); for (const [k, v] of fails) if (v.reset < now) fails.delete(k); }, 60_000).unref();

  /** IP de quem chamou. Atrás de proxy (TRUST_PROXY=1) usa o último X-Forwarded-For, que foi o proxy que escreveu. */
  function clientIp(req) {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return normalizeIp(xff[xff.length - 1]) || xff[xff.length - 1];
    }
    return normalizeIp(req.socket.remoteAddress) || String(req.socket.remoteAddress || '');
  }

  function ipOk(ip) { return ipAllowed(cfg.allowedIps, ip); }

  /** -> { ok:true, token } | { ok:false, status, error } */
  function check(req, ip) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    if (m) {
      const got = crypto.createHash('sha256').update(m[1]).digest();
      for (const t of digests) if (crypto.timingSafeEqual(got, t.d)) return { ok: true, token: t.token };
    }
    const now = Date.now();
    const f = fails.get(ip) && fails.get(ip).reset > now ? fails.get(ip) : { n: 0, reset: now + 10 * 60_000 };
    f.n++; fails.set(ip, f);
    return f.n > cfg.authFailLimit ? { ok: false, status: 429, error: 'too_many_failures' } : { ok: false, status: 401, error: 'unauthorized' };
  }
  return { clientIp, ipOk, check };
}
module.exports = { makeAuth };
