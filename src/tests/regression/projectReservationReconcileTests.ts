import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture, type Fixture } from './documentEntryTests.js';
import { createProject, globalSection, reservedOf, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * TD-1341 (package 12 item 1, option ب of card t42): «تکمیل رزرو» brings a finalized project's reservation to today's
 * materials list without unfreezing it: the shortfall is reserved from stock nobody holds, the excess is released, the
 * project keeps what it already holds against later reservations, and only the changes the user saw are written. Through
 * the real Express routes on PostgreSQL; each case is red on the code before the change (the routes did not exist).
 */
export async function runProjectReservationReconcileTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_reservation_reconcile_reserves_and_releases_td_1341',
      'v10.2.x: the reservation reconcile reserves the shortfall from free stock after a receipt and releases the excess of a shrunk list, keeping a stored row that reaches no live item (TD-1341)',
      ['td1341', 'package12', 'projects', 'reservation'], reservesAndReleasesCase],
    ['reg_project_reservation_reconcile_first_come_td_1341',
      'v10.2.x: a sales proforma recorded after the finalize never shrinks the project\'s reservation through the reconcile; an unchanged plan writes nothing (TD-1341)',
      ['td1341', 'package12', 'projects', 'reservation'], firstComeCase],
    ['reg_project_reservation_reconcile_plan_token_td_1341',
      'v10.2.x: the reconcile writes only the previewed plan: a changed stock is 409 PROJECT_RESERVATION_PLAN_CHANGED with the fresh preview, a stale version 409 OCC_CONFLICT, an unfinalized project 422, nothing written (TD-1341)',
      ['td1341', 'package12', 'projects', 'reservation', 'occ'], planTokenCase],
    ['reg_project_reservation_reconcile_void_restores_td_1341',
      'v10.2.x: after a reconcile a remittance void restores what it deducted and the reconcile then finds nothing to change; nothing is reserved twice (TD-1341)',
      ['td1341', 'package12', 'projects', 'reservation', 'void'], voidRestoresCase],
    ['reg_project_reservation_reconcile_row_by_id_td_1341',
      'v10.2.x: after an item is recoded and renamed the reconcile finds its stored row by id and the old list row through the code and name the stored row keeps, so nothing is released (TD-1341, review M1)',
      ['td1341', 'td1322', 'package12', 'projects', 'reservation'], rowByIdCase],
    ['reg_project_reservation_reconcile_unmatched_row_td_1341',
      'v10.2.x: a list row that reaches no item (Persian yeh against an Arabic-yeh code) is listed in the preview and a plan that would release is 422 PROJECT_RESERVATION_ROWS_UNMATCHED with nothing written; a plan that only reserves is recorded (TD-1341, review M1)',
      ['td1341', 'package12', 'projects', 'reservation'], unmatchedRowCase],
    ['reg_project_reservation_report_trimmed_code_td_1341',
      'v10.2.x: the reservation report finds the item of a stored row without an item id whose item code starts with a no-break space, as the reconcile does, so both show the same reservation (TD-1341, review N1)',
      ['td1341', 'td1322', 'package12', 'projects', 'reservation'], trimmedCodeCase],
  ]);
}

interface Line { itemId: number; requiredQty: number; currentQty: number; targetQty: number; shortQty: number }
interface Unmatched { code: string; name: string; unit: string; qty: number; section?: string }
interface Preview { projectId: number; version: number; lines: Line[]; unmatchedRows: Unmatched[]; hasChanges: boolean; planToken: string }

async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

const versionOf = async (h: Harness, projectId: number) =>
  Number((await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]))[0]?.version);

const storedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);

async function preview(h: Harness, projectId: number): Promise<Preview> {
  const res = await h.get(`/api/projects/${projectId}/reservation-reconcile`);
  if (res.status !== 200) throw new Error(`the reconcile preview answered ${brief(res)}`);
  return res.body as Preview;
}

const apply = (h: Harness, projectId: number, body: Record<string, unknown>) => h.post(`/api/projects/${projectId}/reservation-reconcile`, body);

const lineOf = (p: Preview, itemId: number) => p.lines.find(l => l.itemId === itemId);

