import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, projectBomAllocations } from '../../db/schema.js';
import { PROJECT_ISSUE_DOCUMENT_TYPES } from '../../lib/transactions/projectIssueTypes.js';

/** allocations that issue material to a project: still allocated or consumed, never released */
export const PROJECT_ISSUE_ALLOCATION_STATUSES = ['allocated', 'consumed'] as const;

/**
 * v10.2.3 (TD-1290): the document lines that issue material to a project (a join of `document_items` with `documents`):
 * live lines of its live final remittances and waste. The issued quantities, the issued materials list and the step
 * bar count read these same rows.
 */
export function projectIssueLineConditions(projectId: number): SQL {
  return and(
    eq(documents.projectId, projectId), eq(documents.isDeleted, 0), eq(documents.status, 'final'),
    inArray(documents.type, [...PROJECT_ISSUE_DOCUMENT_TYPES]), eq(documentItems.isDeleted, 0),
  ) as SQL;
}

/** v10.2.3 (TD-1290): the project's live allocations that issue material, by the same rule as the lines above */
export function projectIssueAllocationConditions(projectId: number): SQL {
  return and(
    eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0),
    inArray(projectBomAllocations.status, [...PROJECT_ISSUE_ALLOCATION_STATUSES]),
  ) as SQL;
}

/**
 * v10.0.206 (TD-945، تصمیم ت۱۰ فاز ۵): مقدار هر کالا که تاکنون به پروژه داده شده، به واحد کالا: سطرهای زنده حواله و ضایعات
 * قطعی پروژه به‌علاوه تخصیص مواد باز یا مصرف‌شده. ثبت نهایی دوباره پروژه (پس از برداشتن ثبت نهایی) فقط نیاز باقی‌مانده را
 * رزرو می‌کند؛ پیش‌تر کل نیاز دوباره رزرو می‌شد و کالای صادرشده دوبار از موجودی آزاد کم می‌شد.
 */
export async function projectIssuedQuantities(executor: DbExecutor, projectId: number, itemIds: readonly number[]): Promise<Map<number, number>> {
  const issued = new Map<number, number>();
  if (!(projectId > 0) || itemIds.length === 0) return issued;
  const add = (itemId: number, qty: number) => issued.set(itemId, (issued.get(itemId) ?? 0) + qty);
  const lines = await executor
    .select({ itemId: documentItems.itemId, qty: sql<string>`SUM(${documentItems.quantity})::text` })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(projectIssueLineConditions(projectId), inArray(documentItems.itemId, [...itemIds])))
    .groupBy(documentItems.itemId);
  for (const r of lines) add(Number(r.itemId), Number(r.qty) || 0);
  const allocations = await executor
    .select({ itemId: projectBomAllocations.itemId, qty: sql<string>`SUM(${projectBomAllocations.quantity})::text` })
    .from(projectBomAllocations)
    .where(and(projectIssueAllocationConditions(projectId), inArray(projectBomAllocations.itemId, [...itemIds])))
    .groupBy(projectBomAllocations.itemId);
  for (const r of allocations) add(Number(r.itemId), Number(r.qty) || 0);
  return issued;
}
