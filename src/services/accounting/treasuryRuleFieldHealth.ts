import { asc, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { missingFieldOutcome, ruleFieldPath } from '../../lib/events/ruleMissingField.js';

/**
 * 10.2 package 8 (TD-1297): since the treasury event («ثبت یا ابطال تراکنش خزانه») carries no amount, description or
 * void reason, a rule of that event (or of every event) that reads one of them changes how it behaves. Each condition on
 * such a field is now fixed at what it gives on a missing field (`missingFieldOutcome`): a numeric comparison, an
 * equality or «in» with a value no longer passes, so the rule stops firing; «not equal», «not in», an absence check
 * (`is_empty`, `empty`, `not_exists`), an empty «contains» or pattern now passes on every treasury event, and so does
 * a failing part under a «NOT» group, so that rule may fire on each one (the `event.payload.` spelling counts too); a
 * field read only in the action's text prints empty. Saved rules are never rewritten (TD-715) except the seeded high-value rule, which the boot moves
 * to `payload.isHighValue` once; any other such rule is listed here, by kind, until its condition or text changes or
 * it is deleted. A rule whose condition now matches every time lowers the score.
 */
export type TreasuryPrivateFieldUse = 'always_matches' | 'never_matches' | 'text_only';

export interface TreasuryPrivateFieldRuleRow {
  ruleId: number;
  name: string;
  isActive: boolean;
  fields: string[];
  use: TreasuryPrivateFieldUse;
}

const TREASURY_PRIVATE_FIELD = /payload\.(amount|description|reason)\b/g;
const PRIVATE_FIELD_EXACT = /^payload\.(amount|description|reason)(\.|$)/;

interface PrivateConditionUse { fields: string[]; alwaysMatches: boolean; neverMatches: boolean }

/**
 * review N-2: a condition on such a field is now fixed at its missing-field outcome; inside a «NOT» group a fixed false
 * lets the rule pass, so the walk keeps the polarity of the groups above it. A part fixed at «passes» means the rule
 * may fire on every treasury event, one fixed at «fails» that it no longer does.
 */
function walkConditions(node: unknown, negated: boolean, found: PrivateConditionUse): void {
  if (Array.isArray(node)) {
    for (const child of node) walkConditions(child, negated, found);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.field === 'string') {
    const field = ruleFieldPath(obj.field);
    if (!PRIVATE_FIELD_EXACT.test(field)) return;
    found.fields.push(field);
    if (missingFieldOutcome(obj.operator, obj.value) !== negated) found.alwaysMatches = true;
    else found.neverMatches = true;
    return;
  }
  const isNot = String(obj.logic ?? obj.matchType ?? '').toUpperCase().trim() === 'NOT';
  walkConditions(obj.conditions, negated !== isNot, found);
  walkConditions(obj.rules, negated !== isNot, found);
}

export function treasuryPrivateFieldUseOf(conditions: unknown, actionConfig: unknown): { fields: string[]; use: TreasuryPrivateFieldUse } | null {
  const found: PrivateConditionUse = { fields: [], alwaysMatches: false, neverMatches: false };
  walkConditions(conditions, false, found);
  const textFields = [...JSON.stringify(actionConfig ?? {}).matchAll(TREASURY_PRIVATE_FIELD)].map(m => m[0]);
  const fields = [...new Set([...found.fields, ...textFields])].sort();
  if (fields.length === 0) return null;
  const use: TreasuryPrivateFieldUse = found.alwaysMatches ? 'always_matches' : found.neverMatches ? 'never_matches' : 'text_only';
  return { fields, use };
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
  const rows: TreasuryPrivateFieldRuleRow[] = [];
  for (const r of rules) {
    const found = treasuryPrivateFieldUseOf(r.conditionsJson, r.actionConfigJson);
    if (found) rows.push({ ruleId: r.id, name: r.name, isActive: r.isActive === 1, ...found });
  }
  return rows;
}

const USE_DETAILS: Record<TreasuryPrivateFieldUse, string> = {
  always_matches: 'شرط روی این بخش (مثل «برابر نیست»، «در فهرست نیست»، «خالی است» یا شرطی درون گروه «نه») اکنون در هر تراکنش خزانه برقرار است، پس قانون ممکن است با هر تراکنش اجرا شود.',
  never_matches: 'شرط روی این بخش (مثل «بزرگ‌تر از»، «کوچک‌تر از» یا «برابر است») دیگر هرگز برقرار نمی‌شود.',
  text_only: 'این بخش در متن اقدام خالی چاپ می‌شود.',
};

export function buildTreasuryPrivateFieldRuleHealthTest(rows: TreasuryPrivateFieldRuleRow[]): HealthCheckTestResult {
  const count = rows.length;
  const active = rows.filter(r => r.isActive).length;
  const activeAlways = rows.filter(r => r.isActive && r.use === 'always_matches').length;
  const always = rows.filter(r => r.use === 'always_matches').length;
  return {
    id: 'event_rule_treasury_private_fields',
    category: 'system',
    title: 'قانون‌های خودکار خزانه که مبلغ یا شرح می‌خوانند',
    description: 'رویداد تراکنش خزانه دیگر مبلغ، شرح و دلیل ابطال ندارد؛ شرط «بزرگ‌تر»، «کوچک‌تر» یا «برابر» روی آن‌ها دیگر برقرار نمی‌شود، شرط «برابر نیست»، «در فهرست نیست» یا «خالی است» آن‌ها در هر تراکنش برقرار است و متن اقدام آن‌ها را خالی چاپ می‌کند. چنین قانونی تا وقتی شرط یا متن آن عوض نشده این‌جا فهرست می‌شود',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, activeAlways * 2),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} قانون خودکار (${toPersianDigits(active)} فعال) مبلغ یا شرح تراکنش خزانه را می‌خواند که رویداد دیگر ندارد${always > 0 ? `؛ شرط ${toPersianDigits(always)} قانون اکنون در هر تراکنش برقرار است` : ''}. در «اقدام‌های خودکار» شرط آن را عوض کنید یا قانون را حذف کنید.`
      : 'هیچ قانون خودکاری مبلغ یا شرح تراکنش خزانه را نمی‌خواند.',
    items: rows.map(r => ({
      id: r.ruleId,
      code: `قانون #${toPersianDigits(r.ruleId)}`,
      title: r.name || `قانون #${toPersianDigits(r.ruleId)}`,
      subtitle: `بخش‌های ناموجود: ${r.fields.join('، ')}`,
      details: `${r.isActive ? 'فعال است.' : 'غیرفعال است.'} ${USE_DETAILS[r.use]}`,
    })),
    metrics: { treasuryPrivateFieldRules: count, activeTreasuryPrivateFieldRules: active, alwaysMatchingTreasuryRules: always },
  };
}
