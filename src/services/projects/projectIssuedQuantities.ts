import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, projectBomAllocations } from '../../db/schema.js';
import { PROJECT_ISSUE_DOCUMENT_TYPES } from '../../lib/projects/projectIssueTypes.js';


/**
 * v10.0.31 (TD-945، تصمیم ت۱۰ فاز ۵): مقدار هر کالا که تاکنون به پروژه داده شده، به واحد کالا: سطرهای زنده حواله و ضایعات
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
    .where(and(
      eq(documents.projectId, projectId), eq(documents.isDeleted, 0), eq(documents.status, 'final'),
      inArray(documents.type, [...PROJECT_ISSUE_DOCUMENT_TYPES]), eq(documentItems.isDeleted, 0), inArray(documentItems.itemId, [...itemIds]),
    ))
    .groupBy(documentItems.itemId);
  for (const r of lines) add(Number(r.itemId), Number(r.qty) || 0);
  const allocations = await executor
    .select({ itemId: projectBomAllocations.itemId, qty: sql<string>`SUM(${projectBomAllocations.quantity})::text` })
    .from(projectBomAllocations)
    .where(and(
      eq(projectBomAllocations.projectId, projectId), eq(projectBomAllocations.isDeleted, 0),
      inArray(projectBomAllocations.status, ['allocated', 'consumed']), inArray(projectBomAllocations.itemId, [...itemIds]),
    ))
    .groupBy(projectBomAllocations.itemId);
  for (const r of allocations) add(Number(r.itemId), Number(r.qty) || 0);
  return issued;
}
