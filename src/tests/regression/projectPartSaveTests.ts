import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { brief, fixture, type Fixture } from './documentEntryTests.js';
import { createProject, globalSection, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * TD-1342 (package 12 item 4, option ب of card t42): each tab of a production project saves only its own part, and
 * «کاربر دیگری تغییر داده» comes only when that same part changed since the tab was opened. A remittance, a material
 * allocation, a reservation reconcile or a schedule-linked work log raises the project version but changes no part a tab
 * saves, so a tab opened before them still saves; a save without part tokens keeps the old rule. Through the real
 * Express routes on PostgreSQL; each case is red on v10.2.17, where every stale version was 409.
 */
export async function runProjectPartSaveTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_part_save_inventory_after_issue_td_1342',
      'v10.2.x: the inventory tab opened before a project remittance and an allocation still saves with its part tokens and keeps the deducted reservation; without tokens or after another inventory save it is 409 naming the part (TD-1342)',
      ['td1342', 'package12', 'projects', 'reservation', 'occ'], inventoryAfterIssueCase],
    ['reg_project_part_save_schedule_status_specs_td_1342',
      'v10.2.x: after a schedule-linked work log the schedule tab still saves and keeps the link, removing the logged row is 409, the status action is 409 because the log moved the status, and the specs still save (TD-1342)',
      ['td1342', 'package12', 'projects', 'piecework', 'occ'], scheduleStatusSpecsCase],
    ['reg_project_part_save_reconcile_td_1342',
      'v10.2.x: the reservation reconcile from a tab opened before a remittance posts with its inventory token; a changed materials list is 409 naming the part; a malformed token is 400 (TD-1342)',
      ['td1342', 'td1341', 'package12', 'projects', 'reservation', 'occ'], reconcileCase],
    ['reg_project_part_save_finalize_specs_td_1342',
      'v10.2.x: a stale materials tab finalizes only while the products it built the need from are unchanged, a version the project never reached is 409, and a token behind the stored part is 409 even with the current version (TD-1342 review M1 / N1 / N2)',
      ['td1342', 'package12', 'projects', 'reservation', 'occ'], finalizeSpecsCase],
    ['reg_project_part_save_legacy_logged_row_td_1345',
      'v10.2.x: a save without part tokens at the current version never removes a schedule row that has a work log; it is 409 naming the schedule and the row keeps its link, while the same save keeping the row still saves (TD-1342 review N-b, TD-1345)',
      ['td1345', 'td1342', 'package12', 'projects', 'piecework', 'occ'], legacyLoggedRowCase],
  ]);
}

interface Base { version: number; partTokens: Record<string, string> }
interface ConflictBody { code?: unknown; error?: unknown; message?: unknown; details?: { parts?: unknown } }

const INVENTORY_LABEL = 'کنترل موجودی';
const SCHEDULE_LABEL = 'برنامهٔ کارگاه';
const STATUS_LABEL = 'وضعیت';

/** what a tab is built from: the project record as GET /projects/:id answers it */
async function baseOf(h: Harness, projectId: number, wrong: string[]): Promise<Base> {
  const res = await h.get(`/api/projects/${projectId}`);
  if (res.status !== 200) throw new Error(`setup: reading the project answered ${brief(res)}`);
  const body = res.body as { version?: unknown; partTokens?: unknown };
  const tokens = (body.partTokens ?? {}) as Record<string, string>;
  const parts = ['specs', 'status', 'attachments', 'inventory', 'schedule'];
  if (!parts.every(p => /^[0-9a-f]{32}$/.test(String(tokens[p])))) wrong.push(`the project record carries the part tokens ${JSON.stringify(body.partTokens ?? null)}, expected one per part`);
  return { version: Number(body.version), partTokens: tokens };
}

const versionOf = async (h: Harness, projectId: number) =>
  Number((await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]))[0]?.version);

const reservedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);

