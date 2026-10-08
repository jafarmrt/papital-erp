import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { ItemStockReservationService } from '../../services/items/itemStockReservation.service.js';
import { ProjectBomAllocationService } from '../../services/inventory/projectBomAllocation.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { ProjectService } from '../../services/projects.service.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { snapshotTransitionsOf } from '../../services/workflow/workflowSnapshot.js';
import type { WorkflowSnapshotDsl } from '../../services/workflow/workflowTransitionExecutor.js';
import { createTestItem } from '../fixtures/factories.js';
import type { OpOutcome, SimItem, SimRandom } from './simulationOperations.js';
import type { SimParty } from './simulationFinanceOperations.js';

/**
 * v10.0.11 (TD-982, I-01) — purchasing, material allocation and approval operations of the business-year simulator.
 * Purchase orders, deliveries, allocations and approved proformas are dated by the server (business today, after every
 * simulated day), so these operations work on items of their own (`projectItems`): the dated operations never meet a
 * later movement of these items and stay forward-dated.
 */

const ADMIN = { username: 'sim', role: 'admin' };
const MAX_APPROVAL_STEPS = 6;
const PROJECT_ITEM_COUNT = 2;

/**
 * The approver is an existing user (the simulator creates none, so a database whose users table was empty stays so, as
 * the restore drill of TD-361 expects); without one the approval operation is skipped.
 */
export async function setupProjectWorld(tag: string): Promise<{ projectId: number; approverId: number | null }> {
  await WorkflowEngineService.seedDefaultWorkflows();
  const { project } = await ProjectService.createProject({
    title: `Simulator project ${tag}`, startDate: await businessTodayIsoDate(), quantity: 1, products: [],
  } as unknown as Parameters<typeof ProjectService.createProject>[0]);
  const approver = (await pool.query<{ id: number }>(`SELECT id FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1`)).rows[0];
  return { projectId: project.id, approverId: approver?.id ?? null };
}

