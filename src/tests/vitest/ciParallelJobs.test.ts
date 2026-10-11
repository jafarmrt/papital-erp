// @vitest-environment node
/**
 * v10.0.191 (TD-1260, product-owner decision t20): the CI check jobs start at once. A PR result used to wait for the
 * sum of a chain (lint, then the database tests, then build, then the Docker build, about 17 minutes); now it waits
 * for the longest job only. Every job still runs and has to pass: only the image push and the staging deploy wait,
 * and they wait for every check job. The database jobs start the runner's own PostgreSQL 16 instead of pulling an
 * image (an anonymous pull was refused with "toomanyrequests" and failed a master run before any test ran).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const CI_YML = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

function ciJobs(): Map<string, string> {
  const jobsText = CI_YML.slice(CI_YML.indexOf('\njobs:') + 1);
  const starts = [...jobsText.matchAll(/^ {2}([\w-]+):\s*$/gm)];
  return new Map(starts.map((m, i) => [
    m[1],
    jobsText.slice(m.index ?? 0, i + 1 < starts.length ? starts[i + 1].index : undefined),
  ]));
}

function needsOf(body: string): string[] {
  const m = /^ {4}needs:\s*(.+)$/m.exec(body);
  if (!m) return [];
  return m[1].replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

const CHECK_JOBS = ['lint-and-typecheck', 'test', 'coverage-gate', 'e2e', 'build', 'docker-gate'];
const DATABASE_JOBS: Array<[string, string]> = [['test', 'erp_test'], ['coverage-gate', 'erp_test'], ['e2e', 'erp_e2e']];

describe('ci_check_jobs_start_together_td_1260', () => {
  it('no check job waits for another check job', () => {
    const jobs = ciJobs();
    for (const name of CHECK_JOBS) expect(jobs.has(name), name).toBe(true);
    const waiting = CHECK_JOBS.filter(name => needsOf(jobs.get(name) ?? '').length > 0);
    expect(waiting).toEqual([]);
  });

  it('the image push and the staging deploy wait for every test job', () => {
    const jobs = ciJobs();
    const testJobs = ['lint-and-typecheck', 'test', 'coverage-gate', 'e2e', 'build'];
    for (const name of ['docker-publish', 'deploy-staging']) {
      const needs = needsOf(jobs.get(name) ?? '');
      expect(testJobs.filter(job => !needs.includes(job)), name).toEqual([]);
    }
    expect(jobs.get('docker-gate') ?? '').not.toMatch(/docker push/);
    expect(jobs.get('docker-publish') ?? '').toMatch(/docker push/);
  });

  it('the database jobs start the runner PostgreSQL and pull no service image', () => {
    const jobs = ciJobs();
    for (const [name, db] of DATABASE_JOBS) {
      const body = jobs.get(name) ?? '';
      expect(body, name).not.toMatch(/^ {4}services:/m);
      expect(body, name).toContain(`bash scripts/ci-start-postgres.sh ${db}`);
    }
    const script = fs.readFileSync(path.join(ROOT, 'scripts/ci-start-postgres.sh'), 'utf8');
    expect(script).toMatch(/systemctl start postgresql/);
    expect(script).toMatch(/SHOW server_version_num/);
  });
});
