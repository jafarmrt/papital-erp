import * as schema from './schema.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import fs from 'fs';
import { logger } from '../middleware/logger.js';

const { Pool } = pkg;

const rawDbUrl = (process.env.DATABASE_URL || '').trim();

let pool: pkg.Pool;

const maxPoolSize = parseInt(process.env.DB_POOL_MAX || '20', 10);
const idleTimeoutMillis = parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10);
const connectionTimeoutMillis = parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10);
const statementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT || '60000', 10);
const idleInTxTimeoutMs = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT || '30000', 10);

const isSsl = rawDbUrl.includes('sslmode=require') || 
              rawDbUrl.includes('neon.tech') || 
              rawDbUrl.includes('supabase.co');

const caPath = process.env.POSTGRES_SSL_CA_PATH;
const sslConfig = isSsl ? {
  rejectUnauthorized: true,
  ca: (caPath && fs.existsSync(caPath)) ? fs.readFileSync(caPath, 'utf8') : undefined,
} : undefined;

if (process.env.SQL_HOST) {
  pool = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl: (process.env.SQL_SSL === 'true' || process.env.POSTGRES_SSL === 'true') ? sslConfig : undefined,
    max: maxPoolSize,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    allowExitOnIdle: false,
  });
} else if (rawDbUrl) {
  pool = new Pool({
    connectionString: rawDbUrl,
    ssl: sslConfig,
    max: maxPoolSize,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    allowExitOnIdle: false,
  });
} else {
  logger.warn({ message: '⚠️ DATABASE_URL or SQL_HOST is not configured in environment. Initializing fallback pool to prevent server startup crash.' });
  pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'workshop_erp',
    user: 'postgres',
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    allowExitOnIdle: false,
  });
}

// Attach error listener and set session-level statement & idle transaction timeouts for every client
pool.on('connect', (client: any) => {
  client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch((err: any) => {
    logger.warn({ message: `Failed to set statement_timeout: ${err.message}` });
  });
  client.query(`SET idle_in_transaction_session_timeout = ${idleInTxTimeoutMs}`).catch((err: any) => {
    logger.warn({ message: `Failed to set idle_in_transaction_session_timeout: ${err.message}` });
  });

  client.on('error', (err: any) => {
    const msg = err?.message || String(err);
    if (
      msg.includes('terminating connection') ||
      msg.includes('Connection terminated') ||
      msg.includes('connection terminated') ||
      msg.includes('read ECONNRESET') ||
      msg.includes('socket closed') ||
      msg.includes('idle-in-transaction') ||
      msg.includes('canceling statement due to statement timeout') ||
      msg.includes('timeout')
    ) {
      logger.warn({ message: `[PostgreSQL Client Warning] Handled connection termination: ${msg}` });
      return;
    }
    logger.error({ message: '[PostgreSQL Client Error]', error: err });
  });
});

pool.on('acquire', () => {
  // Client connection acquired from pool
});

pool.on('release', () => {
  // Client connection released back to pool
});

pool.on('error', (err: any) => {
  const msg = err?.message || String(err);
  if (
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('terminating connection') ||
    msg.includes('connection terminated') ||
    msg.includes('read ECONNRESET') ||
    msg.includes('socket closed') ||
    msg.includes('idle-in-transaction') ||
    msg.includes('canceling statement due to statement timeout') ||
    msg.includes('timeout')
  ) {
    logger.warn({ message: `[PostgreSQL Pool Warning] Handled pool error: ${msg}` });
    return;
  }
  logger.error({ message: 'Unexpected error on PostgreSQL pool client', error: err });
});

/**
 * Helper to run long-running database operations (such as Excel bulk imports or heavy reports)
 * with an extended statement_timeout (default 300,000 ms / 5 minutes).
 */
export async function withLongQueryTimeout<T>(
  fn: (client?: any) => Promise<T>,
  timeoutMs: number = 300000
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    return await fn(client);
  } finally {
    await client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch(() => {});
    client.release();
  }
}

const orm = drizzle(pool, { schema });

export { pool, orm };


