/**
 * 10.2 package 8 (TD-1297): how a saved rule condition reads a field its event does not carry, shared by the financial
 * health check of treasury rules and the boot log of rules on missing fields (the rule engine is
 * `RuleEngineService.evaluateSingleRule`; these helpers follow it and a Vitest test compares them).
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** a single condition as the rule engine reads it: a non-empty field and an operator (review N-3) */
export function isSingleRuleNode(node: unknown): node is Record<string, unknown> & { field: string } {
  return isPlainObject(node) && typeof node.field === 'string' && node.field.trim() !== '' && node.operator !== undefined && node.operator !== null;
}

/** a group as the rule engine reads it: no field and a `conditions` or `rules` list */
export function isRuleGroupNode(node: unknown): node is Record<string, unknown> {
  return isPlainObject(node) && !('field' in node) && (Array.isArray(node.conditions) || Array.isArray(node.rules));
}

/** a group's logic and children exactly as `RuleEngineService.evaluateGroupNode` takes them */
export function ruleGroupParts(group: Record<string, unknown>): { logic: 'AND' | 'OR' | 'NOT'; children: unknown[] } {
  const raw = String(group.logic || group.matchType || 'AND').toUpperCase().trim();
  const logic = raw === 'OR' ? 'OR' : raw === 'NOT' ? 'NOT' : 'AND';
  const children = group.conditions || group.rules || [];
  return { logic, children: Array.isArray(children) ? children : [] };
}

/** a treasury event field this release took out of the payload (amount, description, void reason) */
export const TREASURY_PRIVATE_FIELD_PATH = /^payload\.(amount|description|reason)(\.|$)/;

/** the same fields where an action text or setting names them */
export const TREASURY_PRIVATE_FIELD_TEXT = /payload\.(amount|description|reason)\b/g;

/** the fields a rule of each event type reads that its event no longer carries: the condition path and the action text */
export interface PrivateFieldPattern { path: RegExp; text: RegExp }

/** the event types whose rules see the treasury event: its own type and «همه رویدادها» */
export const TREASURY_PRIVATE_FIELDS: Readonly<Record<string, PrivateFieldPattern>> = {
  TreasuryTransactionApproved: { path: TREASURY_PRIVATE_FIELD_PATH, text: TREASURY_PRIVATE_FIELD_TEXT },
  '*': { path: TREASURY_PRIVATE_FIELD_PATH, text: TREASURY_PRIVATE_FIELD_TEXT },
};

/**
 * 10.3 package 5 (decision ت۴۷ item 3): the cheque status event («تغییر وضعیت چک») carries no amount and no party name
 * either. A «*» rule's amount is already read by the treasury lists, so only the party name is added for it.
 */
export const CHEQUE_PRIVATE_FIELDS: Readonly<Record<string, PrivateFieldPattern>> = {
  ChequeStatusChanged: { path: /^payload\.(amount|partyName)(\.|$)/, text: /payload\.(amount|partyName)\b/g },
  '*': { path: /^payload\.partyName(\.|$)/, text: /payload\.partyName\b/g },
};

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