/** a 409 OCC_CONFLICT whose message and details name exactly these parts */
function expectPartConflict(wrong: string[], what: string, res: { status: number; body?: unknown }, parts: string[], labels: string[]): void {
  const body = (res.body ?? {}) as ConflictBody;
  const text = String(body.error ?? body.message ?? '');
  const named = Array.isArray(body.details?.parts) ? (body.details?.parts as unknown[]).map(String) : [];
  if (res.status !== 409 || body.code !== 'OCC_CONFLICT') wrong.push(`${what} answered ${brief(res)}, expected 409 OCC_CONFLICT`);
  else if (JSON.stringify(named) !== JSON.stringify(parts)) wrong.push(`${what} names the parts ${JSON.stringify(named)}, expected ${JSON.stringify(parts)}`);
  else if (!labels.every(l => text.includes(`«${l}»`))) wrong.push(`${what} says «${text}», which does not name ${labels.join(' / ')}`);
}

async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

async function projectRemittance(h: Harness, f: Fixture, projectId: number, itemId: number, quantity: number): Promise<void> {
  const res = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId, quantity, unit_price: 0, location: f.wh }], { projectId }));
  if (res.status !== 200) throw new Error(`setup: the project remittance answered ${brief(res)}`);
}

/** A tab opened before a remittance and an allocation still saves its inventory part, keeping the deducted reservation */
async function inventoryAfterIssueCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const rows = [await materialRow(h, a, 10)];
  const project = await createProject(h, { sections: globalSection(rows), manualPurchaseItems: [], isFinalized: true });
  if (await reservedQty(h, project, a) !== 10) throw new Error('setup: the finalize did not reserve 10');
  const base = await baseOf(h, project, wrong);

  await projectRemittance(h, f, project, a, 4);
  const allocated = await h.post('/api/inventory/allocations/allocate', { projectId: project, allocations: [{ itemId: a, quantity: 2, location: f.wh }] });
  if (allocated.status !== 200 && allocated.status !== 201) throw new Error(`setup: the allocation answered ${brief(allocated)}`);
  if (await reservedQty(h, project, a) !== 4) throw new Error(`setup: the remittance and the allocation left ${await reservedQty(h, project, a)} reserved, expected 4`);
  const raised = await versionOf(h, project);
  if (raised <= base.version) throw new Error(`setup: the remittance and the allocation left the version at ${raised}`);
  const afterIssue = await baseOf(h, project, wrong);
  if (afterIssue.partTokens.inventory !== base.partTokens.inventory) wrong.push('the remittance or the allocation changed the inventory part token');

  const save = (manualPurchaseItems: unknown[], extra: Record<string, unknown>) => h.put(`/api/projects/${project}`, {
    inventory_control: { sections: globalSection(rows), manualPurchaseItems, isFinalized: true, lastUpdated: new Date().toISOString() }, ...extra,
  });
  const note = [{ id: 'm-1', name: `glue ${h.tag}`, unit: 'عدد', quantity: 1 }];

  const legacy = await save(note, { version: base.version });
  if (legacy.status !== 409 || (legacy.body as ConflictBody).code !== 'OCC_CONFLICT') wrong.push(`a stale save without part tokens answered ${brief(legacy)}, expected 409 OCC_CONFLICT as before`);

  const saved = await save(note, { version: base.version, partTokens: base.partTokens });
  if (saved.status !== 200) {
    wrong.push(`the inventory save of a tab opened before the remittance answered ${brief(saved)}, expected 200`);
    return 'stale inventory save refused';
  }
  if (await reservedQty(h, project, a) !== 4) wrong.push(`the save left ${await reservedQty(h, project, a)} reserved, expected the deducted 4 (never the 10 the tab saw)`);
  if (await versionOf(h, project) !== raised + 1) wrong.push(`the save left version ${await versionOf(h, project)}, expected ${raised + 1}`);
  const answered = (saved.body as { partTokens?: Record<string, string> }).partTokens;
  const now = await baseOf(h, project, wrong);
  if (!answered || JSON.stringify(answered) !== JSON.stringify(now.partTokens)) wrong.push('the save answer carries other part tokens than the project record');
  if (now.partTokens.inventory === base.partTokens.inventory) wrong.push('the inventory part token did not change with the saved list');

  // a second tab opened at the same base: its inventory part changed meanwhile, so it is refused and writes nothing
  const second = await save([], { version: base.version, partTokens: base.partTokens });
  expectPartConflict(wrong, 'a second save from the same base', second, ['inventory'], [INVENTORY_LABEL]);
  const [kept] = await h.q(`SELECT jsonb_array_length(inventory_control->'manualPurchaseItems') AS n FROM production_projects WHERE id = $1`, [project]);
  if (Number(kept?.n) !== 1) wrong.push('the refused save changed the manual purchase list');

  // a tab of another part from the same base still saves
  const specs = await h.put(`/api/projects/${project}`, { description: `after issue ${h.tag}`, version: base.version, partTokens: base.partTokens });
  if (specs.status !== 200) wrong.push(`a specs save from the same base answered ${brief(specs)}, expected 200`);
  return 'a stale inventory tab saves its own part and keeps the deducted reservation';
}

