// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const CI_YML = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** Each job of ci.yml as its name and the text of its block (two-space indented keys under `jobs:`). */
function ciJobs(): { name: string; body: string }[] {
  const jobsText = CI_YML.slice(CI_YML.indexOf('\njobs:') + 1);
  const starts = [...jobsText.matchAll(/^ {2}([\w-]+):\s*$/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    body: jobsText.slice(m.index ?? 0, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

/** v10.0.152 (I-06): no CI job may hang until GitHub's 360-minute default. */
describe('ci_job_timeouts_ot_b_05: every CI job has its own time limit (OT-B-05)', () => {
  it('every job sets timeout-minutes of at most 60', () => {
    const jobs = ciJobs();
    expect(jobs.length).toBeGreaterThan(5);
    const missing = jobs.filter(j => !/^ {4}timeout-minutes:\s*\d+/m.test(j.body)).map(j => j.name);
    expect(missing).toEqual([]);
    const tooLong = jobs.filter(j => Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(j.body)?.[1]) > 60).map(j => j.name);
    expect(tooLong).toEqual([]);
  });

  it('the e2e job caches the Playwright browser and never installs it without a limit', () => {
    const e2e = ciJobs().find(j => j.name === 'e2e');
    expect(e2e).toBeDefined();
    const body = e2e?.body ?? '';
    expect(body).toMatch(/path:\s*~\/\.cache\/ms-playwright/);
    expect(body).toMatch(/key:\s*playwright-.*hashFiles\('package-lock\.json'\)/);
    const installSteps = body.split(/\n {6}- /).filter(s => /npx playwright install/.test(s));
    expect(installSteps.length).toBeGreaterThan(0);
    expect(installSteps.filter(s => !/timeout-minutes:\s*\d+/.test(s))).toEqual([]);
  });
});

describe('ci_shellcheck_gate_obs_r1_19: shell scripts pass shellcheck in CI (OBS-R1-19)', () => {
  it('the lint job runs shellcheck at error level over every tracked shell script', () => {
    const lint = ciJobs().find(j => j.name === 'lint-and-typecheck');
    expect(lint?.body ?? '').toMatch(/git ls-files -z '\*\.sh' \| xargs -0 shellcheck --severity=error/);
  });
});

/** v10.0.152 (I-06, OBS-R1-19, product-owner decision): the coverage gate fails below its floors. */
describe('ci_coverage_thresholds_obs_r1_19: the coverage gate has floors (OBS-R1-19)', () => {
  it('test:coverage runs c8 with --check-coverage and a positive floor for each metric', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:coverage'] ?? '';
    expect(script).toMatch(/^c8 .*--check-coverage/);
    const floors = Object.fromEntries(
      ['lines', 'statements', 'functions', 'branches'].map(k => [k, Number(new RegExp(`--${k} (\\d+)`).exec(script)?.[1] ?? 0)]),
    );
    expect(floors).toEqual({ lines: 90, statements: 90, functions: 88, branches: 73 });
    const coverageJob = ciJobs().find(j => /npm run test:coverage/.test(j.body));
    expect(coverageJob).toBeDefined();
  });
});
