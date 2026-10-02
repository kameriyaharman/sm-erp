import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const sslOptions = {
  disable: undefined,
  'no-verify': { rejectUnauthorized: false },
  verify: { rejectUnauthorized: true },
};

// Return DATE columns as 'YYYY-MM-DD' strings. The default parser builds a JS Date at
// local midnight, which shifts the day when serialised to UTC (e.g. due dates in IST).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/**
 * One pool per process. Sizing: replicas x DB_POOL_MAX must stay well below the
 * server's max_connections, leaving room for migrations, cron jobs and psql.
 *
 * Every connection gets server-side limits, so one slow report or an abandoned
 * transaction can't hold a connection (and its locks) forever:
 *   statement_timeout                     DB_STATEMENT_TIMEOUT_MS
 *   idle_in_transaction_session_timeout   2 x statement timeout
 *   lock_timeout                          half the statement timeout
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: sslOptions[env.DATABASE_SSL],
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
  maxLifetimeSeconds: env.DB_MAX_LIFETIME_SECONDS,
  keepAlive: true,
  application_name: `sm-erp-api${process.env.RAILWAY_REPLICA_ID ? `:${process.env.RAILWAY_REPLICA_ID.slice(0, 8)}` : ''}`,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_STATEMENT_TIMEOUT_MS * 2,
  lock_timeout: Math.floor(env.DB_STATEMENT_TIMEOUT_MS / 2),
});

pool.on('error', (err) => {
  logger.error('Unexpected idle Postgres client error', { error: err.message });
});

export const query = (text, params) => pool.query(text, params);

/** Pool numbers for /health/ready and logs. */
export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: env.DB_POOL_MAX };
}

/**
 * Runs `work(client)` inside a transaction. Commits on success, rolls back on any error.
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
