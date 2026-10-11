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
      'v10.0.172: a project with a live document or a work-in-progress balance is not deleted (409 PROJECT_HAS_LEDGER_ITEMS); once the document is voided it is (TD-922)',
      ['td922', 'p5-m07', 'projects', 'delete', 'package11'], deleteGuardCase],
    ['reg_closed_project_wip_listed_td_919',
      'v10.0.173: the financial health check lists the work-in-progress balance of a completed or deleted project and not of an open one (TD-919)',
      ['td919', 'p5-m03', 'projects', 'health', 'package11'], closedProjectWipCase],
    ['reg_remittance_without_project_not_wip_td_948',
      'v10.0.175: a remittance without a project debits the unassigned consumption account (6003), never work in progress; a project remittance still debits 1402 with the project detail (TD-948)',
      ['td948', 'p5-m15', 'projects', 'vouchers', 'package11'], remittanceWithoutProjectCase],
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

/** Debit rows of the document's live voucher: account code, detailed type and id */
async function voucherDebits(h: Harness, documentId: number) {
  return h.q(`SELECT a.code, i.detailed_type, i.detailed_id, i.debit::float8 AS debit
    FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
    WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.debit > 0`, [documentId]);
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

/** P5-M03 (TD-919): a closed project's 1402 balance was listed nowhere (invariant I3 leaves 1402 out) */
async function closedProjectWipCase(h: Harness, wrong: string[]): Promise<string> {
  const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const open = await newProject(h, 'open');
  const completed = await newProject(h, 'completed');
  await remittance(h, f, material, 2, open);
  await remittance(h, f, material, 3, completed);
  // a completed project (the matrix and delivery rules are not under test here)
  await h.q(`UPDATE production_projects SET status = 'completed' WHERE id = $1`, [completed]);
  const report = await FinancialHealthService.runHealthCheck();
  const test = report.tests.find(t => t.id === 'project_wip_closed_balance');
  if (!test) {
    wrong.push('the financial health check has no project_wip_closed_balance check');
    return 'no check';
  }
  const items = test.items ?? [];
  const row = items.find(i => Number(i.id) === completed);
  if (!row || !String(row.details).includes('۳٬۰۰۰')) wrong.push(`the completed project is listed as ${JSON.stringify(row ?? null)}, expected its 3000 balance`);
  if (items.some(i => Number(i.id) === open)) wrong.push('the open project with a 1402 balance is listed');
  return 'the completed project is listed with its 1402 balance; the open one is not';
}

/** P5-M15 (TD-948): a remittance without a project debited 1402 «other», which no production receipt ever credits */
async function remittanceWithoutProjectCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(10, 1_000);
  const plain = await voucherDebits(h, await remittance(h, f, material, 2));
  if (plain.length !== 1 || plain[0].code !== '6003') wrong.push(`the remittance without a project debits ${JSON.stringify(plain)}, expected one row on 6003`);
  const projectId = await newProject(h, 'remit');
  const onProject = await voucherDebits(h, await remittance(h, f, material, 1, projectId));
  if (onProject.length !== 1 || onProject[0].code !== '1402' || onProject[0].detailed_type !== 'project' || Number(onProject[0].detailed_id) !== projectId) {
    wrong.push(`the project remittance debits ${JSON.stringify(onProject)}, expected 1402 with the project detail`);
  }
  return 'a remittance without a project debits 6003; a project remittance debits 1402 on the project';
}