async function saveSections(h: Harness, projectId: number, rows: Array<Record<string, unknown>>) {
  const res = await h.put(`/api/projects/${projectId}`, {
    inventory_control: { sections: globalSection(rows), manualPurchaseItems: [], isFinalized: true }, version: await versionOf(h, projectId),
  });
  if (res.status !== 200) throw new Error(`setup: saving the finalized project's list answered ${brief(res)}`);
}

async function receipt(h: Harness, f: Fixture, itemId: number, quantity: number) {
  const res = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId, quantity, unit_price: 1_000, location: f.wh }]));
  if (res.status !== 200) throw new Error(`setup: a receipt of ${quantity} answered ${brief(res)}`);
}

async function proforma(h: Harness, f: Fixture, itemId: number, quantity: number) {
  const res = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId, quantity, unit_price: 5_000, location: f.wh }]));
  if (res.status !== 200) throw new Error(`setup: a sales proforma of ${quantity} answered ${brief(res)}`);
}

/** The shortfall after a receipt is reserved from free stock; the excess of a shrunk list is released */
async function reservesAndReleasesCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(3);
  const b = await f.item(10);
  const project = await createProject(h, {
    sections: globalSection([await materialRow(h, a, 10), await materialRow(h, b, 6)]), manualPurchaseItems: [], isFinalized: true,
  });
  if (await storedQty(h, project, a) !== 3 || await storedQty(h, project, b) !== 6) throw new Error('setup: the finalize did not reserve 3 and 6');
  await receipt(h, f, a, 9);
  await proforma(h, f, a, 1);
  await saveSections(h, project, [await materialRow(h, a, 10), await materialRow(h, b, 2)]);
  // a stored row that reaches no live item reserves nothing and is never dropped silently
  await h.q(`UPDATE production_projects SET inventory_control = jsonb_set(inventory_control, '{reservedItems}',
    (inventory_control->'reservedItems') || jsonb_build_array(jsonb_build_object('itemCode', $2::text, 'itemName', 'gone', 'reservedQty', 3))) WHERE id = $1`,
  [project, `GONE-${h.tag}`]);
  const before = await versionOf(h, project);

  const p = await preview(h, project);
  const la = lineOf(p, a);
  const lb = lineOf(p, b);
  if (!p.hasChanges) wrong.push('the preview says nothing changes');
  if (la?.currentQty !== 3 || la?.targetQty !== 10 || la?.requiredQty !== 10 || la?.shortQty !== 0) wrong.push(`item A previews ${JSON.stringify(la)}, expected 3 → 10 of a need of 10`);
  if (lb?.currentQty !== 6 || lb?.targetQty !== 2 || lb?.requiredQty !== 2) wrong.push(`item B previews ${JSON.stringify(lb)}, expected 6 → 2 of a need of 2`);
  if (await versionOf(h, project) !== before) wrong.push('the preview changed the project version');

  const res = await apply(h, project, { version: before, planToken: p.planToken });
  if (res.status !== 200) {
    wrong.push(`the reconcile answered ${brief(res)}, expected 200`);
    return 'reconcile refused';
  }
  const body = res.body as { version?: number; changed?: boolean };
  if (body.changed !== true || body.version !== before + 1) wrong.push(`the reconcile answered changed ${String(body.changed)} version ${String(body.version)}, expected true and ${before + 1}`);
  if (await storedQty(h, project, a) !== 10) wrong.push(`item A is reserved ${await storedQty(h, project, a)} after the reconcile, expected 10`);
  if (await storedQty(h, project, b) !== 2) wrong.push(`item B is reserved ${await storedQty(h, project, b)} after the reconcile, expected 2`);
  const viewA = await reservedOf(a);
  if (viewA.project !== 10 || viewA.proforma !== 1) wrong.push(`the reservation report of A shows project ${viewA.project} and proforma ${viewA.proforma}, expected 10 and 1`);
  const rows = await storedReservation(h, project);
  if (!rows.some(r => r.itemCode === `GONE-${h.tag}` && Number(r.reservedQty) === 3)) wrong.push('the stored row of an item that is gone was dropped');
  const [ic] = await h.q(`SELECT inventory_control->'reservationShortages' AS s, (inventory_control->>'isFinalized') AS fin FROM production_projects WHERE id = $1`, [project]);
  if (Array.isArray(ic?.s) && (ic.s as unknown[]).length > 0) wrong.push(`shortages are left after the reconcile: ${JSON.stringify(ic.s)}`);
  if (ic?.fin !== 'true') wrong.push('the reconcile unfroze the project');
  const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'کنترل موجودی پروژه' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(project)]);
  const changes = (audit[0]?.details as { changes?: unknown[] } | undefined)?.changes;
  if (!Array.isArray(changes) || changes.length !== 2) wrong.push(`the audit row lists ${JSON.stringify(changes)}, expected the two changed items`);
  const again = await preview(h, project);
  if (again.hasChanges) wrong.push(`a second preview still has changes: ${JSON.stringify(again.lines)}`);
  return 'the reconcile reserves the shortfall and releases the excess';
}

