/**
 * 10.2 package 8 (TD-1297, review M-1): the treasury event no longer carries its amount, so a saved rule on
 * `payload.amount` reads a missing field. A numeric comparison read a missing (or null) value as 0 and «not equal» /
 * «not in» passed on it, so `amount lt 1000`, `amount lte 0`, `amount neq 0` and `amount not_in 5` fired on every
 * treasury event. Now only the explicit absence checks match a missing field.
 */
import { describe, expect, it } from 'vitest';
import { RuleEngineService } from '../../services/ruleEngine.service';

const treasuryEvent = { payload: { transactionId: 7, type: 'deposit', currency: 'IRR', accountId: 2, nullable: null } };
const rule = (operator: string, value: unknown, field = 'payload.amount') => RuleEngineService.evaluateSingleRule({ field, operator, value } as never, treasuryEvent);

describe('rule_missing_field_td_1297', () => {
  it.each([
    ['gt', 0], ['>', 0], ['gte', 0], ['>=', 0], ['lt', 1000], ['<', 1000], ['lte', 0], ['<=', 0],
    ['neq', 0], ['!=', 0], ['not_equal', 0], ['not_in', '5,6'], ['nin', [5]], ['eq', 0], ['in', '0'],
  ])('%s on a missing field does not match', (operator, value) => {
    const result = rule(operator, value);
    expect(result.passed).toBe(false);
  });

  it('a numeric comparison on a null value does not match and says the field is missing', () => {
    const result = rule('lte', 10, 'payload.nullable');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('payload.nullable');
  });

  it.each([['is_empty'], ['empty'], ['not_exists']])('the absence check %s still matches a missing field', (operator) => {
    expect(rule(operator, null).passed).toBe(true);
  });

  it('a present field is compared as before', () => {
    expect(rule('lt', 10, 'payload.accountId').passed).toBe(true);
    expect(rule('neq', 3, 'payload.accountId').passed).toBe(true);
    expect(rule('not_in', '3,4', 'payload.accountId').passed).toBe(true);
    expect(rule('gte', '۲', 'payload.accountId').passed).toBe(true);
  });
});
