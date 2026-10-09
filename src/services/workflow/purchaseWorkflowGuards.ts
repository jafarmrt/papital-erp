import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowTransitions } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import type { SeedGuardUpgrade, SeedStepGuard } from './seedGuardUpgrade.js';

/**
 * v10.0.23 (OBS-R2-36 از TD-992، طرح حقوق و تفکیک وظایف ت۱۱ «الف»): نگهبان گام‌های گردش کار پیش‌فرض درخواست خرید.
 * «تأیید و صدور دستور خرید» `procurement.approve` می‌خواهد و آغازکننده درخواست آن را تأیید نمی‌کند (TD-392؛ مدیر سیستم
 * مستثناست)؛ «تحویل و ورود به انبار» `warehouse.in` (همان کلیدی که اقدام دامنه از TD-904 می‌خواهد)؛ رد و لغو
 * `procurement.approve`؛ بازگشایی `procurement.create`. پیش‌تر هیچ اقدامی نقش یا مجوز نداشت و هر کاربر گردش کار درخواست
 * خودش را تأیید می‌کرد.
 */
export const PURCHASE_REQUISITION_WORKFLOW_CODE = 'PURCHASE_REQUISITION_WORKFLOW';

export const PURCHASE_REQUISITION_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = [
  { from: 'pending', to: 'ordered', actionKey: 'approve_request', title: 'تایید و صدور دستور خرید', requiredRole: '', requiredPermission: 'procurement.approve', isInitiatorExcluded: true },
  { from: 'ordered', to: 'received', actionKey: 'receive_items', title: 'تحویل و ورود به انبار', requiredRole: '', requiredPermission: 'warehouse.in' },
  { from: 'pending', to: 'rejected', actionKey: 'reject_request', title: 'رد درخواست خرید', requiredRole: '', requiredPermission: 'procurement.approve' },
  { from: 'ordered', to: 'rejected', actionKey: 'cancel_order', title: 'لغو یا رد سفارش', requiredRole: '', requiredPermission: 'procurement.approve' },
  { from: 'rejected', to: 'pending', actionKey: 'reopen', title: 'بازگشایی و بررسی مجدد', requiredRole: '', requiredPermission: 'procurement.create' },
];

/** seed پیش از v10.0.23: هیچ اقدامی نقش و مجوز نداشت */
const LEGACY_PURCHASE_REQUISITION_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = PURCHASE_REQUISITION_STEP_GUARDS.map(g => ({
  ...g, requiredPermission: '', isInitiatorExcluded: false,
}));

export const PURCHASE_REQUISITION_GUARD_UPGRADE: SeedGuardUpgrade = {
  code: PURCHASE_REQUISITION_WORKFLOW_CODE,
  stateKeys: ['pending', 'ordered', 'received', 'rejected'],
  legacy: LEGACY_PURCHASE_REQUISITION_STEP_GUARDS,
  next: PURCHASE_REQUISITION_STEP_GUARDS,
  versionDescription: 'تأیید، رد و لغو با «تایید کارتابلی درخواست‌های خرید» و بی آغازکننده؛ تحویل با «ورود کالا به انبار»؛ بازگشایی با «ثبت درخواست خرید جدید»',
};

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
export async function findUnguardedPurchaseActions(db: DbExecutor = orm): Promise<UnguardedPurchaseActionRow[]> {
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
