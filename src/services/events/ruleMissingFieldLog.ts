import { asc, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import {
  CHEQUE_PRIVATE_FIELDS, NUMERIC_RULE_OPERATORS, TREASURY_PRIVATE_FIELDS,
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
 * listed by the financial health check (`event_rule_treasury_private_fields`). 10.3 package 5: so are the cheque status
 * event's amount and party name (`event_rule_cheque_private_fields`).
 */
export interface RuleMissingNumericField { ruleId: number; eventType: string; field: string; operator: string }

/** the paths each event type's rules may no longer read: the treasury fields and the cheque fields */
function privatePathsOf(eventType: string): RegExp[] {
  return [TREASURY_PRIVATE_FIELDS[eventType]?.path, CHEQUE_PRIVATE_FIELDS[eventType]?.path].filter((p): p is RegExp => p !== undefined);
}

const PRIVATE_FIELD_EVENT_TYPES = [...new Set([...Object.keys(TREASURY_PRIVATE_FIELDS), ...Object.keys(CHEQUE_PRIVATE_FIELDS)])];

function collect(node: unknown, found: Array<{ field: string; operator: string }>, paths: RegExp[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found, paths);
    return;
  }
  if (isSingleRuleNode(node)) {
    const operator = String(node.operator).toLowerCase().trim();
    const field = ruleFieldPath(node.field);
    if (NUMERIC_RULE_OPERATORS.has(operator) && paths.some(p => p.test(field))) found.push({ field, operator });
    return;
  }
  if (isRuleGroupNode(node)) collect(ruleGroupParts(node).children, found, paths);
}

export function rulesOnMissingNumericFields(rules: Array<{ id: number; eventType: string; conditionsJson: unknown }>): RuleMissingNumericField[] {
  const rows: RuleMissingNumericField[] = [];
  for (const rule of rules) {
    const paths = privatePathsOf(rule.eventType);
    if (paths.length === 0) continue;
    const found: Array<{ field: string; operator: string }> = [];
    collect(rule.conditionsJson, found, paths);
    for (const c of found) rows.push({ ruleId: rule.id, eventType: rule.eventType, ...c });
  }
  return rows;
}

/** the rules found, logged once at boot; a read failure is logged and never stops the boot */
export async function logRulesOnMissingNumericFields(): Promise<RuleMissingNumericField[]> {
  try {
    const rules = await orm.select({ id: eventActionRules.id, eventType: eventActionRules.eventType, conditionsJson: eventActionRules.conditionsJson })
      .from(eventActionRules).where(inArray(eventActionRules.eventType, PRIVATE_FIELD_EVENT_TYPES)).orderBy(asc(eventActionRules.id));
    const rows = rulesOnMissingNumericFields(rules);
    const byRule = new Map<number, RuleMissingNumericField[]>();
    for (const r of rows) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);
    for (const [ruleId, found] of byRule) {
      const fields = [...new Set(found.map(f => f.field))].join(', ');
      logger.warn(`[EventActionEngine] Rule #${ruleId} (${found[0].eventType}): a numeric comparison reads ${fields}, which its event no longer carries; review it`);
    }
    return rows;
  } catch (err: unknown) {
    logger.error(`[EventActionEngine] Reading rules for missing numeric fields failed: ${errorMessageOf(err)}`);
    return [];
  }
}
