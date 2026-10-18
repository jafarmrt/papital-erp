/**
 * 10.2 package 8 (TD-1297, review N-1 / N-2): the financial health check and the boot log read how a saved condition
 * behaves on a field its event no longer carries. Their reading must be the rule engine's own for every operator, and a
 * condition under a «NOT» group, spelled `event.payload.`, or «not equal» on the treasury amount now passes on every
 * treasury event, so it is listed as matching every time.
 */
import { describe, expect, it } from 'vitest';
import { RuleEngineService } from '../../services/ruleEngine.service';
import { missingFieldOutcome } from '../../lib/events/ruleMissingField';
import { treasuryPrivateFieldUseOf } from '../../services/accounting/treasuryRuleFieldHealth';
import { rulesOnMissingNumericFields } from '../../services/events/ruleMissingFieldLog';

const engine = (operator: string, value: unknown) => RuleEngineService.evaluateSingleRule({ field: 'payload.amount', operator, value } as never, { payload: {} }).passed;

describe('treasury_rule_health_td_1297', () => {
  it.each([
    ['eq', 0], ['eq', ''], ['=', 5], ['equal', null], ['neq', 0], ['!=', ''], ['not_equal', 3],
    ['gt', 0], ['>=', 1], ['lt', 1000], ['<=', 0], ['in', '1,2'], ['in', '1,,2'], ['in', ['']], ['in', 3],
    ['not_in', '1,2'], ['nin', ['']], ['not_in', 3], ['contains', ''], ['contains', 'x'], ['like', 'a'],
    ['regex', '^$'], ['regexp', '\\d+'], ['regex', '['], ['is_empty', null], ['empty', null], ['is_not_empty', null],
    ['not_empty', null], ['exists', null], ['not_exists', null], ['unknown_op', 1], ['EQ', ''], [' Gt ', 0],
  ])('%s %j on a missing field gives what the engine gives', (operator, value) => {
    expect(missingFieldOutcome(operator, value)).toBe(engine(operator, value));
  });

  it('lists not equal, a NOT group, empty contains and the event.payload spelling as matching every time', () => {
    expect(treasuryPrivateFieldUseOf([{ field: 'payload.amount', operator: 'neq', value: 0 }], {})?.use).toBe('always_matches');
    expect(treasuryPrivateFieldUseOf({ logic: 'NOT', conditions: [{ field: 'event.payload.amount', operator: 'gte', value: 1 }] }, {}))
      .toEqual({ fields: ['payload.amount'], use: 'always_matches' });
    expect(treasuryPrivateFieldUseOf([{ field: 'payload.description', operator: 'contains', value: '' }], {})?.use).toBe('always_matches');
    expect(treasuryPrivateFieldUseOf({ matchType: 'not', rules: [{ field: 'payload.reason', operator: 'is_empty' }] }, {})?.use).toBe('never_matches');
    expect(treasuryPrivateFieldUseOf([{ field: 'payload.amount', operator: 'gte', value: 1 }], {})?.use).toBe('never_matches');
    expect(treasuryPrivateFieldUseOf([{ field: 'payload.currency', operator: 'neq', value: 'USD' }], {})).toBeNull();
  });

  it('names the saved rules whose numeric comparison reads a field their event does not carry', () => {
    const rows = rulesOnMissingNumericFields([
      { id: 1, eventType: 'TreasuryTransactionApproved', conditionsJson: [{ field: 'payload.amount', operator: 'gte', value: 1 }] },
      { id: 2, eventType: 'TreasuryTransactionApproved', conditionsJson: [{ field: 'payload.amount', operator: 'neq', value: 1 }] },
      { id: 3, eventType: 'InvoiceApproved', conditionsJson: { logic: 'OR', rules: [{ field: 'event.payload.totalAmount', operator: 'lt', value: 5 }, { field: 'payload.discount', operator: 'GT', value: 0 }] } },
      { id: 4, eventType: '*', conditionsJson: [{ field: 'payload.amount', operator: 'gt', value: 1 }] },
      { id: 5, eventType: 'StockIssued', conditionsJson: [{ field: 'payload.quantity', operator: 'gt', value: 1 }] },
    ]);
    expect(rows).toEqual([
      { ruleId: 1, eventType: 'TreasuryTransactionApproved', field: 'payload.amount', operator: 'gte' },
      { ruleId: 3, eventType: 'InvoiceApproved', field: 'payload.discount', operator: 'gt' },
    ]);
  });
});