export function createProjectOperations(
  random: SimRandom,
  world: { tag: string; onItem: (itemId: number) => void; projectItems: SimItem[]; mainWh: string; customer: SimParty; supplier: SimParty; allocationIds: number[] },
  ids: { projectId: number; approverId: number | null }
) {
  const { pick, between } = random;
  const { projectItems, mainWh, customer, supplier } = world;

  /**
   * The project items are made by the first purchases (at most PROJECT_ITEM_COUNT), so every one carries a document line
   * and none is an unreferenced marker row that `db:cleanup-test` would remove (TD-581 check on a simulated year)
   */
  const purchaseItem = async (): Promise<SimItem> => {
    if (projectItems.length < PROJECT_ITEM_COUNT) {
      const it = await createTestItem({
        type: 'raw_material', code: `${world.tag}_PJ${projectItems.length}`, category: 'مواد اولیه', stocks: {}, weightedAverageCost: 0,
      });
      const item: SimItem = { id: it.id, type: 'raw_material' };
      projectItems.push(item);
      world.onItem(item.id);
      return item;
    }
    return pick(projectItems);
  };

  /** Stock of the main warehouse less every reservation of the item (sales proformas left open by a stuck approval) */
  const freeStock = async (itemId: number): Promise<number> => {
    const res = await pool.query<{ s: string }>(
      `SELECT COALESCE(current_stock, 0)::text AS s FROM item_warehouse_stocks WHERE item_id = $1 AND warehouse_code = $2`, [itemId, mainWh]);
    const reserved = await ItemStockReservationService.getReservedStocksMap({ itemIds: [itemId] });
    return Math.floor(Number(res.rows[0]?.s ?? 0) - Number(reserved[String(itemId)]?.totalReserved ?? 0));
  };

  /** A requisition converted to one order and delivered; approval runs in the admin's name on conversion */
  const procurement = async (): Promise<OpOutcome> => {
    const item = await purchaseItem();
    const quantity = between(5, 30);
    const unitPrice = between(50, 300) * 1000;
    const requisition = await ProcurementService.createRequisition({
      title: `Simulator requisition ${item.id}`, items: [{ itemId: item.id, requestedQty: quantity, unitPriceEstimate: unitPrice }],
    } as unknown as Parameters<typeof ProcurementService.createRequisition>[0], ADMIN);
    const { createdDocuments } = await ProcurementService.convertToPurchaseOrders({
      requisitionId: requisition.id,
      orderGroups: [{ supplierName: supplier.name, targetWarehouse: mainWh, items: [{ itemId: item.id, quantity, unitPrice }] }],
    } as unknown as Parameters<typeof ProcurementService.convertToPurchaseOrders>[0], ADMIN);
    const orderId = Number(createdDocuments[0]?.id);
    await ProcurementService.deliverOrderToWarehouse(orderId, ADMIN);
    return { detail: `requisition #${requisition.id} ordered and delivered as #${orderId}: item ${item.id} x${quantity} @${unitPrice}`, tags: [] };
  };

  const bomAllocation = async (): Promise<OpOutcome> => {
    if (projectItems.length === 0) return { detail: 'skip:no-project-item', tags: [] };
    const item = pick(projectItems);
    const available = await freeStock(item.id);
    if (available < 1) return { detail: 'skip:no-stock', tags: [] };
    const quantity = between(1, Math.min(available, 6));
    const result = await ProjectBomAllocationService.allocateMaterialsForProject({
      projectId: ids.projectId, allocations: [{ itemId: item.id, quantity, location: mainWh }], username: 'sim',
    });
    world.allocationIds.push(...result.allocations.map(a => a.id));
    return { detail: `allocation of item ${item.id} x${quantity} to project #${ids.projectId}`, tags: [] };
  };

  const bomRelease = async (): Promise<OpOutcome> => {
    if (world.allocationIds.length === 0) return { detail: 'skip:no-allocation', tags: [] };
    const id = pick(world.allocationIds);
    const status = (await pool.query<{ status: string }>(`SELECT status FROM project_bom_allocations WHERE id = $1`, [id])).rows[0]?.status;
    if (status !== 'allocated') return { detail: `skip:allocation-${status ?? 'missing'}`, tags: [] };
    await ProjectBomAllocationService.releaseAllocation(id, { username: 'sim' });
    return { detail: `release allocation #${id}`, tags: [] };
  };

  /**
   * A sales proforma within free stock starts the document approval workflow as the document route starts it; the approver
   * walks it to its end (never a reject action), which finalizes it into an invoice (TD-415).
   */
  const proformaApproval = async (): Promise<OpOutcome> => {
    const approverId = ids.approverId;
    if (approverId === null) return { detail: 'skip:no-approver', tags: [] };
    if (projectItems.length === 0) return { detail: 'skip:no-project-item', tags: [] };
    const item = pick(projectItems);
    const available = await freeStock(item.id);
    if (available < 1) return { detail: 'skip:no-stock', tags: [] };
    const quantity = between(1, Math.min(available, 4));
    const docId = await DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'proforma', date: await businessTodayIsoDate(), user: 'sim', partyId: customer.id,
      items: [{ itemId: item.id, quantity, unitPrice: between(100, 500) * 1000, location: mainWh }],
    });
    // as POST /documents does for a sales proforma (TD-446): the active document definition, if any
    await WorkflowEngineService.maybeStartWorkflow({ entityType: 'document', entityId: docId, userId: approverId, userName: 'sim' });
    for (let n = 0; n < MAX_APPROVAL_STEPS; n++) {
      const instance = (await pool.query<{ id: number; current_state_id: number; status: string; snapshot_dsl: WorkflowSnapshotDsl }>(
        `SELECT id, current_state_id, status, snapshot_dsl FROM workflow_instances
          WHERE entity_type = 'document' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(docId)])).rows[0];
      if (!instance) return { detail: `proforma #${docId} without a workflow`, tags: ['no-workflow'] };
      if (instance.status !== 'IN_PROGRESS') return { detail: `proforma #${docId} workflow ${instance.status} after ${n} steps`, tags: [instance.status.toLowerCase()] };
      const states = instance.snapshot_dsl?.states ?? [];
      const forward = (snapshotTransitionsOf(instance.snapshot_dsl) ?? [])
        .filter(t => t.fromStateId === instance.current_state_id && !/reject/i.test(t.actionKey)
          && states.find(s => s.id === t.toStateId)?.stateKey !== 'rejected');
      const next = forward.find(t => states.find(s => s.id === t.toStateId)?.stateType === 'terminal') ?? forward[0];
      if (!next) return { detail: `proforma #${docId} workflow has no forward action`, tags: ['stuck'] };
      await WorkflowEngineService.executeTransition({
        instanceId: instance.id, transitionId: next.id, userId: approverId, userName: 'sim', userRole: 'admin', userPermissions: [],
      });
    }
    return { detail: `proforma #${docId} workflow not finished in ${MAX_APPROVAL_STEPS} steps`, tags: ['stuck'] };
  };

  return { procurement, bomAllocation, bomRelease, proformaApproval };
}
