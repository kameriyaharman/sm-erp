/**
 * Structured JSON logger: one line per event on stdout/stderr, which Railway parses
 * natively (`level` colours the line, `message` is the text, every other field is a
 * filterable attribute, e.g. @requestId:abc). No transports, no buffering.
 *
 * - LOG_LEVEL (debug | info | warn | error) drops anything below it.
 * - Railway deployment metadata is attached to every line.
 * - Keys that look like secrets are redacted, as a last line of defence.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|signature/i;

const base = Object.fromEntries(Object.entries({
  service: process.env.RAILWAY_SERVICE_NAME,
  deployment: process.env.RAILWAY_DEPLOYMENT_ID?.slice(0, 8),
  replica: process.env.RAILWAY_REPLICA_ID?.slice(0, 8),
}).filter(([, v]) => v));

function clean(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (v === undefined) continue;
    if (SECRET_KEY.test(k)) out[k] = '[redacted]';
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message, stack: v.stack };
    else out[k] = v;
  }
  return out;
}

function write(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  let line;
  try {
    line = JSON.stringify({ ...base, ...clean(meta), level, message, time: new Date().toISOString() });
  } catch {
    line = JSON.stringify({ ...base, level, message, time: new Date().toISOString(), note: 'unserialisable log fields dropped' });
  }
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
