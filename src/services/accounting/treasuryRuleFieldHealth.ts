import { asc, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * 10.2 package 8 (TD-1297): since the treasury event («ثبت یا ابطال تراکنش خزانه») carries no amount, description or
 * void reason, a rule of that event (or of every event) that reads one of them in its conditions or its action never
 * matches or prints it empty, like the seeded «ثبت ممیزی تراکنش‌های کلان خزانه‌داری» on `payload.amount`. Saved rules
 * are never rewritten (TD-715); such a rule is only listed here until its condition or text changes or it is deleted.
 */
export interface TreasuryPrivateFieldRuleRow {
  ruleId: number;
  name: string;
  isActive: boolean;
  fields: string[];
}

const TREASURY_PRIVATE_FIELD = /payload\.(amount|description|reason)\b/g;

export function treasuryPrivateFieldsOf(conditions: unknown, actionConfig: unknown): string[] {
  const text = `${JSON.stringify(conditions ?? [])} ${JSON.stringify(actionConfig ?? {})}`;
  return [...new Set([...text.matchAll(TREASURY_PRIVATE_FIELD)].map(m => m[0]))].sort();
}

/** the treasury event type (`DomainEventType.TREASURY_TRANSACTION_APPROVED`) and «همه رویدادها» */
const TREASURY_RULE_EVENT_TYPES = ['TreasuryTransactionApproved', '*'];

export async function findTreasuryPrivateFieldRules(): Promise<TreasuryPrivateFieldRuleRow[]> {
  const rules = await orm.select({
    id: eventActionRules.id, name: eventActionRules.name, isActive: eventActionRules.isActive,
    conditionsJson: eventActionRules.conditionsJson, actionConfigJson: eventActionRules.actionConfigJson,
  }).from(eventActionRules)
    .where(inArray(eventActionRules.eventType, TREASURY_RULE_EVENT_TYPES))
    .orderBy(asc(eventActionRules.id));
  return rules
    .map(r => ({ ruleId: r.id, name: r.name, isActive: r.isActive === 1, fields: treasuryPrivateFieldsOf(r.conditionsJson, r.actionConfigJson) }))
    .filter(r => r.fields.length > 0);
}

export function buildTreasuryPrivateFieldRuleHealthTest(rows: TreasuryPrivateFieldRuleRow[]): HealthCheckTestResult {
  const count = rows.length;
  const active = rows.filter(r => r.isActive).length;
  return {
    id: 'event_rule_treasury_private_fields',
    category: 'system',
    title: 'قانون‌های خودکار خزانه که مبلغ یا شرح می‌خوانند',
    description: 'رویداد تراکنش خزانه دیگر مبلغ، شرح و دلیل ابطال ندارد؛ قانونی که این‌ها را می‌خواند هرگز برقرار نمی‌شود یا متنش خالی می‌ماند و تا وقتی شرط یا متن آن عوض نشده این‌جا فهرست می‌شود',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count,
    message: count > 0
      ? `${toPersianDigits(count)} قانون خودکار (${toPersianDigits(active)} فعال) مبلغ یا شرح تراکنش خزانه را می‌خواند که رویداد دیگر ندارد؛ در «اقدام‌های خودکار» شرط آن را عوض کنید یا قانون را حذف کنید.`
      : 'هیچ قانون خودکاری مبلغ یا شرح تراکنش خزانه را نمی‌خواند.',
    items: rows.map(r => ({
      id: r.ruleId,
      code: `قانون #${toPersianDigits(r.ruleId)}`,
      title: r.name || `قانون #${toPersianDigits(r.ruleId)}`,
      subtitle: `بخش‌های ناموجود: ${r.fields.join('، ')}`,
      details: r.isActive ? 'فعال است، ولی دیگر برقرار نمی‌شود.' : 'غیرفعال است.',
    })),
    metrics: { treasuryPrivateFieldRules: count, activeTreasuryPrivateFieldRules: active },
  };
}
