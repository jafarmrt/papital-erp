import { and, asc, eq, or, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowStates, workflowTransitions } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { recordDefinitionVersion } from './workflowSnapshot.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * v9.0.35 (TD-445، یافته B14-03، تصمیم مالک محصول ت۲ «فقط مجوز»): گام‌های گردش‌کار پیش‌فرض اسناد با مجوز بسته می‌شوند،
 * نه با کد نقش (مدل مجوز بسته ۲): بررسی انبار و رد آن `warehouse.out`، بررسی مالی و رد آن `accounting.vouchers`،
 * تأیید مستقیم `workflow.admin`؛ ارسال به انبار و بازگشایی برای همه. پیش‌تر هر سه گام بی نقش و بی مجوز بود و فروشنده
 * پیش‌فاکتور خودش را از هر سه گام می‌گذراند و قطعی می‌کرد.
 */
export const DOC_APPROVAL_WORKFLOW_CODE = 'DOC_APPROVAL_WORKFLOW';

interface StepGuard { from: string; to: string; actionKey: string; title: string; requiredRole: string; requiredPermission: string }

/** نگهبان گام‌ها در seed تازه (from، to و کلید اقدام همان seed پیشین است) */
export const DOC_APPROVAL_STEP_GUARDS: ReadonlyArray<StepGuard> = [
  { from: 'draft', to: 'warehouse_review', actionKey: 'submit_to_warehouse', title: 'ارسال به انبار جهت تایید اقلام', requiredRole: '', requiredPermission: '' },
  { from: 'warehouse_review', to: 'accounting_review', actionKey: 'approve_warehouse', title: 'تایید انبارداری و تحویل کالا', requiredRole: '', requiredPermission: 'warehouse.out' },
  { from: 'accounting_review', to: 'approved', actionKey: 'approve_accounting', title: 'تایید نهایی واحد مالی و صدور سند', requiredRole: '', requiredPermission: 'accounting.vouchers' },
  { from: 'warehouse_review', to: 'rejected', actionKey: 'reject', title: 'رد پیش‌فاکتور توسط انبار', requiredRole: '', requiredPermission: 'warehouse.out' },
  { from: 'accounting_review', to: 'rejected', actionKey: 'reject', title: 'رد پیش‌فاکتور توسط مالی', requiredRole: '', requiredPermission: 'accounting.vouchers' },
  { from: 'rejected', to: 'draft', actionKey: 'reopen', title: 'بازگشایی مجدد جهت اصلاح', requiredRole: '', requiredPermission: '' },
  { from: 'draft', to: 'approved', actionKey: 'direct_approve', title: 'تایید مستقیم مدیریتی', requiredRole: '', requiredPermission: 'workflow.admin' },
];

/** نگهبان گام‌ها در seed پیش از v9.0.35؛ فقط تعریفی که دقیقاً همین است (دست‌نخورده) خودکار به‌روز می‌شود */
const LEGACY_DOC_APPROVAL_GUARDS: ReadonlyArray<StepGuard> = DOC_APPROVAL_STEP_GUARDS.map(g => ({
  ...g,
  requiredRole: g.actionKey === 'direct_approve' ? SYSTEM_ADMIN_ROLE : '',
  requiredPermission: g.actionKey === 'direct_approve' ? 'workflow.approve' : '',
}));

const LEGACY_STATE_KEYS = ['accounting_review', 'approved', 'draft', 'rejected', 'warehouse_review'];

const guardKey = (g: Pick<StepGuard, 'from' | 'to' | 'actionKey'>) => `${g.from}>${g.to}>${g.actionKey}`;

/**
 * تعریف `DOC_APPROVAL_WORKFLOW` نصب موجود را، فقط اگر از seed پیشین دست نخورده باشد، به نگهبان‌های تازه می‌برد: همان
 * ردیف‌های گام و اقدام (شناسه‌ها عوض نمی‌شوند) و یک نسخه تازه تعریف برای فرایندهای بعدی؛ فرایندهای در جریان با تصویر خود
 * ادامه می‌دهند (قاعده v7.0.87) و اقدام دامنه‌شان را ت۳ می‌سنجد. تعریف ویرایش‌شده دست نمی‌خورد و اگر گام تأیید بی نگهبان
 * داشته باشد در بررسی سلامت فهرست می‌شود. خروجی: به‌روز شد یا نه.
 */