let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;

/** A planned project with two stages and the schedule rows row-a and row-b of one product under stage 1 */
async function scheduledProject(h: Harness, itemId: number, worker: number, task: number) {
  const products = [{ id: 'prod-a', item_id: itemId, item_code: '', item_name: 'P12 product', quantity: 10, unit: 'عدد' }];
  const [project] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, item_id, quantity, products) VALUES ($1, $2, 'planned', $3, 10, $4) RETURNING id`,
    [unique('P12P'), unique('P12 project'), itemId, JSON.stringify(products)],
  );
  const projectId = Number(project.id);
  const stageIds: number[] = [];
  for (const [order, title] of [[1, 'برش'], [2, 'مونتاژ']] as const) {
    const [stage] = await h.q(`INSERT INTO project_stages (project_id, stage_order, title) VALUES ($1, $2, $3) RETURNING id`, [projectId, order, title]);
    stageIds.push(Number(stage.id));
  }
  const row = (id: string, quantity: number) => ({ id, taskId: task, taskTitle: 'برش P12', assignedPersonnelId: worker, quantity, unit: 'عدد' });
  const schedules = { [String(stageIds[0])]: { 'prod-a': { productId: 'prod-a', productName: 'P12 product', tasks: [row('row-a', 10), row('row-b', 20)] } } };
  await h.q(`UPDATE production_projects SET stage_schedules = $2 WHERE id = $1`, [projectId, JSON.stringify(schedules)]);
  return { projectId, stageId: stageIds[0], schedules, row };
}

/** After a schedule-linked work log: the schedule and specs tabs still save, removing the logged row or a status action is 409 */
async function scheduleStatusSpecsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(0);
  const [taskRow] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, 1000) RETURNING id`, [unique('P12T'), unique('P12 task')]);
  const task = Number(taskRow.id);
  const worker = await newWorker('P12 worker');
  const { projectId, stageId, row } = await scheduledProject(h, item, worker, task);
  const base = await baseOf(h, projectId, wrong);

  const logged = await h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId, date: f.today, quantity: 10, scheduleRef: { stageId, productId: 'prod-a', rowId: 'row-a' },
  });
  const logId = Number((logged.body as { insertedIds?: number[] }).insertedIds?.[0]);
  if (logged.status !== 201 || !logId) throw new Error(`setup: logging row-a answered ${brief(logged)}`);
  const [state] = await h.q(`SELECT status, version FROM production_projects WHERE id = $1`, [projectId]);
  if (Number(state?.version) <= base.version) throw new Error('setup: the work log did not raise the project version');
  if (state?.status !== 'in_progress') throw new Error(`setup: the work log left the project ${String(state?.status)}, expected in_progress`);

  // the tab's own copy of the plan, which never saw the link
  const plan = (tasks: unknown[]) => ({ [String(stageId)]: { 'prod-a': { productId: 'prod-a', productName: 'P12 product', tasks } } });
  const removed = await h.put(`/api/projects/${projectId}`, { stage_schedules: plan([row('row-b', 20)]), version: base.version, partTokens: base.partTokens });
  expectPartConflict(wrong, 'a stale schedule save removing the logged row', removed, ['schedule'], [SCHEDULE_LABEL]);

  const legacy = await h.put(`/api/projects/${projectId}`, { stage_schedules: plan([row('row-a', 10), row('row-b', 25)]), version: base.version });
  if (legacy.status !== 409) wrong.push(`a stale schedule save without part tokens answered ${brief(legacy)}, expected 409 as before`);

  const saved = await h.put(`/api/projects/${projectId}`, { stage_schedules: plan([row('row-a', 10), row('row-b', 25)]), version: base.version, partTokens: base.partTokens });
  if (saved.status !== 200) wrong.push(`the schedule save of a tab opened before the work log answered ${brief(saved)}, expected 200`);
  const [stored] = await h.q(`SELECT stage_schedules->$2->'prod-a'->'tasks' AS t FROM production_projects WHERE id = $1`, [projectId, String(stageId)]);
  const tasks = Array.isArray(stored?.t) ? (stored.t as Array<Record<string, unknown>>) : [];
  if (Number(tasks.find(t => t.id === 'row-a')?.pieceworkLogId) !== logId) wrong.push(`the save dropped the work log link of row-a: ${JSON.stringify(tasks)}`);
  if (Number(tasks.find(t => t.id === 'row-b')?.quantity) !== 25) wrong.push(`the save did not write row-b: ${JSON.stringify(tasks)}`);

  // the status buttons were built before the log moved the project to in_progress
  const paused = await h.put(`/api/projects/${projectId}`, { status: 'paused', version: base.version, partTokens: base.partTokens });
  expectPartConflict(wrong, 'a status action from before the work log', paused, ['status'], [STATUS_LABEL]);
  const [after] = await h.q(`SELECT status FROM production_projects WHERE id = $1`, [projectId]);
  if (after?.status !== 'in_progress') wrong.push(`the refused status action left the project ${String(after?.status)}`);

  const specs = await h.put(`/api/projects/${projectId}`, { title: `P12 renamed ${h.tag}`, version: base.version, partTokens: base.partTokens });
  if (specs.status !== 200) wrong.push(`a specs save from the same base answered ${brief(specs)}, expected 200`);
  return 'a stale schedule tab saves and keeps the link; a removed logged row and a stale status action are refused';
}

