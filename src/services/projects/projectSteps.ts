import { and, count, countDistinct, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documentItems, documents, productionProjects, projectBomAllocations, purchaseRequisitions } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import type { ProjectStepCounts } from '../../lib/projects/projectSteps.js';
import { deliveredProjectQuantities, plannedProjectProducts } from './projectDeliveryCap.js';
import { projectIssueAllocationConditions, projectIssueLineConditions } from './projectIssuedQuantities.js';

/** requisition statuses by stage; the legacy approved, completed and cancelled read as their stage (TD-326) */
const ORDERED_STATUSES = new Set(['ordered', 'approved']);
const RECEIVED_STATUSES = new Set(['received', 'completed']);
const CLOSED_STATUSES = new Set(['rejected', 'cancelled', 'consolidated']);

/**
 * v10.2.1 (10.2 package 2, review U4): the counts of a project's step bar. Read only: the live requisitions of the
 * project by stage, its allocations not released, its live final remittances and waste with a live line (the documents
 * that issue material to a project, TD-233 / TD-945; the rows of `projectIssuedQuantities` since v10.2.2), and its
 * final production receipts against the planned products (the delivery cap's own rule). It carries no amount, so
 * `projects.view` reads it like the project record.
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

  // v10.2.2 (TD-1290): the same rows as the issued quantities and «مواد گرفته‌شده از انبار», so a document whose lines
  // are all deleted issues nothing here either
  const allocationRows = await orm
    .select({ status: projectBomAllocations.status, rows: count() })
    .from(projectBomAllocations)
    .where(projectIssueAllocationConditions(projectId))
    .groupBy(projectBomAllocations.status);
  const [issueRow] = await orm
    .select({ rows: countDistinct(documents.id) })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(projectIssueLineConditions(projectId));
  const allocations = { open: 0, consumed: 0, issueDocuments: Number(issueRow?.rows) || 0 };
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
