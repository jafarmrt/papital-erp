import * as schema from './schema.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import fs from 'fs';
import { logger } from '../middleware/logger.js';
import { mockPool } from './mockPool.js';

const { Pool } = pkg;

const rawDbUrl = (process.env.DATABASE_URL || '').trim();
const isPlaceholderDbUrl = !rawDbUrl ||
  rawDbUrl.includes('@host:') ||
  rawDbUrl.includes('user:password@host') ||
  rawDbUrl === 'postgresql://user:password@host:5432/dbname';

let realPool: pkg.Pool | null = null;
let useMock = isPlaceholderDbUrl;

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

if (!isPlaceholderDbUrl && (process.env.SQL_HOST || rawDbUrl)) {
  try {
    if (process.env.SQL_HOST) {
      realPool = new Pool({
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
    } else {
      realPool = new Pool({
        connectionString: rawDbUrl,
        ssl: sslConfig,
        max: maxPoolSize,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        allowExitOnIdle: false,
      });
    }

    realPool.on('connect', (client: pkg.PoolClient) => {
      client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ message: `Failed to set statement_timeout: ${errorMsg}` });
      });
      client.query(`SET idle_in_transaction_session_timeout = ${idleInTxTimeoutMs}`).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ message: `Failed to set idle_in_transaction_session_timeout: ${errorMsg}` });
      });

      client.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
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

    realPool.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
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
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ message: `Failed to initialize real PostgreSQL pool: ${errorMsg}. Using in-memory mock.` });
    useMock = true;
  }
} else {
  logger.info({ message: 'ℹ️ Placeholder or unconfigured DATABASE_URL. Running in-memory demo database mode.' });
  useMock = true;
}

const pool: pkg.Pool = new Proxy({} as pkg.Pool, {
  get: (_target, prop: string | symbol) => {
    const active = (!useMock && realPool) ? realPool : mockPool;
    const val = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(active) : val;
  }
});

/**
 * Helper to run long-running database operations with an extended statement_timeout.
 */
export async function withLongQueryTimeout<T>(
  fn: (client: pkg.PoolClient) => Promise<T>,
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

export type AppDatabase = typeof orm;
export type DbTransaction = Parameters<Parameters<typeof orm.transaction>[0]>[0];
export type DbExecutor = AppDatabase | DbTransaction;

export { pool, orm };
