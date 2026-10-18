import { asc, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import {
  NUMERIC_RULE_OPERATORS, TREASURY_PRIVATE_FIELD_PATH, TREASURY_RULE_EVENT_TYPES,
  isRuleGroupNode, isSingleRuleNode, ruleFieldPath, ruleGroupParts,
} from '../../lib/events/ruleMissingField.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/index.js';

/**
 * 10.2 package 8 (TD-1297, review N-1): a numeric comparison on a field the event does not carry no longer matches. The
 * boot names once, in the log (one line per rule), each saved rule of the treasury event (or of every event) whose numeric comparison reads
 * a field this release took out of that event (amount, description, void reason), so an owner's rule whose behaviour may have
 * changed is reviewed. Only those fields are named: the declared payload lists leave out keys some emitters still
 * send, so a wider check would warn about working rules on every boot. Nothing is changed, and the same rules are
 * listed by the financial health check (`event_rule_treasury_private_fields`).
 */
export interface RuleMissingNumericField { ruleId: number; eventType: string; field: string; operator: string }

function collect(node: unknown, found: Array<{ field: string; operator: string }>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return;
  }
  if (isSingleRuleNode(node)) {
    const operator = String(node.operator).toLowerCase().trim();
    const field = ruleFieldPath(node.field);
    if (NUMERIC_RULE_OPERATORS.has(operator) && TREASURY_PRIVATE_FIELD_PATH.test(field)) found.push({ field, operator });
    return;
  }
  if (isRuleGroupNode(node)) collect(ruleGroupParts(node).children, found);
}

export function rulesOnMissingNumericFields(rules: Array<{ id: number; eventType: string; conditionsJson: unknown }>): RuleMissingNumericField[] {
  const rows: RuleMissingNumericField[] = [];
  for (const rule of rules) {
    if (!TREASURY_RULE_EVENT_TYPES.includes(rule.eventType)) continue;
    const found: Array<{ field: string; operator: string }> = [];
    collect(rule.conditionsJson, found);
    for (const c of found) rows.push({ ruleId: rule.id, eventType: rule.eventType, ...c });
  }
  return rows;
}

/** the rules found, logged once at boot; a read failure is logged and never stops the boot */
export async function logRulesOnMissingNumericFields(): Promise<RuleMissingNumericField[]> {
  try {
    const rules = await orm.select({ id: eventActionRules.id, eventType: eventActionRules.eventType, conditionsJson: eventActionRules.conditionsJson })
      .from(eventActionRules).where(inArray(eventActionRules.eventType, [...TREASURY_RULE_EVENT_TYPES])).orderBy(asc(eventActionRules.id));
    const rows = rulesOnMissingNumericFields(rules);
    const byRule = new Map<number, RuleMissingNumericField[]>();
    for (const r of rows) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);
    for (const [ruleId, found] of byRule) {
      const fields = [...new Set(found.map(f => f.field))].join(', ');
      logger.warn(`[EventActionEngine] Rule #${ruleId} (${found[0].eventType}): a numeric comparison reads ${fields}, which treasury events no longer carry; review it`);
    }
    return rows;
  } catch (err: unknown) {
    logger.error(`[EventActionEngine] Reading rules for missing numeric fields failed: ${errorMessageOf(err)}`);
    return [];
  }
}
