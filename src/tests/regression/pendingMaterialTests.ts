import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { hasWorkflowTransitionAction } from '../../services/workflow/workflowTransitionActions.js';
import { transit, wfUser } from '../invariants/workflowScenarioHelpers.js';

/**
 * Package 7 (inventory planning), PR C: the raw material request queue («مواد اولیه در انتظار تأیید»). Each case is red on
 * the code before its fix.
 */
export async function runPendingMaterialTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_pending_material_approve_body_td_824',
      'v9.0.396: the approval reads the cost and reorder point the reviewer typed; the old snake_case keys are refused instead of dropped (TD-824)',
      ['td824', 'pending_materials', 'package7'], approveBodyCase],
    ['reg_pending_material_submit_rules_td_825',
      'v9.0.397: sending a request needs pending_materials.create, numbers are read like every money field and an inline image becomes a file (TD-825)',
      ['td825', 'pending_materials', 'package7'], submitRulesCase],
    ['reg_pending_material_review_once_td_825',
      'v9.0.397: a reviewed request is never approved, rejected or deleted again, and the approval links its one item with audit rows (TD-825)',
      ['td825', 'pending_materials', 'package7'], reviewOnceCase],
    ['reg_pending_material_concurrent_approval_td_825',
      'v9.0.397: two concurrent approvals of one request make one item; a code taken in another letter case is refused (TD-825)',
      ['td825', 'pending_materials', 'package7'], concurrentApprovalCase],
    ['reg_pending_material_workflow_td_826',
      'v9.0.398: a request starts the active pending-material workflow, its approve and reject steps review the request, a direct review closes the workflow and the project must exist (TD-826)',
      ['td826', 'pending_materials', 'workflow', 'package7'], workflowCase],
  ]);
}

const briefBody = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;

/** A pending request written straight to the table (the queue had no sender before TD-826) */
export async function pendingRow(h: Harness, fields: { code?: string; wac?: number } = {}): Promise<number> {
  const [row] = await h.q(
    `INSERT INTO pending_materials (code, name, unit, category, type, requested_by, status, reorder_point, weighted_average_cost, is_deleted)
     VALUES ($1, $2, 'عدد', 'سنگ', 'raw_material', 'test', 'pending', 0, $3, 0) RETURNING id`,
    [fields.code ?? `PM-${h.tag}-${Math.random().toString(36).slice(2, 7)}`, `ERP-TEST-MARKER ماده ${h.tag} ${Math.random().toString(36).slice(2, 7)}`, fields.wac ?? 1000],
  );
  return Number(row.id);
}

/** B07-08 (TD-824): the page sent weighted_average_cost / reorder_point, the route read only camelCase and dropped the rest */
async function approveBodyCase(h: Harness, wrong: string[]): Promise<string> {
  const id = await pendingRow(h, { wac: 1000 });
  const snake = await h.put(`/api/pending-materials/${id}/approve`, { weighted_average_cost: 75000, reorder_point: 12 });
  if (snake.status !== 400) wrong.push(`an approval with snake_case keys answered ${briefBody(snake)}, expected 400`);
  const [still] = await h.q('SELECT status FROM pending_materials WHERE id = $1', [id]);
  if (still?.status !== 'pending') wrong.push(`after the refused approval the request is ${String(still?.status)}, expected pending`);

  const edit = await h.put(`/api/pending-materials/${id}`, { reorder_point: 3 });
  if (edit.status !== 400) wrong.push(`an edit with snake_case keys answered ${briefBody(edit)}, expected 400`);

  const ok = await h.put(`/api/pending-materials/${id}/approve`, { weightedAverageCost: 75000, reorderPoint: 12 });
  const itemId = Number((ok.body as { item?: { id?: unknown } })?.item?.id);
  if (ok.status !== 200 || !itemId) {
    wrong.push(`an approval with camelCase keys answered ${briefBody(ok)}, expected 200 with the new item`);
    return 'approval failed';
  }
  const [item] = await h.q('SELECT weighted_average_cost::text AS wac, reorder_point::text AS rp FROM items WHERE id = $1', [itemId]);
  if (Number(item?.wac) !== 75000 || Number(item?.rp) !== 12) {
    wrong.push(`the new item has WAC ${String(item?.wac)} and reorder point ${String(item?.rp)}, expected 75000 and 12`);
  }
  return `snake_case ${snake.status}/${edit.status}; camelCase item ${itemId} WAC ${String(item?.wac)} reorder point ${String(item?.rp)}`;
}

