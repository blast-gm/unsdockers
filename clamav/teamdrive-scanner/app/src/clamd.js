// Cliente do clamd por STREAM (comando zINSTREAM). Nada é gravado em disco no scanner:
// os bytes vêm do cliente, passam por aqui em pedaços e vão direto para o clamd.
//
// Protocolo (docs.clamav.net/manual/Usage/ClamdProtocol.html):
//   cliente -> "zINSTREAM\0"
//   cliente -> [4 bytes big-endian = tamanho][bytes]  (repete)
//   cliente -> [0,0,0,0]                               (fim do stream)
//   clamd   -> "stream: OK\0" | "stream: <Nome> FOUND\0" | "<texto> ERROR\0"
const net = require('net');

class ClamdError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function connect(cfg) {
  return cfg.socket ? net.connect({ path: cfg.socket }) : net.connect({ host: cfg.host, port: cfg.port });
}
const netError = (e) => {
  if (['ECONNREFUSED', 'ENOENT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EACCES'].includes(e.code)) return new ClamdError('unavailable', `Não consegui falar com o clamd (${e.code}).`);
  if (['ECONNRESET', 'EPIPE'].includes(e.code)) return new ClamdError('closed', 'O clamd fechou a conexão no meio do escaneamento.');
  return e;
};

/** Interpreta a resposta do clamd (ignora o prefixo "stream:"/"instream (local):" — só o final importa). */
function parseReply(text) {
  const t = String(text).replace(/\0/g, '').trim();
  if (/ERROR$/.test(t)) {
    const detail = t.replace(/^[^:]*:\s*/, '').replace(/\s*ERROR$/, '');
    return { status: 'error', code: /size limit/i.test(t) ? 'size_limit' : 'engine_error', detail };
  }
  if (/ FOUND$/.test(t)) return { status: 'infected', signature: t.replace(/^[^:]*:\s*/, '').replace(/\s*FOUND$/, '').trim() };
  if (/OK$/.test(t)) return { status: 'clean' };
  return { status: 'error', code: 'bad_reply', detail: t.slice(0, 200) };
}

/** Comando simples (zPING, zVERSION). */
function command(cfg, cmd, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = connect(cfg);
    let out = '';
    const end = (err, val) => { clearTimeout(t); sock.destroy(); err ? reject(err) : resolve(val); };
    const t = setTimeout(() => end(new ClamdError('timeout', 'clamd não respondeu a tempo.')), timeoutMs);
    sock.on('error', (e) => end(netError(e)));
    sock.on('data', (d) => { out += d; if (out.includes('\0')) end(null, out.replace(/\0/g, '').trim()); });
    sock.on('close', () => end(out ? null : new ClamdError('closed', 'clamd fechou sem responder.'), out.replace(/\0/g, '').trim()));
    sock.once('connect', () => sock.write(`z${cmd}\0`));
  });
}
const ping = async (cfg, ms) => (await command(cfg, 'PING', ms)) === 'PONG';
const version = (cfg, ms) => command(cfg, 'VERSION', ms);

// espera o buffer do socket esvaziar (ou o socket morrer, para nunca ficar preso)
const drained = (sock) => new Promise((resolve) => {
  const done = () => { sock.off('drain', done); sock.off('close', done); resolve(); };
  sock.once('drain', done); sock.once('close', done);
});

/**
 * Envia `source` (async iterable de Buffers) ao clamd em stream.
 * Resolve com { status: 'clean'|'infected'|'error', signature?, code?, detail? }.
 * Rejeita com ClamdError (unavailable | timeout | closed) ou com o erro vindo da própria `source` (ex.: cliente caiu).
 */
function instream(cfg, source, { idleMs, deadlineMs, frameBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = connect(cfg);
    let reply = '';
    let finished = false;
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      sock.destroy();
      err ? reject(err) : resolve(val);
    };
    const deadline = setTimeout(() => finish(new ClamdError('timeout', 'O escaneamento passou do tempo máximo.')), deadlineMs);
    sock.setNoDelay(true);
    sock.setTimeout(idleMs, () => finish(new ClamdError('timeout', 'O clamd ficou parado sem responder.')));
    sock.on('error', (e) => finish(netError(e)));
    sock.on('data', (d) => {
      reply += d;
      if (reply.length > 8192) return finish(new ClamdError('bad_reply', 'Resposta do clamd grande demais.'));
      if (reply.includes('\0')) finish(null, parseReply(reply)); // o clamd pode responder cedo (ex.: limite de tamanho)
    });
    sock.on('close', () => { if (!finished) finish(reply ? null : new ClamdError('closed', 'O clamd fechou a conexão sem responder.'), reply ? parseReply(reply) : undefined); });

    sock.once('connect', async () => {
      try {
        sock.write('zINSTREAM\0');
        for await (const chunk of source) {
          if (finished) return; // o clamd já respondeu: pare de enviar
          for (let off = 0; off < chunk.length; off += frameBytes) {
            const part = chunk.subarray(off, Math.min(chunk.length, off + frameBytes));
            const head = Buffer.allocUnsafe(4);
            head.writeUInt32BE(part.length, 0);
            sock.cork(); sock.write(head);
            const ok = sock.write(part);
            sock.uncork();
            if (!ok) await drained(sock); // contrapressão: não enche a memória se o clamd for mais lento
            if (finished) return;
          }
        }
        if (!finished) sock.write(Buffer.alloc(4)); // terminador: agora o clamd escaneia e responde
      } catch (e) { finish(e); }
    });
  });
}

/**
 * Descobre o StreamMaxLength REAL do clamd sem enviar nenhum dado.
 * O clamd confere o tamanho de cada pedaço pelo cabeçalho de 4 bytes, ANTES de ler o conteúdo: se o pedaço não cabe na cota,
 * responde "INSTREAM size limit exceeded" na hora; se cabe, fica esperando os dados (e nós desconectamos).
 * Busca binária => uns 32 cabeçalhos. Devolve o limite em bytes, ou Infinity se aceita o máximo de um pedaço (4 GiB - 1).
 * (Motivo: se o arquivo passa do limite, o clamd responde e FECHA com dados não lidos no buffer; o TCP então manda um RST que
 *  apaga a resposta, e o scanner só enxergaria "conexão fechada". Saber o limite antes evita isso.)
 */
function accepts(cfg, len, waitMs) {
  return new Promise((resolve, reject) => {
    const sock = connect(cfg); let out = '';
    const end = (v, err) => { clearTimeout(t); sock.destroy(); err ? reject(err) : resolve(v); };
    const t = setTimeout(() => end(true), waitMs); // sem reclamar no prazo: ele está esperando o conteúdo => aceita
    sock.on('error', (e) => end(null, netError(e)));
    sock.on('data', (d) => { out += d; if (out.includes('\0')) end(!/size limit/i.test(out)); });
    sock.on('close', () => end(/size limit/i.test(out) ? false : true));
    sock.once('connect', () => { const h = Buffer.alloc(4); h.writeUInt32BE(len, 0); sock.write(Buffer.concat([Buffer.from('zINSTREAM\0'), h])); });
  });
}
async function probeStreamMax(cfg, { waitMs = 150 } = {}) {
  const MAX = 0xffffffff;
  if (await accepts(cfg, MAX, waitMs)) return Infinity;
  let lo = 0, hi = MAX; // lo sempre aceito (0 = fim do stream), hi sempre recusado
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await accepts(cfg, mid, waitMs)) lo = mid; else hi = mid; }
  return lo;
}

module.exports = { instream, command, ping, version, parseReply, probeStreamMax, ClamdError };
