import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowStates, workflowTransitions } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v10.0.120 (TD-1220، یافته B-01 آزمون راهنما): اقدام‌های گردش کار فعال اسناد که سند را قطعی نمی‌کنند (ارسال به انبار،
 * بازگشایی و مانند آن‌ها) و نه نقش دارند نه مجوز. اقدام قطعی‌سازی را بررسی `workflow_unguarded_document_approval` فهرست
 * می‌کند. تعریف پیش‌فرض دست‌نخورده هنگام راه‌اندازی ارتقا می‌یابد؛ تعریف ویرایش‌شده دست نمی‌خورد و فقط این‌جا فهرست
 * می‌شود. فقط جدول‌های گردش کار را می‌خواند و از بسته گردش کار import نمی‌کند (تصمیم ت۳ الف فاز ۲).
 */
export interface UnguardedDocumentStepRow {
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
}

export async function findUnguardedDocumentSteps(db: DbExecutor): Promise<UnguardedDocumentStepRow[]> {
  const rows = await db.select({
    definitionId: workflowDefinitions.id,
    code: workflowDefinitions.code,
    title: workflowDefinitions.title,
    transitionId: workflowTransitions.id,
    transitionTitle: workflowTransitions.title,
  })
    .from(workflowTransitions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowTransitions.workflowDefinitionId))
    .innerJoin(workflowStates, eq(workflowStates.id, workflowTransitions.toStateId))
    .where(and(
      eq(workflowDefinitions.entityType, 'document'),
      eq(workflowDefinitions.isActive, 1),
      sql`${workflowStates.stateKey} <> 'approved'`,
      sql`coalesce(${workflowTransitions.autoActionKey}, '') <> 'POST_INVOICE'`,
      sql`btrim(coalesce(${workflowTransitions.requiredRole}, '')) = ''`,
      sql`btrim(coalesce(${workflowTransitions.requiredPermission}, '')) = ''`,
    ))
    .orderBy(asc(workflowDefinitions.id), asc(workflowTransitions.id));
  return rows.map(r => ({ ...r, title: r.title ?? '', transitionTitle: r.transitionTitle ?? '' }));
}

export function buildUnguardedDocumentStepHealthTest(rows: UnguardedDocumentStepRow[]): HealthCheckTestResult {
  const definitionCount = new Set(rows.map(r => r.definitionId)).size;
  return {
    id: 'workflow_unguarded_document_step',
    category: 'system',
    title: 'گام بی‌مجوز در گردش کار اسناد',
    description: 'هر اقدام گردش کار فعال اسناد، مانند ارسال به انبار و بازگشایی، باید نقش یا مجوز داشته باشد؛ گردش کار پیش‌فرض دست‌نخورده خودکار به‌روز می‌شود و گردش کار ویرایش‌شده فقط این‌جا فهرست می‌شود',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} اقدام در ${definitionCount} گردش کار اسناد نه نقش دارد نه مجوز؛ در طراح گردش کار برای این اقدام‌ها مجوز بگذارید و برای ارسال به انبار «فقط آغازکننده اجرا کند» را بزنید.`
      : 'همه اقدام‌های گردش کار اسناد نقش یا مجوز دارند.',
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