export async function upgradeLegacyDocApprovalGuards(): Promise<boolean> {
  return orm.transaction(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions)
      .where(eq(workflowDefinitions.code, DOC_APPROVAL_WORKFLOW_CODE)).for('update');
    if (!def) return false;
    const states = await tx.select({ id: workflowStates.id, stateKey: workflowStates.stateKey })
      .from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
    const keyOf = new Map(states.map(s => [s.id, s.stateKey]));
    if (states.map(s => s.stateKey).sort().join(',') !== LEGACY_STATE_KEYS.join(',')) return false;
    const transitions = await tx.select().from(workflowTransitions)
      .where(eq(workflowTransitions.workflowDefinitionId, def.id)).orderBy(asc(workflowTransitions.id));
    if (transitions.length !== LEGACY_DOC_APPROVAL_GUARDS.length) return false;

    const legacyByKey = new Map(LEGACY_DOC_APPROVAL_GUARDS.map(g => [guardKey(g), g]));
    const seen = new Set<string>();
    for (const t of transitions) {
      const key = guardKey({ from: keyOf.get(t.fromStateId) ?? '', to: keyOf.get(t.toStateId) ?? '', actionKey: t.actionKey });
      const legacy = legacyByKey.get(key);
      const rules = Array.isArray(t.ruleConditionsJson) ? t.ruleConditionsJson : [];
      const untouched = legacy && !seen.has(key)
        && (t.title ?? '') === legacy.title && (t.requiredRole ?? '') === legacy.requiredRole && (t.requiredPermission ?? '') === legacy.requiredPermission
        && (t.approvalRuleType ?? 'SINGLE') === 'SINGLE' && rules.length === 0 && !(t.autoActionKey ?? '')
        && Number(t.isInitiatorExcluded ?? 0) === 0;
      if (!untouched) return false;
      seen.add(key);
    }

    const guardByKey = new Map(DOC_APPROVAL_STEP_GUARDS.map(g => [guardKey(g), g]));
    for (const t of transitions) {
      const guard = guardByKey.get(guardKey({ from: keyOf.get(t.fromStateId) ?? '', to: keyOf.get(t.toStateId) ?? '', actionKey: t.actionKey }));
      if (!guard) return false;
      await tx.update(workflowTransitions)
        .set({ requiredRole: guard.requiredRole, requiredPermission: guard.requiredPermission })
        .where(eq(workflowTransitions.id, t.id));
    }
    await recordDefinitionVersion(tx, def.id, {
      title: def.title,
      description: 'مجوز گام‌های بررسی انبار، بررسی مالی و تأیید مستقیم',
    });
    return true;
  });
}

export interface UnguardedDocumentApprovalRow {
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
}

/**
 * اقدام‌های تعریف فعال اسناد که سند را قطعی می‌کنند (گام مقصد `approved` یا اقدام خودکار `POST_INVOICE`) و نه نقش دارند
 * نه مجوز؛ چنین گامی برای هر دارنده `workflow.approve` باز است و فقط مجوز موجودیت (ت۳) جلوی آن است
 */
export async function findUnguardedDocumentApprovals(db: DbExecutor = orm): Promise<UnguardedDocumentApprovalRow[]> {
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
      or(eq(workflowStates.stateKey, 'approved'), eq(workflowTransitions.autoActionKey, 'POST_INVOICE')),
      sql`btrim(coalesce(${workflowTransitions.requiredRole}, '')) = ''`,
      sql`btrim(coalesce(${workflowTransitions.requiredPermission}, '')) = ''`,
    ))
    .orderBy(asc(workflowDefinitions.id), asc(workflowTransitions.id));
  return rows.map(r => ({ ...r, title: r.title ?? '', transitionTitle: r.transitionTitle ?? '' }));
}

export function buildUnguardedDocumentApprovalHealthTest(rows: UnguardedDocumentApprovalRow[]): HealthCheckTestResult {
  const definitionCount = new Set(rows.map(r => r.definitionId)).size;
  return {
    id: 'workflow_unguarded_document_approval',
    category: 'system',
    title: 'گام تأیید بی‌مجوز در گردش کار اسناد',
    description: 'هر اقدامی که در گردش کار فعال اسناد سند را قطعی می‌کند باید نقش یا مجوز داشته باشد؛ گردش کار پیش‌فرض دست‌نخورده خودکار به‌روز می‌شود و گردش کار ویرایش‌شده فقط این‌جا فهرست می‌شود',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} اقدام در ${definitionCount} گردش کار اسناد بی نقش و بی مجوز سند را قطعی می‌کند؛ در طراح گردش کار برای این اقدام‌ها مجوز بگذارید.`
      : 'همه اقدام‌هایی که در گردش کار اسناد سند را قطعی می‌کنند نقش یا مجوز دارند.',
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
