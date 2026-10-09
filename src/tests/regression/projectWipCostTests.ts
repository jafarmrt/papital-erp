import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * Series 10 phase 3, lane L3 (package 11): project work-in-progress (1402) under decision t4 b of phase 5 (labour is a
 * period expense, the delivery price is materials only). Through the real Express routes; each case is red on the code
 * before its fix.
 */
export async function runProjectWipCostTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_delete_refused_with_wip_or_documents_td_922',
      'v10.0.24: a project with a live document or a work-in-progress balance is not deleted (409 PROJECT_HAS_LEDGER_ITEMS); once the document is voided it is (TD-922)',
      ['td922', 'p5-m07', 'projects', 'delete', 'package11'], deleteGuardCase],
  ]);
}

async function newProject(h: Harness, label: string): Promise<number> {
  const res = await h.post('/api/projects', { title: `P3 wip ${label} ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  return Number((res.body as { id?: unknown }).id);
}

/** A final remittance of `qty` units at the item's average cost, optionally on a project; returns the document id */
async function remittance(h: Harness, f: Awaited<ReturnType<typeof fixture>>, itemId: number, qty: number, projectId?: number): Promise<number> {
  const res = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId, quantity: qty, unit_price: 0, location: f.wh }], projectId ? { projectId } : {}));
  const id = Number((res.body as { docId?: unknown })?.docId);
  if (res.status !== 200 || !Number.isInteger(id)) throw new Error(`setup: the remittance answered ${brief(res)}`);
  return id;
}

/** P5-M07 (TD-922): the delete guard saw only open allocations, so the 1402 balance stayed on a deleted project */
async function deleteGuardCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(10, 1_000);
  const projectId = await newProject(h, 'delete');
  const docId = await remittance(h, f, material, 3, projectId);
  const refused = await h.del(`/api/projects/${projectId}`);
  const body = refused.body as { code?: unknown; message?: unknown };
  if (refused.status !== 409 || body.code !== 'PROJECT_HAS_LEDGER_ITEMS') wrong.push(`deleting a project with a remittance and a 1402 balance answered ${brief(refused)}, expected 409 PROJECT_HAS_LEDGER_ITEMS`);
  const [alive] = await h.q('SELECT is_deleted FROM production_projects WHERE id = $1', [projectId]);
  if (Number(alive?.is_deleted) !== 0) wrong.push('the refused delete still deleted the project');
  const voided = await h.del(`/api/documents/${docId}`);
  if (voided.status !== 200) throw new Error(`setup: voiding the remittance answered ${brief(voided)}`);
  const deleted = await h.del(`/api/projects/${projectId}`);
  if (deleted.status !== 200) wrong.push(`deleting the project after the void answered ${brief(deleted)}, expected 200`);
  return 'a project with a live document or a 1402 balance is refused; after the void it is deleted';
}
