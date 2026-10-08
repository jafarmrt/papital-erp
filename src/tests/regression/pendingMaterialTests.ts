import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * Package 7 (inventory planning), PR C: the raw material request queue («مواد اولیه در انتظار تأیید»). Each case is red on
 * the code before its fix.
 */
export async function runPendingMaterialTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_pending_material_approve_body_td_824',
      'v9.0.377: the approval reads the cost and reorder point the reviewer typed; the old snake_case keys are refused instead of dropped (TD-824)',
      ['td824', 'pending_materials', 'package7'], approveBodyCase],
    ['reg_pending_material_submit_rules_td_825',
      'v9.0.378: sending a request needs pending_materials.create, numbers are read like every money field and an inline image becomes a file (TD-825)',
      ['td825', 'pending_materials', 'package7'], submitRulesCase],
    ['reg_pending_material_review_once_td_825',
      'v9.0.378: a reviewed request is never approved, rejected or deleted again, and the approval links its one item with audit rows (TD-825)',
      ['td825', 'pending_materials', 'package7'], reviewOnceCase],
    ['reg_pending_material_concurrent_approval_td_825',
      'v9.0.378: two concurrent approvals of one request make one item; a code taken in another letter case is refused (TD-825)',
      ['td825', 'pending_materials', 'package7'], concurrentApprovalCase],
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
  const made = await h.q('SELECT id FROM items WHERE code IN ($1, $2) AND is_deleted = 0', [`${code}-A`, `${code}-B`]);
  if (made.length !== 1) wrong.push(`the request made ${made.length} items, expected 1`);

  const otherCase = await pendingRow(h, { code: `${code}-A`.toLowerCase() });
  const clash = await h.put(`/api/pending-materials/${otherCase}/approve`, {});
  if (clash.status !== 409) wrong.push(`a code differing only in letter case answered ${briefBody(clash)}, expected 409`);
  return `concurrent ${statuses.join('/')}; items ${made.length}; other case ${clash.status}`;
}
