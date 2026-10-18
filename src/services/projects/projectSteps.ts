import { and, count, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { productionProjects, projectBomAllocations, purchaseRequisitions } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import type { ProjectStepCounts } from '../../lib/projects/projectSteps.js';
import { deliveredProjectQuantities, plannedProjectProducts } from './projectDeliveryCap.js';

/** requisition statuses by stage; the legacy approved, completed and cancelled read as their stage (TD-326) */
const ORDERED_STATUSES = new Set(['ordered', 'approved']);
const RECEIVED_STATUSES = new Set(['received', 'completed']);
const CLOSED_STATUSES = new Set(['rejected', 'cancelled', 'consolidated']);

/**
 * v10.2.x (10.2 package 2, review U4): the counts of a project's step bar. Read only: the live requisitions of the
 * project by stage, its allocations not released, and its final production receipts against the planned products (the
 * delivery cap's own rule). It carries no amount, so `projects.view` reads it like the project record.
 */
export async function loadProjectStepCounts(projectId: number): Promise<ProjectStepCounts> {
  const [project] = await orm
    .select({ products: productionProjects.products, itemId: productionProjects.itemId, itemName: productionProjects.itemName, quantity: productionProjects.quantity, unit: productionProjects.unit })
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new NotFoundError('پروژه یافت نشد');

  const requisitionRows = await orm
    .select({ status: purchaseRequisitions.status, rows: count() })
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.projectId, projectId), eq(purchaseRequisitions.isDeleted, 0)))
    .groupBy(purchaseRequisitions.status);
  const requisitions = { open: 0, ordered: 0, received: 0 };
  for (const row of requisitionRows) {
    const status = String(row.status ?? '');
    const rows = Number(row.rows) || 0;
    if (ORDERED_STATUSES.has(status)) requisitions.ordered += rows;
    else if (RECEIVED_STATUSES.has(status)) requisitions.received += rows;
    else if (!CLOSED_STATUSES.has(status)) requisitions.open += rows;
  }

  const allocationRows = await orm
    .select({ status: projectBomAllocations.status, rows: count() })
    .from(projectBomAllocations)
    .where(and(eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0), sql`${projectBomAllocations.status} IN ('allocated', 'consumed')`))
    .groupBy(projectBomAllocations.status);
  const allocations = { open: 0, consumed: 0 };
  for (const row of allocationRows) {
    if (row.status === 'consumed') allocations.consumed += Number(row.rows) || 0;
    else allocations.open += Number(row.rows) || 0;
  }

  const planned = plannedProjectProducts(project);
  const delivered = await deliveredProjectQuantities(orm, projectId, [...planned.keys()]);
  const units = new Set([...planned.values()].map(p => p.unit.trim() || 'عدد'));
  let deliveredTotal = 0;
  let plannedTotal = 0;
  let completeProducts = 0;
  for (const [itemId, plan] of planned) {
    const done = delivered.get(itemId)?.toNumber() ?? 0;
    deliveredTotal += done;
    plannedTotal += plan.quantity.toNumber();
    if (plan.quantity.toNumber() > 0 && done >= plan.quantity.toNumber()) completeProducts += 1;
  }

  return {
    requisitions,
    allocations,
    delivery: {
      products: planned.size,
      completeProducts,
      delivered: deliveredTotal,
      planned: plannedTotal,
      unit: units.size === 1 ? [...units][0] : null,
    },
  };
}
