import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';

/**
 * v10.1.6 (TD-1229, D-06 part A): at most one active workflow definition per record type. Migration 0110 builds the
 * partial unique index only on data without duplicates; earlier duplicates are never turned off automatically and are
 * only listed here, so the admin deactivates the extra one (before, an automatic start silently took the oldest).
 */

/** the partial unique index of migration 0110 */
const ACTIVE_DEFINITION_INDEX = 'uq_workflow_definitions_active_entity_type';

export interface DuplicateActiveDefinitionRow {
  id: number;
  code: string;
  title: string;
  entityType: string;
}

export async function findDuplicateActiveDefinitions(db: DbExecutor): Promise<DuplicateActiveDefinitionRow[]> {
  return db.select({ id: workflowDefinitions.id, code: workflowDefinitions.code, title: workflowDefinitions.title, entityType: workflowDefinitions.entityType })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.isActive, 1), sql`${workflowDefinitions.entityType} IN (
      SELECT wd.entity_type FROM workflow_definitions wd WHERE wd.is_active = 1 GROUP BY wd.entity_type HAVING COUNT(*) > 1
    )`))
    .orderBy(asc(workflowDefinitions.entityType), asc(workflowDefinitions.id));
}

export async function hasActiveDefinitionUniqueIndex(db: DbExecutor): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(format('%I.%I', current_schema(), ${ACTIVE_DEFINITION_INDEX}::text)) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildActiveDefinitionHealthTest(duplicates: DuplicateActiveDefinitionRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const types = new Map<string, DuplicateActiveDefinitionRow[]>();
  for (const r of duplicates) types.set(r.entityType, [...(types.get(r.entityType) ?? []), r]);
  const typeCount = types.size;
  return {
    id: 'workflow_active_definition_uniqueness',
    category: 'system',
    title: 'یک گردش کار فعال برای هر نوع پرونده',
    description: 'هر نوع پرونده (فاکتور، کالا، حساب بانکی، درخواست خرید و …) حداکثر یک گردش کار فعال دارد و پایگاه‌داده با شاخص یکتا از گردش کار فعال دوم جلوگیری می‌کند',
    status: typeCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, typeCount),
    count: typeCount,
    message: typeCount > 0
      ? `${typeCount} نوع پرونده بیش از یک گردش کار فعال دارد و پرونده تازه بی‌صدا با قدیمی‌ترین آن‌ها آغاز می‌شود؛ گردش کار اضافه را در «طراحی گردش کار» غیرفعال کنید.`
      : (uniqueIndexPresent
        ? 'هیچ نوع پرونده‌ای بیش از یک گردش کار فعال ندارد و پایگاه‌داده از گردش کار فعال دوم جلوگیری می‌کند.'
        : 'هیچ نوع پرونده‌ای بیش از یک گردش کار فعال ندارد اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map(r => ({
      id: r.id,
      code: r.code,
      title: r.title,
      subtitle: workflowEntityTypeLabel(r.entityType),
      details: `گردش کارهای فعال همین نوع: ${(types.get(r.entityType) ?? [r]).map(d => `«${d.title}»`).join('، ')}.`,
    })),
    metrics: { duplicateTypes: typeCount, duplicateDefinitions: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
