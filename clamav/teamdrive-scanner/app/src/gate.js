// Portão de concorrência: no máximo N escaneamentos ao mesmo tempo; o resto espera numa fila curta.
// Enquanto espera, o corpo da requisição NÃO é lido — o TCP segura o cliente, sem gastar memória aqui.
class Gate {
  constructor(max, queueMax) { this.max = max; this.queueMax = queueMax; this.active = 0; this.waiters = []; this.peak = 0; }
  get waiting() { return this.waiters.length; }

  acquire({ waitMs, signal } = {}) {
    if (this.active < this.max) return Promise.resolve(this._take());
    if (this.waiters.length >= this.queueMax) return Promise.reject(Object.assign(new Error('busy'), { code: 'busy' }));
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, timer: null, onAbort: null };
      const leave = () => { clearTimeout(w.timer); signal?.removeEventListener('abort', w.onAbort); this.waiters = this.waiters.filter((x) => x !== w); };
      w.timer = setTimeout(() => { leave(); reject(Object.assign(new Error('busy'), { code: 'busy' })); }, waitMs);
      w.onAbort = () => { leave(); reject(Object.assign(new Error('aborted'), { code: 'aborted' })); };
      signal?.addEventListener('abort', w.onAbort, { once: true });
      w.leave = leave;
      this.waiters.push(w);
    });
  }
  _take() {
    this.active++; this.peak = Math.max(this.peak, this.active);
    let released = false;
    return () => {
      if (released) return; released = true; this.active--;
      const next = this.waiters.shift();
      if (next) { next.leave(); next.resolve(this._take()); }
    };
  }
}
module.exports = { Gate };
