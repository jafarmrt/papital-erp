import { isPlaceholderDatabaseUrl } from '../db/databaseMode.js';
import { SECRETS_KEY_MIN_LENGTH } from '../lib/secretBox.js';

/**
 * 10.3 package 3 (ARCH review, finding 5): the settings every suite of `scripts/run-tests.ts` needs. Without them dozens of
 * cases used to fail one by one with misleading reasons ("Invalid URL", the Persian missing-key message, "no PostgreSQL
 * user name"); the runner now names what is missing and stops before it writes a schema or a row.
 * `source scripts/ci-test-env.sh` sets the values CI uses.
 */
export type RunnerEnv = Partial<Record<'DATABASE_URL' | 'ERP_SECRETS_KEY' | 'SQL_HOST' | 'SQL_USER' | 'SQL_DB_NAME', string | undefined>>;

export function runnerSettingProblems(env: RunnerEnv): string[] {
  const problems: string[] = [];
  const raw = (env.DATABASE_URL ?? '').trim();
  if ((env.SQL_HOST ?? '').trim()) {
    // the SQL_HOST mode the server and assertRealTestDatabase accept (src/db/databaseMode.ts) wins over DATABASE_URL
    if (!(env.SQL_USER ?? '').trim()) problems.push('SQL_HOST is set without SQL_USER');
    if (!(env.SQL_DB_NAME ?? '').trim()) problems.push('SQL_HOST is set without SQL_DB_NAME');
  } else if (isPlaceholderDatabaseUrl(raw)) {
    problems.push('DATABASE_URL is not set (or is the example placeholder): set it to a real PostgreSQL test database, e.g. postgresql://<user>:<password>@localhost:5432/erp_test');
  } else {
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      problems.push('DATABASE_URL is not a URL: write it as postgresql://<user>:<password>@<host>:<port>/<database>');
    }
    if (url) {
      if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') problems.push(`DATABASE_URL must start with postgresql:// (it starts with ${url.protocol}//)`);
      if (!url.username) problems.push('DATABASE_URL has no user name: write it as postgresql://<user>:<password>@<host>:<port>/<database>');
      if (!url.pathname.replace(/^\//, '')) problems.push('DATABASE_URL names no database: add /<database> at its end');
    }
  }
  if ((env.ERP_SECRETS_KEY ?? '').trim().length < SECRETS_KEY_MIN_LENGTH) {
    problems.push(`ERP_SECRETS_KEY is missing or shorter than ${SECRETS_KEY_MIN_LENGTH} characters: the settings, messenger and webhook tests encrypt with it`);
  }
  return problems;
}

/** The terminal text of a failed preflight (English, AGENTS.md rule t9) */
export function runnerPreflightMessage(problems: string[]): string {
  return [
    'The test runner cannot start: required settings are missing.',
    ...problems.map(p => `  - ${p}`),
    'Set them in the environment or in .env, or run `source scripts/ci-test-env.sh` for the values CI uses (it expects PostgreSQL on localhost:5432).',
  ].join('\n');
}
