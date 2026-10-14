import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PERF_ENDPOINTS, PERF_TARGET_P95_MS, evaluate, percentile, renderPerfReport, summarize,
} from '../../../scripts/perf/perfBaseline';
import { PAGE_ACCESS } from '../../lib/permissions/pageAccess';

// v10.0.262 (I-04): the performance baseline's percentile, target verdict and report.
describe('perf_baseline_i04', () => {
  it('takes the nearest-rank percentile', () => {
    const samples = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(samples, 50)).toBe(5);
    expect(percentile(samples, 95)).toBe(10);
    expect(percentile(samples, 0)).toBe(1);
    expect(percentile([], 95)).toBe(0);
  });

  it('summarizes samples rounded to a tenth of a millisecond', () => {
    expect(summarize([1.04, 2.06, 3])).toEqual({ count: 3, minMs: 1, p50Ms: 2.1, p95Ms: 3, maxMs: 3, meanMs: 2 });
    expect(summarize([]).count).toBe(0);
  });

  it('never counts a failing API as within its target', () => {
    const endpoint = PERF_ENDPOINTS[0];
    const fast = summarize([1, 1, 1]);
    const [ok, failed, slow] = evaluate([
      { endpoint, failedStatuses: [], summary: fast },
      { endpoint, failedStatuses: [500], summary: fast },
      { endpoint, failedStatuses: [], summary: summarize([endpoint.targetP95Ms + 1]) },
    ]);
    expect([ok.withinTarget, failed.withinTarget, slow.withinTarget]).toEqual([true, false, false]);
  });

  it('gives every endpoint its kind target and unique path', () => {
    for (const e of PERF_ENDPOINTS) expect(e.targetP95Ms).toBe(PERF_TARGET_P95_MS[e.kind]);
    expect(new Set(PERF_ENDPOINTS.map(e => e.path)).size).toBe(PERF_ENDPOINTS.length);
  });

  it('measures only APIs that a page names as its main API, or the top bar every page shows', () => {
    const named = new Set(Object.values(PAGE_ACCESS).flatMap(p => [...((p as { api?: readonly string[] }).api ?? [])]).map(a => a.replace(/^GET /, '')));
    const pathsOnly = PERF_ENDPOINTS.filter(e => e.kind !== 'shell').map(e => e.path.split('?')[0]);
    const unknown = pathsOnly.filter(p => !named.has(p));
    expect(unknown).toEqual([]);
  });

  it('reports breaches and a missing pg_stat_statements in the Markdown report', () => {
    const endpoint = PERF_ENDPOINTS[0];
    const verdicts = evaluate([{ endpoint, failedStatuses: [403], summary: summarize([3]) }]);
    const report = renderPerfReport({
      generatedAt: '2026-10-11T00:00:00.000Z', version: '10.0.0', steps: 10, activityLogRows: 5,
      tableRows: { documents: 3 }, verdicts, topStatements: null,
    });
    expect(report).toContain('| documents | 3 |');
    expect(report).toContain('خطا (403)');
    expect(report).toContain('1 API از هدف خود بیشتر است یا خطا داد.');
    expect(report).toContain('pg_stat_statements');
  });

  it('is run by an npm script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
    expect(pkg.scripts['perf:baseline']).toBe('tsx scripts/perf-baseline.ts');
  });
});
