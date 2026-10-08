// O veredito vai ASSINADO (HMAC-SHA256) amarrado ao sha256 e ao tamanho do arquivo que foi escaneado.
// Assim o TeamDrive consegue provar que "o arquivo escaneado é exatamente o arquivo que vou guardar",
// mesmo que haja um proxy no meio, e não aceita um "limpo" forjado ou reaproveitado de outro arquivo.
const crypto = require('crypto');

const keyFor = (token) => crypto.createHash('sha256').update('teamdrive-scanner-verdict:' + token).digest();
const canonical = (v) => ['v1', v.status, v.signature || '', v.sha256, v.size, v.scannedAt].join('|');

function sign(token, verdict) {
  return crypto.createHmac('sha256', keyFor(token)).update(canonical(verdict)).digest('hex');
}
function verify(token, verdict) {
  if (!verdict || typeof verdict.sig !== 'string' || !/^[0-9a-f]{64}$/.test(verdict.sig)) return false;
  const expected = Buffer.from(sign(token, verdict), 'hex');
  const got = Buffer.from(verdict.sig, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
module.exports = { sign, verify, canonical };
