// @vitest-environment node
/**
 * v10.0.192 (TD-1260, product-owner decision t20): the CI check jobs start at once. A PR result used to wait for the
 * sum of a chain (lint, then the database tests, then build, then the Docker build, about 17 minutes); now it waits
 * for the longest job only. Every job still runs and has to pass: only the image push waits,
 * and it waits for every check job (the empty staging jobs were removed in v10.1.65, OBS-R1-19). The database jobs start the runner's own PostgreSQL 16 instead of pulling an
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

  it('the image push waits for every test job', () => {
    const jobs = ciJobs();
    const testJobs = ['lint-and-typecheck', 'test', 'coverage-gate', 'e2e', 'build'];
    for (const name of ['docker-publish']) {
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
    expect(script).toMatch(/SHOW server_version_num/);
    // v11 (TD-1355): the 26.04 image has no PostgreSQL 16; it comes from the PostgreSQL apt repository, and only its
    // cluster is left on 5432 so pg_dump and pg_restore are version 16 too
    expect(script).toMatch(/apt\.postgresql\.org\/pub\/repos\/apt \$\{codename\}-pgdg/);
    expect(script).toMatch(/apt-get install -y -qq postgresql-16 postgresql-client-16/);
    expect(script).toMatch(/pg_dropcluster --stop/);
    expect(script).toMatch(/pg_conftool 16 "\$cluster16" set port 5432/);
    for (const name of ['test', 'coverage-gate']) {
      expect(jobs.get(name) ?? '', name).toMatch(/pg_dump --version \| grep -qE ' 16\\\.' \|\| \{/);
    }
  });

  it('every job runs on Ubuntu 26.04, never on a moving or older label (TD-1355)', () => {
    const workflows = ['ci.yml', 'delete-merged-branches.yml'];
    for (const file of workflows) {
      const text = fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8');
      const labels = [...text.matchAll(/^\s+runs-on:\s*(\S+)\s*$/gm)].map(m => m[1]);
      expect(labels.length, file).toBeGreaterThan(0);
      expect(labels.filter(label => label !== 'ubuntu-26.04'), file).toEqual([]);
    }
    expect([...ciJobs().keys()].filter(name => !/^ {4}runs-on: ubuntu-26\.04$/m.test(ciJobs().get(name) ?? ''))).toEqual([]);
  });

  it('Playwright knows Ubuntu 26.04 (1.61 or newer) so the e2e job installs its browser libraries there', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    const [major, minor] = pkg.devDependencies['@playwright/test'].replace(/^[^\d]*/, '').split('.').map(Number);
    expect(major > 1 || (major === 1 && minor >= 61)).toBe(true);
  });
});
