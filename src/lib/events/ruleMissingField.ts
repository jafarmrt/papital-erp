/**
 * 10.2 package 8 (TD-1297): how a saved rule condition reads a field its event does not carry, shared by the financial
 * health check of treasury rules and the boot log of rules on missing fields (the rule engine is
 * `RuleEngineService.evaluateSingleRule`; these helpers follow it and a Vitest test compares them).
 */
/** the numeric comparisons, which never match a field the event does not carry */
export const NUMERIC_RULE_OPERATORS: ReadonlySet<string> = new Set(['>', 'gt', '>=', 'gte', '<', 'lt', '<=', 'lte']);

/** a condition field as the rule engine reads it (`resolvePath`): `event.` / `context.` dropped, `[0]` as `.0` */
export function ruleFieldPath(field: string): string {
  return field.trim().replace(/^event\./, '').replace(/^context\./, '').replace(/\[(\d+)\]/g, '.$1');
}

function listOf(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map(s => s.trim());
  return null;
}

/**
 * what one condition gives on a field the event does not carry, the same answer as `RuleEngineService.evaluateSingleRule`
 * (Vitest `treasuryRuleHealthTd1297.test.ts` compares the two for every operator): a numeric comparison is false, «not
 * equal» / «not in» are true unless the value is empty, an equality, «in», «contains» or a pattern is true only when
 * it matches empty text, and the absence checks are true
 */
export function missingFieldOutcome(operator: unknown, value: unknown): boolean {
  const op = String(operator || '=').toLowerCase().trim();
  const empty = String(value ?? '') === '';
  switch (op) {
    case '=': case '==': case 'eq': case 'equal': return empty;
    case '!=': case 'neq': case 'not_equal': return !empty;
    case 'in': return listOf(value)?.includes('') ?? false;
    case 'not_in': case 'nin': { const list = listOf(value); return list ? !list.includes('') : true; }
    case 'contains': case 'like': case 'includes': return empty;
    case 'is_empty': case 'empty': case 'not_exists': return true;
    case 'regex': case 'regexp':
      try { return new RegExp(String(value), 'i').test(''); } catch { return false; }
    default: return false;
  }
}
