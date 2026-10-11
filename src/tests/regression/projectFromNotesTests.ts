import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * v10.0.270 (OBS-R1-47, TD-985): a document's project comes only from `documents.project_id`. Before, the remittance,
 * waste and receipt vouchers read a project code out of the free-text notes («پروژه: <code>»), so a remittance
 * recorded without a project but noting a project code debited that project's work in progress (1402) although it
 * consumed no reservation and passed none of the project checks.
 */
export async function runProjectFromNotesTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_voucher_project_not_from_notes_obs_r1_47',
      'v10.0.270: a remittance without a project whose notes name a project code debits the unassigned consumption account (6003), not that project\'s work in progress (OBS-R1-47)',
      ['obs-r1-47', 'td985', 'vouchers', 'projects', 'accounting'], projectFromNotesCase],
  ]);
}

/** Test data: the notes prefix the old voucher code read a project code from */
const PROJECT_NOTE = 'پروژه: ';

async function projectFromNotesCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(10, 1_000);
  const created = await h.post('/api/projects', { title: `OBS-R1-47 ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (created.status !== 201) throw new Error(`setup: project create answered ${brief(created)}`);
  const projectId = Number((created.body as { id?: unknown }).id);
  const [project] = await h.q('SELECT project_code FROM production_projects WHERE id = $1', [projectId]);
  const code = String(project?.project_code ?? '');
  if (!code) throw new Error('setup: the project has no code');
  const res = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: material, quantity: 2, unit_price: 0, location: f.wh }], { notes: `${PROJECT_NOTE}${code}` }));
  const docId = Number((res.body as { docId?: unknown })?.docId);
  if (res.status !== 200 || !Number.isInteger(docId)) throw new Error(`setup: the remittance answered ${brief(res)}`);
  const debits = await h.q(`SELECT a.code, i.detailed_type, i.detailed_id
    FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
    WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.debit > 0`, [docId]);
  if (debits.length !== 1 || debits[0].code !== '6003' || debits[0].detailed_type === 'project') {
    wrong.push(`the remittance without a project whose notes name project ${code} debits ${JSON.stringify(debits)}, expected one row on 6003 without a project`);
  }
  return 'a project code in the notes no longer moves the remittance to the project\'s work in progress';
}