const randomTail = () => Math.random().toString(36).slice(2, 7);
/** A tiny base64 PNG body: the image check reads the media type and the base64 text, not the picture */
const PNG_DATA_URL = `data:image/png;base64,${'iVBORw0KGgo'.padEnd(400, 'A')}`;

/** B07-09 (a), (e), (f): any signed-in user sent requests; «۱۲» and «abc» became 0; a TEMP-<ms> code; a data URL stored as text */
async function submitRulesCase(h: Harness, wrong: string[]): Promise<string> {
  const outsider = await h.sessionWith(['daily_logs.view']);
  const denied = await h.post('/api/pending-materials', { name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}` }, outsider);
  if (denied.status !== 403) wrong.push(`a user without pending_materials.create sent a request: ${briefBody(denied)}, expected 403`);

  const sender = await h.sessionWith(['pending_materials.view', 'pending_materials.create']);
  const ok = await h.post('/api/pending-materials', {
    name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}`, reorderPoint: '۱۲', weightedAverageCost: '۷۵٬۰۰۰', image: PNG_DATA_URL,
  }, sender);
  const id = Number((ok.body as { data?: { id?: unknown } })?.data?.id);
  if (ok.status !== 201 || !id) {
    wrong.push(`a request with Persian digits answered ${briefBody(ok)}, expected 201`);
  } else {
    const [row] = await h.q('SELECT code, reorder_point::text AS rp, weighted_average_cost::text AS wac, image FROM pending_materials WHERE id = $1', [id]);
    if (Number(row?.rp) !== 12 || Number(row?.wac) !== 75000) wrong.push(`stored reorder point ${String(row?.rp)} and cost ${String(row?.wac)}, expected 12 and 75000`);
    if (row?.code !== '') wrong.push(`a request without a code got the code ${String(row?.code)}, expected none`);
    if (String(row?.image ?? '').startsWith('data:')) wrong.push('the inline image was stored as text, expected a file path');
    const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'ماده اولیه' AND entity_id = $1 AND action = 'CREATE'`, [String(id)]);
    if (!(audit[0]?.details as { after?: unknown } | undefined)?.after) wrong.push('the request has no CREATE audit row with its snapshot');
  }

  const text = await h.post('/api/pending-materials', { name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}`, weightedAverageCost: 'abc' }, sender);
  if (text.status !== 400) wrong.push(`a cost of «abc» answered ${briefBody(text)}, expected 400`);
  const negative = await h.post('/api/pending-materials', { name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}`, reorderPoint: -1 }, sender);
  if (negative.status !== 400) wrong.push(`a negative reorder point answered ${briefBody(negative)}, expected 400`);
  const badImage = await h.post('/api/pending-materials', { name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}`, image: 'data:text/html;base64,PGI+' }, sender);
  if (badImage.status !== 422) wrong.push(`a non-image data URL answered ${briefBody(badImage)}, expected 422`);
  return `outsider ${denied.status}; sender ${ok.status}; abc ${text.status}; negative ${negative.status}; html image ${badImage.status}`;
}

