import { asc } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import { eventFieldOptions } from '../../lib/eventPayloadFields.js';
import { NUMERIC_RULE_OPERATORS, ruleFieldPath } from '../../lib/events/ruleMissingField.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/index.js';

/**
 * 10.2 package 8 (TD-1297, review N-1): a numeric comparison on a field the event does not carry no longer matches. The
 * boot names once, in the log, each saved rule of a published event type whose numeric comparison reads a payload
 * field that type no longer carries (`eventFieldOptions`, the payload type of each event), so an owner's rule that
 * stopped firing is found; nothing is changed, and the treasury rules are also listed by the financial health check.
 */
export interface RuleMissingNumericField { ruleId: number; eventType: string; field: string; operator: string }

function payloadKeysOf(eventType: string): Set<string> | null {
  const keys = eventFieldOptions(eventType).map(o => o.path).filter(p => p.startsWith('payload.')).map(p => p.slice('payload.'.length));
  return keys.length > 0 ? new Set(keys) : null;
}

function collect(node: unknown, found: Array<{ field: string; operator: string }>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.field === 'string') {
    const operator = String(obj.operator ?? '').toLowerCase().trim();
    if (NUMERIC_RULE_OPERATORS.has(operator)) found.push({ field: ruleFieldPath(obj.field), operator });
    return;
  }
  collect(obj.conditions, found);
  collect(obj.rules, found);
}

export function rulesOnMissingNumericFields(rules: Array<{ id: number; eventType: string; conditionsJson: unknown }>): RuleMissingNumericField[] {
  const rows: RuleMissingNumericField[] = [];
  for (const rule of rules) {
    const keys = payloadKeysOf(rule.eventType);
    if (!keys) continue;
    const found: Array<{ field: string; operator: string }> = [];
    collect(rule.conditionsJson, found);
    for (const c of found) {
      if (!c.field.startsWith('payload.')) continue;
      const key = c.field.slice('payload.'.length).split('.')[0];
      if (!keys.has(key)) rows.push({ ruleId: rule.id, eventType: rule.eventType, ...c });
    }
  }
  return rows;
}

/** the rules found, logged once at boot; a read failure is logged and never stops the boot */
export async function logRulesOnMissingNumericFields(): Promise<RuleMissingNumericField[]> {
  try {
    const rules = await orm.select({ id: eventActionRules.id, eventType: eventActionRules.eventType, conditionsJson: eventActionRules.conditionsJson })
      .from(eventActionRules).orderBy(asc(eventActionRules.id));
    const rows = rulesOnMissingNumericFields(rules);
    for (const r of rows) {
      logger.warn(`[EventActionEngine] Rule #${r.ruleId} (${r.eventType}) compares ${r.field} with "${r.operator}", a field this event does not carry; the condition never matches`);
    }
    return rows;
  } catch (err: unknown) {
    logger.error(`[EventActionEngine] Reading rules for missing numeric fields failed: ${errorMessageOf(err)}`);
    return [];
  }
}
