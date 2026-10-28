// Log em JSON, uma linha por evento. Idêntico ao log.js do teamdrive-scanner.
const clean = (s, n = 120) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
let quiet = false;
function log(level, evt, fields = {}) {
  if (quiet) return;
  const line = { t: new Date().toISOString(), level, evt, ...fields };
  (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(line) + '\n');
}
module.exports = {
  info: (e, f) => log('info', e, f), warn: (e, f) => log('warn', e, f), error: (e, f) => log('error', e, f),
  clean, setQuiet: (q) => { quiet = !!q; },
};
