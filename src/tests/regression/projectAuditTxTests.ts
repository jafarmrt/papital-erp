import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, runReservationCases } from './stockReservationTests.js';

/**
 * TD-943 (P5-M10, part of OBS-R2-07): a project delivery's production receipt had no CREATE audit row, so the activity log
 * never showed who recorded it, and the delivery, material allocation, consumption and release rows were written by the
 * routes after the commit. Now each service writes its rows with its own transaction. Red on v10.1.9: no receipt CREATE
 * row, and inside the service's transaction no audit row existed yet.
 */
export async function runProjectAuditTxTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_delivery_audit_in_tx_td_943',
      'v10.1.10: a project delivery writes the production receipt CREATE row and the project row, and an allocation, its consumption and its release their rows, with their own transaction (TD-943)',
      ['td943', 'projects', 'allocation', 'audit', 'phase5'], deliveryAndAllocationAuditCase],
  ]);
}

const RECEIPT_ENTITY = 'رسید تولید و تحویل محصول';
const PROJECT_ENTITY = 'پروژه تولید';
const ALLOCATION_ENTITY = 'تخصیص مواد BOM پروژه';
const RELEASE_ENTITY = 'آزادسازی تخصیص BOM';

type Db = { execute: typeof orm.execute };
const auditRows = async (db: Db, entity: string, entityId: number, action?: string) => Number(((await db.execute(sql`
  SELECT count(*)::int AS n FROM activity_logs WHERE entity = ${entity} AND entity_id = ${String(entityId)}
    ${action ? sql`AND action = ${action}` : sql``}`)).rows[0] as { n: number })?.n);

class Rollback extends Error {}

async function deliveryAndAllocationAuditCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20);
  const product = await f.item(0, 0);
  const projectRes = await h.post('/api/projects', {
    title: `TD943 delivery ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity: 10,
    products: [{ item_id: product, item_code: '', item_name: '', quantity: 10, unit: 'عدد' }],
  });
  const projectId = Number((projectRes.body as { id?: unknown }).id);
  if (projectRes.status !== 201) throw new Error(`setup: project create answered ${brief(projectRes)}`);

  // 1) the delivery route: the production receipt has its CREATE row with the stored document, and the project its row
  const delivered = await h.post(`/api/projects/${projectId}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 4, unitPrice: 300_000, location: f.wh }] });
  const documentId = Number((delivered.body as { documentId?: unknown }).documentId);
  if (delivered.status !== 200 || !Number.isInteger(documentId)) throw new Error(`setup: delivery answered ${brief(delivered)}`);
  const [receiptRow] = await h.q(`SELECT user_id, details FROM activity_logs WHERE entity = $1 AND entity_id = $2 AND action = 'CREATE'`, [RECEIPT_ENTITY, String(documentId)]);
  if (!receiptRow) wrong.push('the production receipt of the delivery has no CREATE audit row');
  else {
    const after = (receiptRow.details as { after?: { docType?: string; projectId?: number; items?: unknown[] } } | null)?.after;
    if (after?.docType !== 'production_receipt' || after?.projectId !== projectId || after?.items?.length !== 1) wrong.push(`the receipt CREATE row holds ${JSON.stringify(after ?? null)}, expected the stored receipt of the project with one line`);
    if (receiptRow.user_id === null) wrong.push('the receipt CREATE row names no user');
  }
  if (await auditRows(orm, PROJECT_ENTITY, projectId, 'UPDATE') < 1) wrong.push('the delivery wrote no project audit row');

  // 2) inside the delivery's transaction both rows exist before the commit, and a rolled-back delivery leaves none
  const { ProjectService } = await import('../../services/projects.service.js');
  let inTx = { receipt: 0, project: 0 };
  let rolledBackDoc = 0;
  try {
    await orm.transaction(async tx => {
      const projectRowsBefore = await auditRows(tx, PROJECT_ENTITY, projectId, 'UPDATE');
      const result = await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product, quantity: 1, unitPrice: 300_000, location: f.wh }], currentUser: 'td943' }, tx);
      rolledBackDoc = Number(result.documentId);
      inTx = { receipt: await auditRows(tx, RECEIPT_ENTITY, rolledBackDoc, 'CREATE'), project: await auditRows(tx, PROJECT_ENTITY, projectId, 'UPDATE') - projectRowsBefore };
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  if (inTx.receipt !== 1 || inTx.project !== 1) wrong.push(`inside the delivery's transaction ${inTx.receipt} receipt and ${inTx.project} project rows existed, expected 1 and 1`);
  if (rolledBackDoc > 0 && await auditRows(orm, RECEIPT_ENTITY, rolledBackDoc) !== 0) wrong.push('a rolled-back delivery left its receipt audit row');

  // 3) allocation, consumption and release through the routes, each with its row
  const openProject = await createProject(h, { sections: [], manualPurchaseItems: [], isFinalized: false });
  const allocate = () => h.post('/api/inventory/allocations/allocate', { projectId: openProject, allocations: [{ itemId: material, quantity: 2, location: f.wh }] });
  const first = await allocate();
  const second = await allocate();
  const idOf = (res: { body?: unknown }) => Number((res.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
  if (first.status !== 200 || second.status !== 200) throw new Error(`setup: allocations answered ${brief(first)} / ${brief(second)}`);
  if (await auditRows(orm, ALLOCATION_ENTITY, openProject, 'CREATE') !== 2) wrong.push(`two allocations wrote ${await auditRows(orm, ALLOCATION_ENTITY, openProject, 'CREATE')} audit rows, expected 2`);
  const consumed = await h.post(`/api/inventory/allocations/${idOf(first)}/consume`, {});
  if (consumed.status !== 200 || await auditRows(orm, ALLOCATION_ENTITY, idOf(first), 'UPDATE') !== 1) wrong.push(`consuming answered ${brief(consumed)} with ${await auditRows(orm, ALLOCATION_ENTITY, idOf(first), 'UPDATE')} audit rows, expected 1`);
  const released = await h.post(`/api/inventory/allocations/${idOf(second)}/release`, { reason: 'TD-943' });
  if (released.status !== 200 || await auditRows(orm, RELEASE_ENTITY, idOf(second), 'UPDATE') !== 1) wrong.push(`releasing answered ${brief(released)} with ${await auditRows(orm, RELEASE_ENTITY, idOf(second), 'UPDATE')} audit rows, expected 1`);

  // 4) inside an allocation's own transaction its row exists before the commit
  const { InventoryIntegrityService } = await import('../../services/inventory/inventoryIntegrity.service.js');
  const txProject = await createProject(h, { sections: [], manualPurchaseItems: [], isFinalized: false });
  let allocationRowsInTx = 0;
  try {
    await orm.transaction(async tx => {
      await InventoryIntegrityService.allocateMaterialsForProject({ projectId: txProject, allocations: [{ itemId: material, quantity: 1, location: f.wh }], username: 'td943', externalTx: tx });
      allocationRowsInTx = await auditRows(tx, ALLOCATION_ENTITY, txProject, 'CREATE');
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  if (allocationRowsInTx !== 1) wrong.push(`inside the allocation's transaction ${allocationRowsInTx} audit rows existed, expected 1`);
  if (await auditRows(orm, ALLOCATION_ENTITY, txProject) !== 0) wrong.push('a rolled-back allocation left its audit row');

  return 'delivery receipt CREATE row and project row, allocation, consumption and release rows written with their own transactions';
}
