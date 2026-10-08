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
