import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { DATABASE_NOT_CONFIGURED } from '../../db/databaseMode.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, runCase } from './fiscalClosingTests.js';

/**
 * v9.0.397 (TD-616, B01-36, decision t4 «الف»): which database a process uses. On v9.0.396 `SQL_HOST` alone ended in the
 * in-memory demo database (the SQL_HOST branch ran only with a real DATABASE_URL too), and a server without DATABASE_URL
 * outside production started that demo database with admin / admin by itself. Each case runs in its own process with
 * only the variables it names, so `.env` (which never overrides a variable already set, even empty) plays no part.
 */

const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

function databaseEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: '', SQL_HOST: '', SQL_USER: '', SQL_PASSWORD: '', SQL_DB_NAME: '', ERP_DEMO_MODE: '', ...overrides };
}

/** The mode a fresh process starts with and whether a query reaches PostgreSQL */
function probeMode(overrides: Record<string, string>): { kind?: string; mock?: boolean; version?: string; error?: string; raw: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-db-mode-'));
  const script = path.join(dir, 'probe.mts');
  const drizzleModule = path.join(process.cwd(), 'src', 'db', 'drizzle.ts');
  fs.writeFileSync(script, `
const db = await import(${JSON.stringify(drizzleModule)});
const out: Record<string, unknown> = { kind: typeof db.getDatabaseMode === 'function' ? db.getDatabaseMode().kind : 'unknown', mock: db.isMockDatabase() };
try { out.version = String((await db.pool.query('SELECT version() AS v')).rows[0]?.v ?? ''); } catch (err) { out.error = err instanceof Error ? err.message : String(err); }
process.stdout.write('PROBE ' + JSON.stringify(out) + '\\n');
process.exit(0);
`);
  try {
    const child = spawnSync(tsxBin, [script], { cwd: dir, env: databaseEnv(overrides), encoding: 'utf-8', timeout: 60_000 });
    const raw = `${child.stdout || ''}${child.stderr || ''}`;
    const line = raw.split('\n').find(l => l.startsWith('PROBE '));
    return line ? { ...JSON.parse(line.slice(6)), raw } : { raw };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sqlHostParts(): Record<string, string> {
  const url = new URL(String(process.env.DATABASE_URL));
  return {
    SQL_HOST: url.hostname,
    SQL_USER: decodeURIComponent(url.username),
    SQL_PASSWORD: decodeURIComponent(url.password),
    SQL_DB_NAME: url.pathname.replace(/^\//, ''),
  };
}

async function scenario(): Promise<string> {
  const problems: string[] = [];

  const sqlHost = probeMode(sqlHostParts());
  if (sqlHost.kind !== 'sql_host' || sqlHost.mock || !sqlHost.version?.includes('PostgreSQL')) {
    problems.push(`SQL_HOST alone did not reach PostgreSQL: ${JSON.stringify({ ...sqlHost, raw: sqlHost.raw.slice(-300) })}`);
  }

  const url = probeMode({ DATABASE_URL: String(process.env.DATABASE_URL) });
  if (url.kind !== 'url' || url.mock || !url.version?.includes('PostgreSQL')) problems.push(`DATABASE_URL did not reach PostgreSQL: ${JSON.stringify(url.kind)}`);

  for (const nodeEnv of ['development', 'test', '']) {
    const missing = probeMode({ NODE_ENV: nodeEnv });
    if (missing.kind !== 'refused' || missing.mock || missing.version) {
      problems.push(`without DATABASE_URL (NODE_ENV "${nodeEnv}") the process got ${JSON.stringify({ kind: missing.kind, mock: missing.mock, version: missing.version })}`);
    } else if (missing.error !== DATABASE_NOT_CONFIGURED) {
      problems.push(`a query without DATABASE_URL failed with another reason: ${missing.error}`);
    }
  }

  const placeholder = probeMode({ DATABASE_URL: 'postgresql://user:password@host:5432/dbname', NODE_ENV: 'development' });
  if (placeholder.kind !== 'refused') problems.push(`the example DATABASE_URL was accepted as ${placeholder.kind}`);

  const demo = probeMode({ ERP_DEMO_MODE: '1', NODE_ENV: 'development' });
  if (demo.kind !== 'demo' || demo.mock !== true) problems.push(`ERP_DEMO_MODE=1 did not start the demo database: ${JSON.stringify({ kind: demo.kind, mock: demo.mock })}`);

  const demoProd = probeMode({ ERP_DEMO_MODE: '1', NODE_ENV: 'production' });
  if (demoProd.kind !== 'refused' || demoProd.mock) problems.push(`ERP_DEMO_MODE=1 in production got ${JSON.stringify({ kind: demoProd.kind, mock: demoProd.mock })}`);

  // the server itself refuses to start without a database, before it listens
  const server = spawnSync(tsxBin, ['server.ts'], {
    cwd: process.cwd(), env: databaseEnv({ NODE_ENV: 'development', PORT: '0' }), encoding: 'utf-8', timeout: 90_000,
  });
  const serverOut = `${server.stdout || ''}${server.stderr || ''}`;
  if (server.status !== 1 || !serverOut.includes(DATABASE_NOT_CONFIGURED)) {
    problems.push(`server.ts without DATABASE_URL: ${JSON.stringify({ status: server.status, signal: server.signal, tail: serverOut.slice(-400) })}`);
  }

  assertNoProblems(problems);
  return 'SQL_HOST and DATABASE_URL reach PostgreSQL; without them the process is refused (queries fail with the reason, the server exits 1) unless ERP_DEMO_MODE=1 outside production';
}

export async function runDatabaseModeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_database_mode_td_616';
  if (shouldRun(id, 'TD-616', 'B01-36')) {
    await runCase(results, id, 'v9.0.397: SQL_HOST reaches PostgreSQL and without a database the server refuses to start unless ERP_DEMO_MODE=1 outside production (TD-616)', scenario);
  }
  return results;
}
