import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, reservedOf, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * Series 10 phase 3, lane L3 (packages 11, 7, 8, 10), product-owner decision t10 of phase 5: a project finalized again
 * reserves only what it still needs, a sales invoice never consumes a project's reservation, and a project requisition's
 * procurement order carries the project. Through the real Express routes; each case is red on the code before its fix.
 */
export async function runProjectReservationIssueTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_refinalize_reserves_remaining_need_td_945',
      'v10.0.31: finalizing a project again reserves its need minus what its remittances and allocations already issued, never the whole need (TD-945)',
      ['td945', 'p5-m12', 'projects', 'reservation', 'package11'], refinalizeCase],
  ]);
}

async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

async function putProject(h: Harness, projectId: number, body: Record<string, unknown>) {
  const [row] = await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]);
  return h.put(`/api/projects/${projectId}`, { ...body, version: Number(row?.version) });
}

const storedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);

/** P5-M12 (TD-945): unfreezing and finalizing again reserved the whole need, the issued quantity a second time */
async function refinalizeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(20, 1_000);
  const inv = { sections: globalSection([await materialRow(h, a, 10)]), manualPurchaseItems: [], isFinalized: true };
  const project = await createProject(h, inv);
  if (await storedQty(h, project, a) !== 10) throw new Error(`setup: the finalized project reserves ${await storedQty(h, project, a)}, expected 10`);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 6, unit_price: 0, location: f.wh }], { projectId: project }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance of 6 answered ${brief(rem)}`);
  const unfreeze = await putProject(h, project, { inventory_control: { ...inv, isFinalized: false } });
  if (unfreeze.status !== 200) throw new Error(`setup: unfreeze answered ${brief(unfreeze)}`);
  const refreeze = await putProject(h, project, { inventory_control: inv });
  if (refreeze.status !== 200) throw new Error(`setup: finalizing again answered ${brief(refreeze)}`);
  const again = await storedQty(h, project, a);
  if (again !== 4) wrong.push(`finalizing again after a remittance of 6 of a need of 10 reserves ${again}, expected 4`);
  const view = await reservedOf(a);
  if (view.project !== 4) wrong.push(`the reservation report shows ${view.project} for the project, expected 4`);
  return 'a project finalized again reserves only its remaining need';
}
