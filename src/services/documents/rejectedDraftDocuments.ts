import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';

/**
 * v10.0.96 (TD-1197، آزمون راهنما roles-a): پیش‌فاکتور فروشی که گردش کارش رد شده پیش‌نویس می‌شود (TD-1137) و فهرست
 * «پیش فاکتورهای باز» آن را با نشان «ردشده» نشان می‌دهد تا فروشنده اصلاحش کند. سند ردشده سندی است که آخرین نمونه گردش
 * کارش در وضعیت `REJECTED` است؛ این تابع از میان شناسه‌های داده‌شده همان‌ها را برمی‌گرداند.
 */
export async function rejectedWorkflowDocumentIds(documentIds: number[]): Promise<Set<number>> {
  if (documentIds.length === 0) return new Set();
  const rows = await orm.select({ id: workflowInstances.id, entityId: workflowInstances.entityId, status: workflowInstances.status })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'document'), inArray(workflowInstances.entityId, documentIds.map(String))));
  const latest = new Map<string, { id: number; status: string | null }>();
  for (const row of rows) {
    const seen = latest.get(row.entityId);
    if (!seen || row.id > seen.id) latest.set(row.entityId, { id: row.id, status: row.status });
  }
  return new Set([...latest].filter(([, v]) => v.status === 'REJECTED').map(([entityId]) => Number(entityId)));
}