/** A later sales proforma never shrinks the project's reservation (first come, first served) */
async function firstComeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 8)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, a) !== 8) throw new Error('setup: the finalize did not reserve 8');
  // a sales proforma above the sellable stock is kept with a warning (TD-1138), so others now hold 5 of the 2 left
  await proforma(h, f, a, 5);
  const before = await versionOf(h, project);
  const p = await preview(h, project);
  const la = lineOf(p, a);
  if (la?.currentQty !== 8 || la?.targetQty !== 8) wrong.push(`the project previews ${JSON.stringify(la)}, expected to keep 8`);
  if (p.hasChanges) wrong.push('the preview has changes although the project holds its whole need');
  const res = await apply(h, project, { version: before, planToken: p.planToken });
  if (res.status !== 200 || (res.body as { changed?: boolean }).changed !== false) wrong.push(`applying an unchanged plan answered ${brief(res)}, expected 200 changed false`);
  if (await versionOf(h, project) !== before) wrong.push('an unchanged plan raised the project version');
  if (await storedQty(h, project, a) !== 8) wrong.push(`the project is reserved ${await storedQty(h, project, a)}, expected 8`);
  return 'the project keeps its reservation against a later proforma';
}

/** Only the previewed plan is written */
async function planTokenCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(2);
  const draft = await createProject(h, { sections: globalSection([await materialRow(h, a, 6)]), manualPurchaseItems: [], isFinalized: false });
  const unfinal = await h.get(`/api/projects/${draft}/reservation-reconcile`);
  if (unfinal.status !== 422 || (unfinal.body as { code?: unknown }).code !== 'PROJECT_RESERVATION_NOT_FINALIZED') wrong.push(`an unfinalized project's preview answered ${brief(unfinal)}, expected 422 PROJECT_RESERVATION_NOT_FINALIZED`);

  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 6)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, a) !== 2) throw new Error('setup: the finalize did not reserve 2');
  const version = await versionOf(h, project);
  const first = await preview(h, project);
  const badToken = await apply(h, project, { version, planToken: 'abc' });
  if (badToken.status !== 400) wrong.push(`a malformed token answered ${brief(badToken)}, expected 400`);
  await receipt(h, f, a, 1);
  const stale = await apply(h, project, { version, planToken: first.planToken });
  const staleBody = stale.body as { code?: unknown; details?: { preview?: Preview } };
  if (stale.status !== 409 || staleBody.code !== 'PROJECT_RESERVATION_PLAN_CHANGED') wrong.push(`a plan changed by a receipt answered ${brief(stale)}, expected 409 PROJECT_RESERVATION_PLAN_CHANGED`);
  const fresh = staleBody.details?.preview;
  if (!fresh || fresh.planToken === first.planToken || lineOf(fresh, a)?.targetQty !== 3) wrong.push(`the 409 carries the preview ${JSON.stringify(fresh)}, expected a new plan reserving 3`);
  if (await storedQty(h, project, a) !== 2 || await versionOf(h, project) !== version) wrong.push('a refused reconcile changed the reservation or the version');
  const oldVersion = await apply(h, project, { version: version + 5, planToken: fresh?.planToken ?? '' });
  if (oldVersion.status !== 409 || (oldVersion.body as { code?: unknown }).code !== 'OCC_CONFLICT') wrong.push(`a stale version answered ${brief(oldVersion)}, expected 409 OCC_CONFLICT`);
  const ok = await apply(h, project, { version, planToken: fresh?.planToken ?? '' });
  if (ok.status !== 200) wrong.push(`the fresh plan answered ${brief(ok)}, expected 200`);
  if (await storedQty(h, project, a) !== 3) wrong.push(`the project is reserved ${await storedQty(h, project, a)} after the fresh plan, expected 3`);
  return 'only the previewed plan is written';
}

