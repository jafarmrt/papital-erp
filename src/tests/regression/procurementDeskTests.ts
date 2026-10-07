import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { PAGE_ACCESS } from '../../lib/permissions/pageAccess.js';

/**
 * Package 10 (purchasing and procurement), PR C: what the procurement desk reads, through the real Express routes with
 * real sessions. Each case reproduces a finding of the package 10 review and is red on the code before its fix.
 */
export async function runProcurementDeskTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_desk_reads_td_702',
      'v9.0.277: every API the procurement desk reads opens for each permission that opens the page (procurement.view, projects.view); the summary refused projects.view and emptied the desk (TD-702)',
      ['td702', 'procurement', 'permissions', 'security', 'package10'], deskReadsCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_api', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

/** v9.0.277 (TD-702, B10-15): a holder of either page key reads every desk API; a key that does not open the page reads none */
async function deskReadsCase(h: Harness, wrong: string[]): Promise<string> {
  const rule = PAGE_ACCESS['/procurement'];
  const keys = typeof rule.gate === 'object' ? rule.gate.anyOf : [];
  const reads = ['/api/procurement/inbox/summary', '/api/procurement/requisitions?page=1&limit=20', '/api/procurement/orders?page=1&limit=20'];
  if (!rule.api.includes('GET /api/procurement/inbox/summary')) wrong.push('the page access table does not list the desk summary among the desk APIs');
  for (const key of keys) {
    const session = await h.sessionWith([key]);
    for (const url of reads) {
      const res = await h.get(url, session);
      if (res.status !== 200) wrong.push(`${key}: GET ${url} answered ${res.status}`);
    }
  }
  const outsider = await h.sessionWith(['documents.view']);
  const summary = await h.get('/api/procurement/inbox/summary', outsider);
  if (summary.status !== 403) wrong.push(`documents.view (does not open the page): summary answered ${summary.status}`);
  return `${keys.join(' and ')} each read the summary, the requisitions and the orders; documents.view reads none`;
}
