import * as schema from './schema.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pkg from 'pg';
import fs from 'fs';
import { logger } from '../middleware/logger.js';
import { resolveDatabaseMode, type DatabaseMode } from './databaseMode.js';
import { ServerTimestampClient } from './serverTimestampClient.js';

const { Pool } = pkg;

// v9.0.428 (TD-616, decision t4 «الف»): SQL_HOST or a real DATABASE_URL, otherwise refused (the server does not start).
// v11 (phase 4.1): the in-memory demo database is gone; there is no other database than PostgreSQL.
const databaseMode: DatabaseMode = resolveDatabaseMode(process.env);
const rawDbUrl = databaseMode.kind === 'url' ? databaseMode.url : '';

let realPool: pkg.Pool | null = null;

const maxPoolSize = parseInt(process.env.DB_POOL_MAX || '20', 10);
const idleTimeoutMillis = parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10);
const connectionTimeoutMillis = parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10);
const statementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT || '60000', 10);
const idleInTxTimeoutMs = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT || '60000', 10);

// v7.0.39 (TD-176 / audit P2-11): زمان‌های انتظار جلسه در بسته راه‌اندازی اتصال ارسال می‌شوند، نه با یک SET
// بدون انتظار در رویداد connect (که هشدار منسوخ‌شدن pg را می‌داد و در pg@9 خطا می‌شود).
// اگر DATABASE_URL خودش پارامتر options داشته باشد، pg همان را جایگزین این مقدار می‌کند.
// v8.0.52 (TD-314): منطقه زمانی جلسه UTC است، هم‌وقتِ `toISOString` کد و فرایند سرور (`processTimezone`)؛
// پیش‌تر `defaultNow()` و مقایسه با `now()` در نصبی با پایگاه‌داده به وقت تهران ۳٫۵ ساعت جابه‌جا بودند.
export const SESSION_STARTUP_OPTIONS =
  `-c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${idleInTxTimeoutMs} -c TimeZone=UTC`;

const isSsl = rawDbUrl.includes('sslmode=require') || 
              rawDbUrl.includes('neon.tech') || 
              rawDbUrl.includes('supabase.co');

const caPath = process.env.POSTGRES_SSL_CA_PATH;
const sslConfig = isSsl ? {
  rejectUnauthorized: true,
  ca: (caPath && fs.existsSync(caPath)) ? fs.readFileSync(caPath, 'utf8') : undefined,
} : undefined;

if (databaseMode.kind === 'sql_host' || databaseMode.kind === 'url') {
  if (databaseMode.kind === 'sql_host') {
    realPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl: (process.env.SQL_SSL === 'true' || process.env.POSTGRES_SSL === 'true') ? sslConfig : undefined,
      options: SESSION_STARTUP_OPTIONS,
      Client: ServerTimestampClient,
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
      options: SESSION_STARTUP_OPTIONS,
      Client: ServerTimestampClient,
      max: maxPoolSize,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: false,
    });
  }

  if (/[?&]options=/.test(rawDbUrl)) {
    logger.warn({ message: '[PostgreSQL Pool] DATABASE_URL has its own "options" parameter; session timeouts (DB_STATEMENT_TIMEOUT / DB_IDLE_IN_TX_TIMEOUT) and TimeZone=UTC must be included in it.' });
  }

  realPool.on('connect', (client: pkg.PoolClient) => {
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
}

/** The pool of a refused configuration: every query fails with the reason, so nothing runs on a missing database */
function refusedPool(reason: string): pkg.Pool {
  const fail = () => Promise.reject(new Error(reason));
  const target = {
    query: fail, connect: fail, end: () => Promise.resolve(),
    on: () => target, once: () => target, removeListener: () => target,
    totalCount: 0, idleCount: 0, waitingCount: 0,
  };
  Object.setPrototypeOf(target, Pool.prototype);
  return target as unknown as pkg.Pool;
}

const activeTarget: pkg.Pool = realPool ?? refusedPool(databaseMode.kind === 'refused' ? databaseMode.reason : 'no database');

const pool: pkg.Pool = new Proxy(activeTarget, {
  get: (_target, prop: string | symbol) => {
    const val = (activeTarget as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(activeTarget) : val;
  }
});

/** v9.0.428 (TD-616): the database mode the process started with (`refused` carries the reason the server stops on) */
export function getDatabaseMode(): DatabaseMode {
  return databaseMode;
}

const orm = drizzle(pool, { schema });

export type AppDatabase = typeof orm;
export type DbTransaction = Parameters<Parameters<typeof orm.transaction>[0]>[0];
export type DbExecutor = AppDatabase | DbTransaction;

/** Statement timeout of a bulk task (5 minutes) */
export const LONG_STATEMENT_TIMEOUT_MS = 300_000;

/**
 * v9.0.188 (TD-615): extends `statement_timeout` for the rest of this transaction only (`SET LOCAL`), on the
 * transaction's own connection. The old `withLongQueryTimeout(fn)` set it on a separate pool connection that the
 * callback never used (its `orm` and `orm.transaction` still had the 1-minute limit) and held that connection idle.
 */
export async function extendStatementTimeout(tx: DbTransaction, timeoutMs: number = LONG_STATEMENT_TIMEOUT_MS): Promise<void> {
  const ms = Math.max(0, Math.floor(Number(timeoutMs) || 0));
  await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${ms}`));
}

/**
 * 10.2 package 11 part 2d review (TD-1324): raises `work_mem` for the rest of this transaction only (`SET LOCAL`), on the
 * transaction's own connection, like `extendStatementTimeout`. A bitmap scan of a GIN index that matches many rows turns
 * lossy at the default 4 MB and rechecks every row of the pages it kept.
 */
export async function raiseWorkMem(tx: DbTransaction, megabytes: number): Promise<void> {
  const mb = Math.max(1, Math.floor(Number(megabytes) || 0));
  await tx.execute(sql.raw(`SET LOCAL work_mem = '${mb}MB'`));
}

export { pool, orm };