/** A void after a reconcile restores what the remittance deducted, and nothing is reserved twice */
async function voidRestoresCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 10)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, a) !== 10) throw new Error('setup: the finalize did not reserve 10');
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 4, unit_price: 0, location: f.wh }], { projectId: project }));
  const remId = Number((rem.body as { docId?: unknown })?.docId);
  if (rem.status !== 200 || !Number.isInteger(remId)) throw new Error(`setup: the project remittance answered ${brief(rem)}`);
  if (await storedQty(h, project, a) !== 6) throw new Error(`setup: the remittance left ${await storedQty(h, project, a)} reserved, expected 6`);
  await saveSections(h, project, [await materialRow(h, a, 5)]);
  const p = await preview(h, project);
  const la = lineOf(p, a);
  if (la?.requiredQty !== 1 || la?.currentQty !== 6 || la?.targetQty !== 1) wrong.push(`the preview of a need of 5 less 4 issued is ${JSON.stringify(la)}, expected 6 → 1`);
  const res = await apply(h, project, { version: await versionOf(h, project), planToken: p.planToken });
  if (res.status !== 200) throw new Error(`the reconcile answered ${brief(res)}`);
  const replay = await apply(h, project, { version: await versionOf(h, project), planToken: p.planToken });
  if (replay.status !== 409) wrong.push(`sending the applied plan again answered ${brief(replay)}, expected 409`);
  if (await storedQty(h, project, a) !== 1) wrong.push(`the project is reserved ${await storedQty(h, project, a)} after the reconcile, expected 1`);
  const voided = await h.del(`/api/documents/${remId}`);
  if (voided.status !== 200) throw new Error(`setup: voiding the remittance answered ${brief(voided)}`);
  if (await storedQty(h, project, a) !== 5) wrong.push(`the void left ${await storedQty(h, project, a)} reserved, expected 5 (1 + the 4 restored)`);
  const after = await preview(h, project);
  if (after.hasChanges || lineOf(after, a)?.requiredQty !== 5) wrong.push(`after the void the preview is ${JSON.stringify(after.lines)}, expected a need of 5 already held`);
  const view = await reservedOf(a);
  if (view.project !== 5) wrong.push(`the reservation report shows ${view.project} for the project, expected 5`);
  return 'a void after a reconcile restores exactly what was deducted';
}

/** A recoded and renamed item keeps its reservation: the stored row by its id, the old list row through the stored row's code and name */
async function rowByIdCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 6)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, a) !== 6) throw new Error('setup: the finalize did not reserve 6');
  // the item is recoded and renamed after the finalize: the list row and the stored row still carry the old code and name
  await h.q('UPDATE items SET code = $2, name = $3 WHERE id = $1', [a, `RECODED-${h.tag}`, `recoded ${h.tag}`]);
  const p = await preview(h, project);
  const la = lineOf(p, a);
  if (la?.currentQty !== 6 || la?.targetQty !== 6 || la?.requiredQty !== 6) wrong.push(`the preview of the recoded item is ${JSON.stringify(la)}, expected its stored 6 kept for the old list row`);
  if (p.hasChanges) wrong.push(`the preview has changes: ${JSON.stringify(p.lines)}`);
  if (p.unmatchedRows.length !== 0) wrong.push(`the old list row is listed as matching no item: ${JSON.stringify(p.unmatchedRows)}`);
  const res = await apply(h, project, { version: await versionOf(h, project), planToken: p.planToken });
  if (res.status !== 200 || (res.body as { changed?: boolean }).changed !== false) wrong.push(`applying answered ${brief(res)}, expected 200 changed false`);
  if (await storedQty(h, project, a) !== 6) wrong.push(`the recoded item is reserved ${await storedQty(h, project, a)}, expected 6`);
  return 'a recoded item keeps its reservation';
}