/** B07-09 (c): an approved request was rejected (item kept) and approved again into a second item; a reviewed one deleted */
async function reviewOnceCase(h: Harness, wrong: string[]): Promise<string> {
  const id = await pendingRow(h, { code: `PM825-${h.tag}-${randomTail()}` });
  const ok = await h.put(`/api/pending-materials/${id}/approve`, {});
  const itemId = Number((ok.body as { item?: { id?: unknown } })?.item?.id);
  if (ok.status !== 200 || !itemId) {
    wrong.push(`the first approval answered ${briefBody(ok)}, expected 200`);
    return 'approval failed';
  }
  const [linked] = await h.q('SELECT item_id, status FROM pending_materials WHERE id = $1', [id]);
  if (Number(linked?.item_id) !== itemId) wrong.push(`the request links item ${String(linked?.item_id)}, expected ${itemId}`);

  const reject = await h.put(`/api/pending-materials/${id}/reject`, { rejectionReason: 'دوباره' });
  const again = await h.put(`/api/pending-materials/${id}/approve`, { code: `PM825-${h.tag}-B${randomTail()}` });
  const edit = await h.put(`/api/pending-materials/${id}`, { name: `ERP-TEST-MARKER ${h.tag} ویرایش` });
  const remove = await h.del(`/api/pending-materials/${id}`);
  for (const [label, res] of [['reject', reject], ['second approval', again], ['edit', edit], ['delete', remove]] as const) {
    if (res.status !== 409) wrong.push(`${label} of an approved request answered ${briefBody(res)}, expected 409`);
  }
  const [after] = await h.q('SELECT status, is_deleted FROM pending_materials WHERE id = $1', [id]);
  if (after?.status !== 'approved' || Number(after?.is_deleted) !== 0) wrong.push(`the approved request is now ${String(after?.status)} / deleted ${String(after?.is_deleted)}`);

  const rejectedId = await pendingRow(h, { code: `PM825-${h.tag}-${randomTail()}` });
  const firstReject = await h.put(`/api/pending-materials/${rejectedId}/reject`, {});
  const approveRejected = await h.put(`/api/pending-materials/${rejectedId}/approve`, {});
  if (firstReject.status !== 200 || approveRejected.status !== 409) {
    wrong.push(`reject then approve answered ${firstReject.status} then ${briefBody(approveRejected)}, expected 200 then 409`);
  }

  const itemAudit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'کالا' AND entity_id = $1 AND action = 'CREATE'`, [String(itemId)]);
  const requestAudit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'ماده اولیه' AND entity_id = $1 AND action = 'UPDATE'`, [String(id)]);
  const itemDetails = itemAudit[0]?.details as { after?: unknown; pendingMaterialId?: unknown } | undefined;
  const requestDetails = requestAudit[0]?.details as { before?: unknown; after?: unknown } | undefined;
  if (!itemDetails?.after || Number(itemDetails.pendingMaterialId) !== id) wrong.push('the item CREATE audit row has no snapshot or request id');
  if (requestAudit.length !== 1 || !requestDetails?.before || !requestDetails?.after) wrong.push(`the request has ${requestAudit.length} UPDATE audit rows with before/after, expected 1`);
  return `item ${itemId}; reject ${reject.status}, approve ${again.status}, edit ${edit.status}, delete ${remove.status}; rejected then approved ${approveRejected.status}`;
}

/**
 * B07-09 (d): two concurrent approvals of one request made two items (with one code, or each with its reviewer's code).
 * The item code and name indexes (TD-653) now refuse a second item with the same code or name, so each reviewer here
 * gives its own code and name.
 */
async function concurrentApprovalCase(h: Harness, wrong: string[]): Promise<string> {
  const code = `PM825-${h.tag}-${randomTail()}`;
  const id = await pendingRow(h, { code });
  const results = await Promise.all(['A', 'B'].map(side =>
    h.put(`/api/pending-materials/${id}/approve`, { code: `${code}-${side}`, name: `ERP-TEST-MARKER ${code} ${side}` })));
  const statuses = results.map(r => r.status).sort();
  if (statuses.join('/') !== '200/409') wrong.push(`two concurrent approvals answered ${results.map(briefBody).join(' and ')}, expected 200 and 409`);
  const made = await h.q('SELECT id, code FROM items WHERE code IN ($1, $2) AND is_deleted = 0', [`${code}-A`, `${code}-B`]);
  if (made.length !== 1) wrong.push(`the request made ${made.length} items, expected 1`);

  // the code of whichever approval won the race, in another letter case
  const otherCase = await pendingRow(h, { code: String(made[0]?.code ?? `${code}-A`).toLowerCase() });
  const clash = await h.put(`/api/pending-materials/${otherCase}/approve`, {});
  if (clash.status !== 409) wrong.push(`a code differing only in letter case answered ${briefBody(clash)}, expected 409`);
  return `concurrent ${statuses.join('/')}; items ${made.length}; other case ${clash.status}`;
}

/** The id of the request a POST answered with, or 0 */
const createdId = (res: { body?: unknown }) => Number((res.body as { data?: { id?: unknown } })?.data?.id) || 0;

/**
 * B07-10 (TD-826): no action was registered for `pending_material`, a request started no workflow and project control
 * built items straight through `POST /api/items`. With an active definition a request now starts its instance, the
 * approve step makes the item and the reject step rejects it, and a direct review terminates the open instance.
 */
