import { asc, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { eventActionRules, eventActionRuleRetirements } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { RETIRED_RULE_ACTION_TYPES, ruleActionTypeLabel } from '../../lib/events/ruleActionTypes.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.377 (TD-712، تصمیم ت۴ الف): قانون‌هایی که نوع اقدامشان حذف شده است («تحریک گردش کار» و «پیامک»). مهاجرت 0085
 * آن‌ها را غیرفعال و در `event_action_rule_retirements` ثبت کرد؛ تا وقتی نوع اقدامشان عوض یا خودشان حذف نشده‌اند فهرست می‌شوند.
 */
export interface RetiredActionRuleRow {
  ruleId: number;
  name: string;
  actionType: string;
  eventType: string;
  wasActive: boolean;
}

export async function findRetiredActionRules(db: DbExecutor = orm): Promise<RetiredActionRuleRow[]> {
  const rules = await db.select({ id: eventActionRules.id, name: eventActionRules.name, actionType: eventActionRules.actionType, eventType: eventActionRules.eventType })
    .from(eventActionRules)
    .where(inArray(eventActionRules.actionType, [...RETIRED_RULE_ACTION_TYPES]))
    .orderBy(asc(eventActionRules.id));
  if (rules.length === 0) return [];
  const retired = await db.select({ ruleId: eventActionRuleRetirements.ruleId, wasActive: eventActionRuleRetirements.wasActive })
    .from(eventActionRuleRetirements)
    .where(inArray(eventActionRuleRetirements.ruleId, rules.map(r => r.id)));
  const wasActive = new Map(retired.map(r => [r.ruleId, r.wasActive === 1]));
  return rules.map(r => ({ ruleId: r.id, name: r.name, actionType: r.actionType, eventType: r.eventType, wasActive: wasActive.get(r.id) ?? false }));
}

export function buildRetiredRuleActionHealthTest(rows: RetiredActionRuleRow[]): HealthCheckTestResult {
  const count = rows.length;
  return {
    id: 'event_rule_retired_action',
    category: 'system',
    title: 'قانون‌های خودکار با اقدام حذف‌شده',
    description: 'اقدام‌های «تحریک گردش کار» و «پیامک» کاری انجام نمی‌دادند و از سامانه حذف شدند؛ قانون‌هایی که این اقدام را داشتند غیرفعال شدند و تا وقتی نوع اقدامشان عوض یا خودشان حذف نشده‌اند این‌جا فهرست می‌شوند',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(2, count),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} قانون خودکار اقدامی دارد که از سامانه حذف شده است و غیرفعال مانده است؛ در «اقدام‌های خودکار» نوع اقدام آن را به اعلان، وب‌هوک یا ممیزی تغییر دهید و فعالش کنید، یا آن را حذف کنید.`
      : 'هیچ قانون خودکاری اقدام حذف‌شده ندارد.',
    items: rows.map(r => ({
      id: r.ruleId,
      code: `قانون #${toPersianDigits(r.ruleId)}`,
      title: r.name || `قانون #${toPersianDigits(r.ruleId)}`,
      subtitle: `اقدام: ${ruleActionTypeLabel(r.actionType)}؛ رویداد: ${r.eventType}`,
      details: r.wasActive ? 'پیش از نسخه ۹.۰.۳۴۳ فعال بود و مهاجرت آن را غیرفعال کرد (TD-712).' : 'غیرفعال است.',
    })),
    metrics: { retiredActionRules: count, deactivatedByMigration: rows.filter(r => r.wasActive).length },
  };
}
