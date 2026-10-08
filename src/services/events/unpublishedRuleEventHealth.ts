import { asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { isSubscribableEventPattern } from '../../lib/events/eventTypeCatalog.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.406 (TD-726، تصمیم ت۳ الف): قانون‌های خودکاری که رویداد فعال‌کننده‌شان را سامانه منتشر نمی‌کند (`InvoiceCancelled`،
 * `ChequeStatusChanged`، `ProjectStageCompleted`، `CustomerCreated` … که ویرایشگر پیش‌تر پیشنهاد می‌داد). چنین قانونی هرگز
 * اجرا نشده است؛ داده بازنویسی نمی‌شود و قانون فقط فهرست می‌شود تا رویدادش عوض یا خودش حذف شود.
 */
export interface UnpublishedEventRuleRow {
  ruleId: number;
  name: string;
  eventType: string;
  isActive: boolean;
}

export async function findRulesWithUnpublishedEvent(db: DbExecutor = orm): Promise<UnpublishedEventRuleRow[]> {
  const rules = await db.select({ id: eventActionRules.id, name: eventActionRules.name, eventType: eventActionRules.eventType, isActive: eventActionRules.isActive })
    .from(eventActionRules)
    .orderBy(asc(eventActionRules.id));
  return rules
    .filter(r => !isSubscribableEventPattern(r.eventType))
    .map(r => ({ ruleId: r.id, name: r.name, eventType: r.eventType, isActive: r.isActive === 1 }));
}

export function buildUnpublishedRuleEventHealthTest(rows: UnpublishedEventRuleRow[]): HealthCheckTestResult {
  const count = rows.length;
  const active = rows.filter(r => r.isActive).length;
  return {
    id: 'event_rule_unpublished_event_type',
    category: 'system',
    title: 'قانون‌های خودکار با رویدادی که منتشر نمی‌شود',
    description: 'رویداد فعال‌کننده این قانون‌ها در سامانه منتشر نمی‌شود، پس هرگز اجرا نشده‌اند؛ تا وقتی رویدادشان عوض یا خودشان حذف نشده‌اند این‌جا فهرست می‌شوند',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(2, active),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} قانون خودکار (${toPersianDigits(active)} فعال) برای رویدادی است که سامانه منتشر نمی‌کند؛ در «اقدام‌های خودکار» رویداد فعال‌کننده آن را از فهرست برگزینید یا قانون را حذف کنید.`
      : 'رویداد همه قانون‌های خودکار در سامانه منتشر می‌شود.',
    items: rows.map(r => ({
      id: r.ruleId,
      code: `قانون #${toPersianDigits(r.ruleId)}`,
      title: r.name || `قانون #${toPersianDigits(r.ruleId)}`,
      subtitle: `رویداد: ${r.eventType}`,
      details: r.isActive ? 'فعال است، ولی هرگز اجرا نمی‌شود.' : 'غیرفعال است.',
    })),
    metrics: { unpublishedEventRules: count, activeUnpublishedEventRules: active },
  };
}
