#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in order, once each, and records them in schema_migrations.
 *
 *   node scripts/migrate.js            apply pending migrations
 *   node scripts/migrate.js --status   list applied / pending, change nothing
 *
 * Railway runs this as the pre-deploy command: a failing migration stops the deploy,
 * so the new code never starts against an old schema.
 *
 * Safety:
 *  - pg_advisory_lock: two deploys can't migrate at the same time.
 *  - Each file runs in ONE transaction together with its schema_migrations row
 *    (the file's own top-level BEGIN;/COMMIT; lines are replaced by ours).
 *  - A changed checksum on an applied file stops the run: applied migrations are
 *    immutable; write a new one instead.
 *  - lock_timeout keeps a migration from queueing forever behind live traffic.
 *
 * Reads only DATABASE_URL / DATABASE_SSL, so it can run before the app's full config exists.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const LOCK_KEY = 727_101; // arbitrary, stable
const statusOnly = process.argv.includes('--status');

const log = (level, message, fields = {}) =>
  (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify({ level, message, component: 'migrate', ...fields, time: new Date().toISOString() })}\n`);

function sslFor(mode) {
  if (mode === 'verify') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

/** Replace the file's own top-level transaction lines; we wrap it ourselves. */
function unwrap(sql, file) {
  const begins = sql.match(/^BEGIN;\s*$/gm)?.length ?? 0;
  const commits = sql.match(/^COMMIT;\s*$/gm)?.length ?? 0;
  if (begins > 1 || commits > 1 || begins !== commits) {
    throw new Error(`${file}: expected at most one top-level BEGIN;/COMMIT; pair`);
  }
  if (/\bCONCURRENTLY\b/i.test(sql)) throw new Error(`${file}: CONCURRENTLY can't run inside a transaction; put it in its own non-transactional step`);
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log('error', 'DATABASE_URL is not set');
    process.exit(1);
  }
  const files = (await readdir(DIR)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  const connect = () => new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_SSL),
    application_name: 'sm-erp-migrate',
    connectionTimeoutMillis: 10_000,
  });

  // Postgres may still be starting when a fresh environment deploys. A pg Client can't be
  // reused after a failed connect, so each attempt gets a new one.
  let client;
  for (let attempt = 1; ; attempt += 1) {
    client = connect();
    try {
      await client.connect();
      break;
    } catch (err) {
      await client.end().catch(() => {});
      if (attempt >= 10) throw err;
      log('warn', 'Database not reachable yet, retrying', { attempt, error: err.message });
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }

  try {
    await client.query(`SET lock_timeout = '15s'`);
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    if (process.env.MIGRATE_ADOPT_EMPTY_LEGACY === 'true' && !statusOnly) await resetEmptyLegacySchema(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version      varchar(100) PRIMARY KEY,
        checksum     char(64)     NOT NULL,
        applied_at   timestamptz  NOT NULL DEFAULT now(),
        duration_ms  integer      NOT NULL
      )`);
    const applied = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));

    let ran = 0;
    for (const file of files) {
      const sql = await readFile(path.join(DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`${file} was changed after it was applied (checksum mismatch). Never edit an applied migration; add a new one.`);
        }
        if (statusOnly) log('info', 'applied', { migration: file });
        continue;
      }
      if (statusOnly) {
        log('info', 'pending', { migration: file });
        continue;
      }

      const started = Date.now();
      log('info', 'Applying migration', { migration: file });
      try {
        await client.query('BEGIN');
        await client.query(unwrap(sql, file));
        await client.query('INSERT INTO schema_migrations (version, checksum, duration_ms) VALUES ($1, $2, $3)', [file, checksum, Date.now() - started]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${file} failed and was rolled back: ${err.message}${err.position ? ` (at character ${err.position})` : ''}`);
      }
      ran += 1;
      log('info', 'Applied migration', { migration: file, durationMs: Date.now() - started });
    }
    if (!statusOnly) log('info', ran ? 'Migrations complete' : 'Database already up to date', { applied: ran, total: files.length });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

/**
 * One-off escape hatch for a database whose tables were created outside this runner
 * (no schema_migrations table). With MIGRATE_ADOPT_EMPTY_LEGACY=true, and ONLY if every
 * table in `public` is empty, the schema is dropped and rebuilt by the migrations.
 * Any row anywhere stops the run instead. Remove the variable after the first deploy.
 */
async function resetEmptyLegacySchema(client) {
  // "Tracked" = the runner has recorded at least one migration here (an empty table left by a failed run doesn't count).
  const exists = (await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS t`)).rows[0].t;
  if (exists && (await client.query('SELECT 1 FROM schema_migrations LIMIT 1')).rowCount > 0) return;
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`)).rows.map((r) => r.tablename);
  if (tables.length === 0) return;
  for (const table of tables) {
    const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM public."${table.replace(/"/g, '""')}") AS has_rows`);
    if (rows[0].has_rows) throw new Error(`Legacy table ${table} has data; refusing to reset. Migrate it by hand.`);
  }
  log('warn', 'Resetting empty legacy schema created outside the migration runner', { tables });
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
}

main().catch((err) => {
  log('error', 'Migration run failed', { error: err.message });
  process.exit(1);
});
