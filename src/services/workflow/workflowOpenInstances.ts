import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.37 (TD-455، یافته B14-13): هر موجودیت حداکثر یک فرایند در جریان دارد. startInstance شروع را با قفل تراکنشی
 * موجودیت سریال می‌کند و شاخص یکتای جزئی `uq_workflow_instances_open_entity` (مهاجرت 0056، فقط روی داده بی تکرار
 * ساخته می‌شود) پشتوانه است؛ تکراری‌های پیشین خودکار بسته نمی‌شوند و فقط در بررسی سلامت فهرست می‌شوند.
 */
export const WORKFLOW_OPEN_INSTANCE_UNIQUE_INDEX = 'uq_workflow_instances_open_entity';

export interface DuplicateOpenInstanceRow {
  id: number;
  entityType: string;
  entityId: string;
  workflowDefinitionId: number;
  createdAt: string | null;
}

export async function findDuplicateOpenInstances(db: DbExecutor = orm): Promise<DuplicateOpenInstanceRow[]> {
  const rows = await db.select({
    id: workflowInstances.id,
    entityType: workflowInstances.entityType,
    entityId: workflowInstances.entityId,
    workflowDefinitionId: workflowInstances.workflowDefinitionId,
    createdAt: workflowInstances.createdAt,
  })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.status, 'IN_PROGRESS'), sql`(${workflowInstances.entityType}, ${workflowInstances.entityId}) IN (
      SELECT wi.entity_type, wi.entity_id FROM workflow_instances wi WHERE wi.status = 'IN_PROGRESS'
      GROUP BY wi.entity_type, wi.entity_id HAVING COUNT(*) > 1
    )`))
    .orderBy(asc(workflowInstances.entityType), asc(workflowInstances.entityId), asc(workflowInstances.id));
  return rows.map(r => ({ ...r, createdAt: r.createdAt ?? null }));
}

export async function hasOpenInstanceUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${WORKFLOW_OPEN_INSTANCE_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildOpenInstanceHealthTest(duplicates: DuplicateOpenInstanceRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const entities = new Map<string, number[]>();
  for (const r of duplicates) {
    const key = `${r.entityType}:${r.entityId}`;
    entities.set(key, [...(entities.get(key) ?? []), r.id]);
  }
  const entityCount = entities.size;
  return {
    id: 'workflow_open_instance_uniqueness',
    category: 'system',
    title: 'یک فرایند در جریان برای هر موجودیت',
    description: 'هر سند یا موجودیت حداکثر یک فرایند گردش کار در جریان دارد؛ شروع هم‌زمان پشت هم انجام می‌شود و پایگاه‌داده با شاخص یکتا از فرایند باز دوم جلوگیری می‌کند',
    status: entityCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, entityCount),
    count: entityCount,
    message: entityCount > 0
      ? `${entityCount} موجودیت بیش از یک فرایند در جریان دارد و قید یکتایی در پایگاه‌داده اعمال نشده است؛ فرایندها خودکار بسته نمی‌شوند. فرایند اضافه هر موجودیت را از کارتابل رد یا تکمیل کنید.`
      : (uniqueIndexPresent
        ? 'هیچ موجودیتی بیش از یک فرایند در جریان ندارد و پایگاه‌داده از فرایند باز دوم جلوگیری می‌کند.'
        : 'هیچ موجودیتی بیش از یک فرایند در جریان ندارد اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map(r => ({
      id: r.id,
      code: `فرایند ${r.id}`,
      title: `${r.entityType} ${r.entityId}`,
      subtitle: `گردش کار ${r.workflowDefinitionId}`,
      details: `فرایندهای در جریان همین موجودیت: ${(entities.get(`${r.entityType}:${r.entityId}`) ?? [r.id]).map(id => `#${id}`).join('، ')}.`,
    })),
    metrics: { duplicateEntities: entityCount, duplicateInstances: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