/** A row that reaches no item never lets the reconcile release; a plan that only reserves still goes through */
async function unmatchedRowCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const arabicYeh = `\u06a9\u062f\u064a-${h.tag}`;
  const persianYeh = `\u06a9\u062f\u06cc-${h.tag}`;
  await h.q('UPDATE items SET code = $2, name = $3 WHERE id = $1', [a, arabicYeh, `bead ${h.tag}`]);
  const project = await createProject(h, {
    sections: globalSection([{ itemCode: arabicYeh, name: `bead ${h.tag}`, unit: 'عدد', requiredQty: 4 }]), manualPurchaseItems: [], isFinalized: true,
  });
  if (await storedQty(h, project, a) !== 4) throw new Error('setup: the finalize did not reserve 4');
  const typo = { itemCode: persianYeh, name: `typed bead ${h.tag}`, unit: 'عدد', requiredQty: 4 };
  await saveSections(h, project, [typo]);
  const version = await versionOf(h, project);

  const p = await preview(h, project);
  const la = lineOf(p, a);
  if (la?.currentQty !== 4 || la?.targetQty !== 0) wrong.push(`the preview of the reserved item is ${JSON.stringify(la)}, expected 4 that the plan would release`);
  if (p.unmatchedRows.length !== 1 || p.unmatchedRows[0]?.code !== persianYeh || p.unmatchedRows[0]?.qty !== 4) wrong.push(`the preview lists ${JSON.stringify(p.unmatchedRows)}, expected the Persian-yeh row of 4`);
  const refused = await apply(h, project, { version, planToken: p.planToken });
  const body = refused.body as { code?: unknown; details?: { unmatchedRows?: unknown[] } };
  if (refused.status !== 422 || body.code !== 'PROJECT_RESERVATION_ROWS_UNMATCHED' || body.details?.unmatchedRows?.length !== 1) wrong.push(`a release beside an unmatched row answered ${brief(refused)}, expected 422 PROJECT_RESERVATION_ROWS_UNMATCHED naming the row`);
  if (await storedQty(h, project, a) !== 4 || await versionOf(h, project) !== version) wrong.push('the refused reconcile changed the reservation or the version');

  // the unmatched row stays, the item is named correctly again with a larger need: only a reservation is added
  await saveSections(h, project, [typo, await materialRow(h, a, 6)]);
  const more = await preview(h, project);
  const lm = lineOf(more, a);
  if (lm?.currentQty !== 4 || lm?.targetQty !== 6) wrong.push(`the preview after the fix is ${JSON.stringify(lm)}, expected 4 → 6`);
  if (more.unmatchedRows.length !== 1) wrong.push(`the preview after the fix lists ${JSON.stringify(more.unmatchedRows)}, expected the Persian-yeh row still`);
  const ok = await apply(h, project, { version: await versionOf(h, project), planToken: more.planToken });
  if (ok.status !== 200) wrong.push(`a plan that only reserves answered ${brief(ok)}, expected 200`);
  if (await storedQty(h, project, a) !== 6) wrong.push(`the item is reserved ${await storedQty(h, project, a)} after the reserve-only plan, expected 6`);
  return 'an unmatched row blocks a release and lets a reserve through';
}

/** The reservation report reads a stored row's item with the reconcile's item read: a code that starts with a no-break space */
async function trimmedCodeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 5)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, a) !== 5) throw new Error('setup: the finalize did not reserve 5');
  const [it] = await h.q('SELECT code FROM items WHERE id = $1', [a]);
  // a legacy stored row without an item id that names its item by code only, and an item code saved with a leading no-break space
  await h.q(`UPDATE production_projects SET inventory_control = jsonb_set(inventory_control, '{reservedItems}',
    jsonb_build_array(jsonb_build_object('itemCode', $2::text, 'itemName', $3::text, 'reservedQty', 5))) WHERE id = $1`, [project, it.code, `legacy name ${h.tag}`]);
  await h.q('UPDATE items SET code = $2 WHERE id = $1', [a, `\u00a0${String(it.code)}`]);

  const p = await preview(h, project);
  const la = lineOf(p, a);
  if (la?.currentQty !== 5 || p.hasChanges) wrong.push(`the reconcile previews ${JSON.stringify(la)} with changes ${String(p.hasChanges)}, expected 5 held and nothing to change`);
  const view = await reservedOf(a);
  if (view.project !== 5) wrong.push(`the reservation report shows ${view.project} held by the project, expected 5 as the reconcile reads`);
  return 'the report and the reconcile find the same item';
}