/** An old page or an API script sends no part tokens, only the project's current version (a body without a version is 400) */
async function legacyLoggedRowCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(0);
  const [taskRow] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, 1000) RETURNING id`, [unique('P12T'), unique('P12 task')]);
  const task = Number(taskRow.id);
  const worker = await newWorker('P12 worker');
  const { projectId, stageId, row } = await scheduledProject(h, item, worker, task);
  const logged = await h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId, date: f.today, quantity: 10, scheduleRef: { stageId, productId: 'prod-a', rowId: 'row-a' },
  });
  const logId = Number((logged.body as { insertedIds?: number[] }).insertedIds?.[0]);
  if (logged.status !== 201 || !logId) throw new Error(`setup: logging row-a answered ${brief(logged)}`);

  const plan = (tasks: unknown[]) => ({ [String(stageId)]: { 'prod-a': { productId: 'prod-a', productName: 'P12 product', tasks } } });
  const current = await versionOf(h, projectId);
  const atVersion = await h.put(`/api/projects/${projectId}`, { stage_schedules: plan([row('row-b', 20)]), version: current });
  expectPartConflict(wrong, 'a save without part tokens at the current version removing the logged row', atVersion, ['schedule'], [SCHEDULE_LABEL]);
  if (await versionOf(h, projectId) !== current) wrong.push('the refused save raised the project version');

  const readTasks = async () => {
    const [stored] = await h.q(`SELECT stage_schedules->$2->'prod-a'->'tasks' AS t FROM production_projects WHERE id = $1`, [projectId, String(stageId)]);
    return Array.isArray(stored?.t) ? (stored.t as Array<Record<string, unknown>>) : [];
  };
  if (Number((await readTasks()).find(t => t.id === 'row-a')?.pieceworkLogId) !== logId) wrong.push(`the refused save dropped row-a or its work log link: ${JSON.stringify(await readTasks())}`);

  const kept = await h.put(`/api/projects/${projectId}`, { stage_schedules: plan([row('row-a', 10), row('row-b', 30)]), version: current });
  if (kept.status !== 200) wrong.push(`a save without part tokens keeping the logged row answered ${brief(kept)}, expected 200`);
  const tasks = await readTasks();
  if (Number(tasks.find(t => t.id === 'row-a')?.pieceworkLogId) !== logId) wrong.push(`the save keeping row-a dropped its work log link: ${JSON.stringify(tasks)}`);
  if (Number(tasks.find(t => t.id === 'row-b')?.quantity) !== 30) wrong.push(`the save keeping row-a did not write row-b: ${JSON.stringify(tasks)}`);
  return 'a save without part tokens keeps the logged row and its link; removing it is refused naming the schedule';
}

/** «تکمیل رزرو» from a tab opened before a remittance */
async function reconcileCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(3);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, a, 10)]), manualPurchaseItems: [], isFinalized: true });
  if (await reservedQty(h, project, a) !== 3) throw new Error('setup: the finalize did not reserve 3');
  const base = await baseOf(h, project, wrong);
  await projectRemittance(h, f, project, a, 1);
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: a, quantity: 9, unit_price: 1_000, location: f.wh }]));
  if (receipt.status !== 200) throw new Error(`setup: the receipt answered ${brief(receipt)}`);

  const res = await h.get(`/api/projects/${project}/reservation-reconcile`);
  const preview = res.body as { version?: number; planToken?: string; inventoryToken?: string };
  if (res.status !== 200 || !preview.planToken) throw new Error(`the reconcile preview answered ${brief(res)}`);
  if (preview.inventoryToken !== base.partTokens.inventory) wrong.push(`the preview's inventory token ${String(preview.inventoryToken)} differs from the tab's ${base.partTokens.inventory}`);

  const malformed = await h.post(`/api/projects/${project}/reservation-reconcile`, { version: base.version, partTokens: { inventory: 'xyz' }, planToken: preview.planToken });
  if (malformed.status !== 400) wrong.push(`a malformed part token answered ${brief(malformed)}, expected 400`);
  const legacy = await h.post(`/api/projects/${project}/reservation-reconcile`, { version: base.version, planToken: preview.planToken });
  if (legacy.status !== 409 || (legacy.body as ConflictBody).code !== 'OCC_CONFLICT') wrong.push(`a stale reconcile without part tokens answered ${brief(legacy)}, expected 409 OCC_CONFLICT`);

  const applied = await h.post(`/api/projects/${project}/reservation-reconcile`, { version: base.version, partTokens: base.partTokens, planToken: preview.planToken });
  if (applied.status !== 200) {
    wrong.push(`the reconcile of a tab opened before the remittance answered ${brief(applied)}, expected 200`);
    return 'stale reconcile refused';
  }
  // need 10 less the 1 issued: 9, all free after the receipt
  if (await reservedQty(h, project, a) !== 9) wrong.push(`the reconcile left ${await reservedQty(h, project, a)} reserved, expected 9`);
  const answered = (applied.body as { partTokens?: Record<string, string> }).partTokens;
  if (!answered || answered.inventory !== base.partTokens.inventory) wrong.push(`the reconcile answer carries the inventory token ${String(answered?.inventory)}, expected the unchanged ${base.partTokens.inventory}`);

  // another tab changes the materials list; a reconcile from the old base is refused and writes nothing
  const fresh = await baseOf(h, project, wrong);
  const changed = await h.put(`/api/projects/${project}`, {
    inventory_control: { sections: globalSection([await materialRow(h, a, 12)]), manualPurchaseItems: [], isFinalized: true }, ...fresh,
  });
  if (changed.status !== 200) throw new Error(`setup: changing the list answered ${brief(changed)}`);
  const next = await h.get(`/api/projects/${project}/reservation-reconcile`);
  const nextPreview = next.body as { planToken?: string };
  const before = await versionOf(h, project);
  const stale = await h.post(`/api/projects/${project}/reservation-reconcile`, { version: base.version, partTokens: base.partTokens, planToken: nextPreview.planToken });
  expectPartConflict(wrong, 'a reconcile from a tab behind the materials list', stale, ['inventory'], [INVENTORY_LABEL]);
  if (await versionOf(h, project) !== before || await reservedQty(h, project, a) !== 9) wrong.push('the refused reconcile changed the project');
  return 'the reconcile follows the inventory part, not the version';
}

const SPECS_LABEL = 'مشخصات';

/** a code-by-code section of one material: each product needs one unit of it */
async function perProductSection(h: Harness, itemId: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return [{ id: 'sec-1', title: 'P12 per product', checkType: 'per_item', itemsSchema: [{ itemCode: it.code, name: it.name, unit: 'عدد' }], perItemResults: {} }];
}

const productRows = (itemId: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `prod-${i + 1}`, item_id: itemId, item_code: '', item_name: `P12 product ${i + 1}`, quantity: 1, unit: 'عدد' }));

/** Review M1 / N1 / N2: the finalize reserves from the products, so it needs their token; a future version and a stale token at the current version are 409 */
async function finalizeSpecsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(10);
  const productItem = await f.item(0);
  const sections = await perProductSection(h, material);
  const project = await createProject(h, { sections, manualPurchaseItems: [], isFinalized: false }, { products: productRows(productItem, 2) });
  const base = await baseOf(h, project, wrong);
  const finalize = (extra: Record<string, unknown>) => h.put(`/api/projects/${project}`, {
    inventory_control: { sections, manualPurchaseItems: [], isFinalized: true, lastUpdated: new Date().toISOString() }, ...extra,
  });
  const notFinal = async (what: string) => {
    const [row] = await h.q(`SELECT inventory_control->>'isFinalized' AS f FROM production_projects WHERE id = $1`, [project]);
    if (row?.f === 'true' || await reservedQty(h, project, material) !== 0) wrong.push(`${what} finalized the project or reserved ${await reservedQty(h, project, material)}`);
  };

  // another user adds a product: the need the tab showed (2) is no longer the project's (3)
  const added = await h.put(`/api/projects/${project}`, { products: productRows(productItem, 3), ...base });
  if (added.status !== 200) throw new Error(`setup: adding a product answered ${brief(added)}`);
  const stale = await finalize({ version: base.version, partTokens: base.partTokens });
  expectPartConflict(wrong, 'a finalize from a tab built before a product was added', stale, ['specs'], [SPECS_LABEL]);
  await notFinal('the refused finalize');

  // N1: a version above the stored one, with the current tokens
  const fresh = await baseOf(h, project, wrong);
  const future = await finalize({ version: fresh.version + 5, partTokens: fresh.partTokens });
  if (future.status !== 409 || (future.body as ConflictBody).code !== 'OCC_CONFLICT') wrong.push(`a finalize from a version the project never reached answered ${brief(future)}, expected 409 OCC_CONFLICT`);
  await notFinal('the finalize from a future version');

  // N2 (server half): the current version does not excuse a part token behind the stored part
  const listed = await h.put(`/api/projects/${project}`, {
    inventory_control: { sections, manualPurchaseItems: [{ id: 'm-1', name: `glue ${h.tag}`, unit: 'عدد', quantity: 1 }], isFinalized: false }, ...fresh,
  });
  if (listed.status !== 200) throw new Error(`setup: changing the materials list answered ${brief(listed)}`);
  const current = await versionOf(h, project);
  const behind = await h.put(`/api/projects/${project}`, {
    inventory_control: { sections, manualPurchaseItems: [], isFinalized: false }, version: current, partTokens: fresh.partTokens,
  });
  expectPartConflict(wrong, 'an inventory save at the current version with the token of the list before', behind, ['inventory'], [INVENTORY_LABEL]);
  const [kept] = await h.q(`SELECT jsonb_array_length(inventory_control->'manualPurchaseItems') AS n FROM production_projects WHERE id = $1`, [project]);
  if (Number(kept?.n) !== 1) wrong.push('the refused save changed the manual purchase list');

  // a tab whose products and list are current finalizes from a stale version (another user changed only the status)
  const ready = await baseOf(h, project, wrong);
  const started = await h.put(`/api/projects/${project}`, { status: 'in_progress', ...ready });
  if (started.status !== 200) throw new Error(`setup: the status change answered ${brief(started)}`);
  const done = await h.put(`/api/projects/${project}`, {
    inventory_control: { sections, manualPurchaseItems: [{ id: 'm-1', name: `glue ${h.tag}`, unit: 'عدد', quantity: 1 }], isFinalized: true }, ...ready,
  });
  if (done.status !== 200) wrong.push(`a finalize whose products and list are current answered ${brief(done)}, expected 200`);
  else if (await reservedQty(h, project, material) !== 3) wrong.push(`the finalize reserved ${await reservedQty(h, project, material)}, expected 3 for three products`);
  return 'the finalize follows the products it was built from; future versions and stale tokens are refused';
}