async function workflowCase(h: Harness, wrong: string[]): Promise<string> {
  if (!hasWorkflowTransitionAction('pending_material')) wrong.push('no workflow transition action is registered for pending_material');
  const others = await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE entity_type = 'pending_material' AND is_active = 1 RETURNING id`);
  const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
    code: `PMWF_${h.tag}_${randomTail()}`, entityType: 'pending_material', title: `ERP-TEST-MARKER گردش کار ماده اولیه ${h.tag}`,
    states: [
      { stateKey: 'submitted', title: 'ثبت درخواست', stateType: 'initial', stepOrder: 1, slaHours: 24 },
      { stateKey: 'approved', title: 'تأییدشده', stateType: 'terminal', stepOrder: 2, slaHours: 24 },
      { stateKey: 'rejected', title: 'ردشده', stateType: 'terminal', stepOrder: 3, slaHours: 24 },
    ],
    transitions: [
      { from: 'submitted', to: 'approved', actionKey: 'approve', title: 'تأیید', requiredRole: '', requiredPermission: 'pending_materials.approve', approvalRuleType: 'SINGLE', kValue: 1 },
      { from: 'submitted', to: 'rejected', actionKey: 'reject', title: 'رد', requiredRole: '', requiredPermission: 'pending_materials.approve', approvalRuleType: 'SINGLE', kValue: 1 },
    ],
  });
  const definitionId = Number(saved?.definition.id);
  const transitionOf = (key: string) => Number(saved?.transitions.find(t => t.actionKey === key)?.id);
  try {
    const sender = await h.sessionWith(['pending_materials.view', 'pending_materials.create']);
    const send = (code: string, extra: Record<string, unknown> = {}) => h.post('/api/pending-materials', {
      name: `ERP-TEST-MARKER ماده ${h.tag} ${randomTail()}`, code, ...extra,
    }, sender);
    const instanceOf = async (id: number) => (await h.q(
      `SELECT id, status FROM workflow_instances WHERE entity_type = 'pending_material' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(id)]))[0];
    const reviewer = await wfUser('admin', ['pending_materials.approve']);

    const viaWorkflow = createdId(await send(`PM826-${h.tag}-${randomTail()}`));
    const started = viaWorkflow ? await instanceOf(viaWorkflow) : undefined;
    if (!started) wrong.push(`a request with an active pending-material workflow started no instance (request ${viaWorkflow})`);
    else {
      await transit(Number(started.id), transitionOf('approve'), reviewer).catch((err: unknown) => wrong.push(`the approve step failed: ${String(err)}`));
      const [row] = await h.q('SELECT status, item_id FROM pending_materials WHERE id = $1', [viaWorkflow]);
      if (row?.status !== 'approved' || !Number(row?.item_id)) wrong.push(`after the approve step the request is ${String(row?.status)} with item ${String(row?.item_id)}, expected approved with its item`);
    }

    const rejected = createdId(await send(`PM826-${h.tag}-${randomTail()}`));
    const rejectInstance = rejected ? await instanceOf(rejected) : undefined;
    if (rejectInstance) {
      await transit(Number(rejectInstance.id), transitionOf('reject'), reviewer).catch((err: unknown) => wrong.push(`the reject step failed: ${String(err)}`));
      const [row] = await h.q('SELECT status, item_id FROM pending_materials WHERE id = $1', [rejected]);
      if (row?.status !== 'rejected' || row?.item_id !== null) wrong.push(`after the reject step the request is ${String(row?.status)} with item ${String(row?.item_id)}, expected rejected without an item`);
    }

    const direct = createdId(await send(`PM826-${h.tag}-${randomTail()}`));
    const approved = direct ? await h.put(`/api/pending-materials/${direct}/approve`, {}) : { status: 0 };
    const closed = direct ? await instanceOf(direct) : undefined;
    if (approved.status !== 200 || closed?.status !== 'TERMINATED') {
      wrong.push(`a direct approval answered ${approved.status} and left the instance ${String(closed?.status)}, expected 200 and TERMINATED`);
    }

    const noProject = await send('', { projectId: 999999999 });
    if (noProject.status !== 422) wrong.push(`a request for a missing project answered ${briefBody(noProject)}, expected 422`);
    return `instance ${String(started?.status)}; reject step ${String(rejectInstance?.id ?? 'none')}; direct approval ${approved.status} → ${String(closed?.status)}; missing project ${noProject.status}`;
  } finally {
    await h.q('UPDATE workflow_definitions SET is_active = 0 WHERE id = $1', [definitionId]);
    if (others.length) await h.q('UPDATE workflow_definitions SET is_active = 1 WHERE id = ANY($1::int[])', [others.map(r => Number(r.id))]);
  }
}
