import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowTransitions } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v10.0.37 (OBS-R2-36): بررسی سلامت اقدام‌های بی نقش و بی مجوز گردش کار درخواست خرید. فقط جدول‌های گردش کار را می‌خواند
 * و از بسته گردش کار import نمی‌کند، تا بررسی سلامت حسابداری جهت بسته‌ها را نگه دارد (تصمیم ت۳ الف).
 */
export interface UnguardedPurchaseActionRow {
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
}

/**
 * اقدام‌های گردش کار فعال درخواست خرید که نه نقش دارند نه مجوز. تعریف پیش‌فرض دست‌نخورده هنگام راه‌اندازی ارتقا
 * می‌یابد؛ تعریف ویرایش‌شده دست نمی‌خورد و فقط در بررسی سلامت فهرست می‌شود تا مدیر سیستم برایش مجوز بگذارد.
 */
export async function findUnguardedPurchaseActions(db: DbExecutor): Promise<UnguardedPurchaseActionRow[]> {
  const rows = await db.select({
    definitionId: workflowDefinitions.id,
    code: workflowDefinitions.code,
    title: workflowDefinitions.title,
    transitionId: workflowTransitions.id,
    transitionTitle: workflowTransitions.title,
  })
    .from(workflowTransitions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowTransitions.workflowDefinitionId))
    .where(and(
      eq(workflowDefinitions.entityType, 'purchase_requisition'),
      eq(workflowDefinitions.isActive, 1),
      sql`btrim(coalesce(${workflowTransitions.requiredRole}, '')) = ''`,
      sql`btrim(coalesce(${workflowTransitions.requiredPermission}, '')) = ''`,
    ))
    .orderBy(asc(workflowDefinitions.id), asc(workflowTransitions.id));
  return rows.map(r => ({ ...r, title: r.title ?? '', transitionTitle: r.transitionTitle ?? '' }));
}

export function buildUnguardedPurchaseActionHealthTest(rows: UnguardedPurchaseActionRow[]): HealthCheckTestResult {
  const definitionCount = new Set(rows.map(r => r.definitionId)).size;
  return {
    id: 'workflow_unguarded_purchase_action',
    category: 'system',
    title: 'اقدام بی‌مجوز در گردش کار درخواست خرید',
    description: 'هر اقدام گردش کار فعال درخواست خرید باید نقش یا مجوز داشته باشد؛ گردش کار پیش‌فرض دست‌نخورده خودکار به‌روز می‌شود و گردش کار ویرایش‌شده فقط این‌جا فهرست می‌شود',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} اقدام در ${definitionCount} گردش کار درخواست خرید نه نقش دارد نه مجوز؛ در طراح گردش کار برای این اقدام‌ها مجوز بگذارید.`
      : 'همه اقدام‌های گردش کار درخواست خرید نقش یا مجوز دارند.',
    items: rows.map(r => ({
      id: r.transitionId,
      code: r.code,
      title: r.title,
      subtitle: `اقدام: ${r.transitionTitle}`,
      details: 'این اقدام نه نقش دارد نه مجوز؛ برای آن مجوز تعیین کنید.',
    })),
    metrics: { unguardedTransitions: rows.length, definitions: definitionCount },
  };
}
