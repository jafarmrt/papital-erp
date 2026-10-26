/**
 * v9.0.428 (TD-616, B01-36, decision t4 «الف»): which database the process uses, decided once from the environment.
 *
 * - `sql_host`: `SQL_HOST` with `SQL_USER` / `SQL_PASSWORD` / `SQL_DB_NAME` (Cloud SQL style). On v9.0.427 this branch
 *   ran only when DATABASE_URL was also a real URL, so `SQL_*` alone always ended in the in-memory database.
 * - `url`: a real `DATABASE_URL` (not empty, not the example placeholder).
 * - `refused`: anything else; the server does not start and every query fails with `reason`.
 *
 * v11 (phase 4.1): the in-memory demo database (`mockPool`, `ERP_DEMO_MODE=1`) was removed; a leftover
 * `ERP_DEMO_MODE=1` without a database is refused with a reason that says so.
 */
export type DatabaseMode =
  | { kind: 'sql_host' }
  | { kind: 'url'; url: string }
  | { kind: 'refused'; reason: string };

export type DatabaseModeEnv = Partial<Record<'SQL_HOST' | 'DATABASE_URL' | 'ERP_DEMO_MODE' | 'NODE_ENV', string | undefined>>;

/** The example value of `.env.example` and old templates, which is not a database */
export function isPlaceholderDatabaseUrl(url: string): boolean {
  return !url ||
    url.includes('@host:') ||
    url.includes('user:password@host') ||
    url === 'postgresql://user:password@host:5432/dbname';
}

export const DATABASE_NOT_CONFIGURED =
  'DATABASE_URL is not set (or is the example placeholder): set DATABASE_URL to the PostgreSQL database, or SQL_HOST with SQL_USER, SQL_PASSWORD and SQL_DB_NAME. The application runs only on PostgreSQL.';

export const DEMO_MODE_REMOVED =
  'ERP_DEMO_MODE=1 no longer starts anything: the in-memory demo database was removed in v11. Set DATABASE_URL to the PostgreSQL database and remove ERP_DEMO_MODE from .env.';

export function resolveDatabaseMode(env: DatabaseModeEnv): DatabaseMode {
  if ((env.SQL_HOST ?? '').trim()) return { kind: 'sql_host' };
  const url = (env.DATABASE_URL ?? '').trim();
  if (!isPlaceholderDatabaseUrl(url)) return { kind: 'url', url };
  if ((env.ERP_DEMO_MODE ?? '').trim() === '1') return { kind: 'refused', reason: DEMO_MODE_REMOVED };
  return { kind: 'refused', reason: DATABASE_NOT_CONFIGURED };
}
