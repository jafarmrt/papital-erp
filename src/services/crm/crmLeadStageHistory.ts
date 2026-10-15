import type { DbExecutor } from '../../db/drizzle.js';
import { crmLeadStageHistory } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';

/**
 * v10.1.16 (N-02 بخش ۲، تصمیم ت۷ طرح ارتباط با مشتری): هر تغییر مرحله پرونده فروش، در همان تراکنشی که مرحله را عوض
 * می‌کند، یک ردیف تاریخچه دارد: از کدام مرحله به کدام، چه کسی، کی، فروشنده پرونده در آن لحظه و (برای «از دست رفته») دلیل.
 * ساخت پرونده ردیفی با مرحله آغاز `null` است. گزارش قیف (`crmFunnelReport.ts`) فقط از این جدول خوانده می‌شود.
 */
export interface LeadStageChange {
  leadId: number;
  fromStage: string | null | undefined;
  toStage: string;
  assignedPersonnelId: number | null | undefined;
  lostReason?: string | null;
  actor: { id?: number | null; name: string };
}

/** ردیف تاریخچه را فقط وقتی می‌نویسد که مرحله واقعاً عوض شده باشد؛ خروجی true یعنی ردیفی نوشته شد */
export async function recordLeadStageChange(tx: DbExecutor, change: LeadStageChange): Promise<boolean> {
  const from = change.fromStage ? String(change.fromStage) : null;
  if (from === change.toStage) return false;
  await tx.insert(crmLeadStageHistory).values({
    leadId: change.leadId,
    fromStage: from,
    toStage: change.toStage,
    lostReason: change.toStage === 'lost' ? String(change.lostReason ?? '') : '',
    assignedPersonnelId: change.assignedPersonnelId ?? null,
    changedById: change.actor.id ?? null,
    changedByName: change.actor.name || '',
    changedAt: systemNowUtcIso(),
  });
  return true;
}
