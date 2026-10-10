import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, draftSalesDocument, type Harness, type Row, type ShouldRun } from '../security/workflowTestHarness.js';

/**
 * Phase 3 lane L2, fresh-eyes guide test (roles-a): after the warehouse keeper rejects a sales proforma it is a draft
 * (TD-1137), and the seller must still find it in the open proformas box of the invoice page with an edit action. Through
 * the real routes; fails on v10.0.95, where the box asked only for proformas.
 */
export async function runOpenProformasTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_rejected_proforma_open_box_td_1197';
  if (!shouldRun(id, 'td1197', 'proforma', 'workflow')) return results;
  const name = 'v10.0.96: a rejected sales proforma, back to draft, stays in the open proformas box marked rejected (TD-1197)';
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    const details = await rejectedProformaCase(h, wrong);
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
  return results;
}

async function instanceOf(h: Harness, docId: number): Promise<number> {
  const [row] = await h.q(`SELECT id FROM workflow_instances WHERE entity_type = 'document' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(docId)]);
  if (row?.id) return Number(row.id);
  const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
  const started = await WorkflowTransitionExecutor.startInstance({
    workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: String(docId), userName: 'td1197',
  });
  if (!started) throw new Error('setup: the document approval workflow did not start');
  return Number(started.id);
}

async function rejectedProformaCase(h: Harness, wrong: string[]): Promise<string> {
  const { openProformasUrl } = await import('../../lib/invoices/openProformas.js');
  const rejectedId = await draftSalesDocument(h, 'proforma');
  const statuses = await h.walk(await instanceOf(h, rejectedId), ['submit_to_warehouse', 'reject'], h.admin);
  if (statuses.some(s => s >= 300)) throw new Error(`setup: send and reject answered ${statuses.join(', ')}`);
  const [doc] = await h.q(`SELECT status FROM documents WHERE id = $1`, [rejectedId]);
  if (doc?.status !== 'draft') throw new Error(`setup: the rejected proforma is "${String(doc?.status)}", expected draft (TD-1137)`);
  const draftId = await draftSalesDocument(h, 'draft');
  const proformaId = await draftSalesDocument(h, 'proforma');

  const rows: Row[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await h.get(`/api${openProformasUrl(page)}`);
    if (res.status !== 200) throw new Error(`the open proformas list answered ${res.status}`);
    const data = ((res.body as Row).data ?? []) as Row[];
    rows.push(...data);
    if (data.length === 0 || rows.length >= Number((res.body as Row).total ?? 0)) break;
  }
  const rowOf = (docId: number) => rows.find(r => Number(r.id) === docId);
  const rejected = rowOf(rejectedId);
  if (!rejected) wrong.push('the rejected proforma is missing from the open proformas box');
  else if (rejected.workflowRejected !== true) wrong.push(`the rejected proforma is not marked rejected (${String(rejected.workflowRejected)})`);
  const draft = rowOf(draftId);
  if (!draft) wrong.push('a sales draft is missing from the open proformas box');
  else if (draft.workflowRejected === true) wrong.push('a sales draft that was never rejected is marked rejected');
  if (!rowOf(proformaId)) wrong.push('a sales proforma is missing from the open proformas box');
  return 'rejected proforma listed and marked, sales draft and proforma listed';
}
