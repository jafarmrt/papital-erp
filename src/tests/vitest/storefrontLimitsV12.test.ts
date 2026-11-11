// @vitest-environment node
/**
 * v12 phase 8b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.7 and 2.11): the rules of the site's limits,
 * shared by the server and the settings screens: the bell at 80% of a text budget, and the reminder before an «به حساب»
 * order's wait for confirmation runs out
 */
import { describe, expect, it } from 'vitest';
import { SMS_BUDGET_POOL_TITLES, SMS_BUDGET_WARN_PERCENT, smsBudgetWarnAt } from '../../lib/storefront/storefrontSmsRules';
import { APPROVAL_HOURS_DEFAULT, APPROVAL_REMINDER_HOURS, approvalReminderHours } from '../../lib/storefront/storefrontRules';

describe('the text budgets', () => {
  it('rings at 80% of an hour\'s budget, rounded up, and at least at one text', () => {
    expect(SMS_BUDGET_WARN_PERCENT).toBe(80);
    expect(smsBudgetWarnAt(200)).toBe(160);
    expect(smsBudgetWarnAt(11)).toBe(9);
    expect(smsBudgetWarnAt(1)).toBe(1);
  });

  it('names the two budgets in Persian', () => {
    expect(SMS_BUDGET_POOL_TITLES).toEqual({ codes: 'کد ورود', orders: 'پیامک سفارش' });
  });
});

describe('the wait of an «به حساب» order', () => {
  it('waits 72 hours by default and reminds 12 hours before its end (owner\'s decision 14)', () => {
    expect(APPROVAL_HOURS_DEFAULT).toBe(72);
    expect(APPROVAL_REMINDER_HOURS).toBe(12);
    expect(approvalReminderHours(72)).toBe(12);
  });

  it('reminds halfway through a wait shorter than a day', () => {
    expect(approvalReminderHours(24)).toBe(12);
    expect(approvalReminderHours(10)).toBe(5);
    expect(approvalReminderHours(1)).toBe(0.5);
  });
});
