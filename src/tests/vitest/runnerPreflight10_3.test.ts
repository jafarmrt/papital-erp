// @vitest-environment node
/**
 * 10.3 package 3 (ARCH review finding 5): `scripts/run-tests.ts` names the missing settings and stops before it writes a
 * schema, instead of dozens of cases failing with misleading reasons.
 */
import { describe, expect, it } from 'vitest';
import { runnerPreflightMessage, runnerSettingProblems } from '../runnerPreflight';

const KEY = 'test-secrets-key-at-least-32-characters-long-1234';

describe('runner_preflight_10_3', () => {
  it('passes the settings CI uses', () => {
    expect(runnerSettingProblems({ DATABASE_URL: 'postgresql://postgres:test@localhost:5432/erp_test', ERP_SECRETS_KEY: KEY })).toEqual([]);
    expect(runnerSettingProblems({ DATABASE_URL: ' postgres://u:p@db:5433/x ', ERP_SECRETS_KEY: KEY })).toEqual([]);
  });

  it('accepts the SQL_HOST mode the server accepts, with its user and database', () => {
    expect(runnerSettingProblems({ SQL_HOST: 'db.internal', SQL_USER: 'erp', SQL_DB_NAME: 'erp_test', ERP_SECRETS_KEY: KEY })).toEqual([]);
    expect(runnerSettingProblems({ SQL_HOST: 'db.internal', ERP_SECRETS_KEY: KEY })).toEqual(['SQL_HOST is set without SQL_USER', 'SQL_HOST is set without SQL_DB_NAME']);
  });

  it('names a missing, placeholder or unusable DATABASE_URL', () => {
    expect(runnerSettingProblems({ ERP_SECRETS_KEY: KEY })[0]).toMatch(/^DATABASE_URL is not set/);
    expect(runnerSettingProblems({ DATABASE_URL: 'postgresql://user:password@host:5432/dbname', ERP_SECRETS_KEY: KEY })[0]).toMatch(/^DATABASE_URL is not set/);
    expect(runnerSettingProblems({ DATABASE_URL: 'localhost:5432', ERP_SECRETS_KEY: KEY })[0]).toMatch(/must start with postgresql/);
    expect(runnerSettingProblems({ DATABASE_URL: 'not a url', ERP_SECRETS_KEY: KEY })[0]).toMatch(/^DATABASE_URL is not a URL/);
    expect(runnerSettingProblems({ DATABASE_URL: 'postgresql://localhost:5432/erp_test', ERP_SECRETS_KEY: KEY })[0]).toMatch(/no user name/);
    expect(runnerSettingProblems({ DATABASE_URL: 'postgresql://u:p@localhost:5432', ERP_SECRETS_KEY: KEY })[0]).toMatch(/names no database/);
  });

  it('names a missing or short ERP_SECRETS_KEY, and every problem at once', () => {
    const problems = runnerSettingProblems({ ERP_SECRETS_KEY: 'short' });
    expect(problems).toHaveLength(2);
    expect(problems[1]).toMatch(/^ERP_SECRETS_KEY is missing or shorter than 32/);
    const message = runnerPreflightMessage(problems);
    expect(message).toContain('scripts/ci-test-env.sh');
    expect(message).not.toMatch(/[؀-ۿ]/);
  });
});
