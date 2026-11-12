// @vitest-environment node
/**
 * v12 phase 8b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.7 and 2.11): the rules of the site's limits,
 * shared by the server and the settings screens: the bell at 80% of a text budget, and the reminder before an «به حساب»
 * order's wait for confirmation runs out
 */
import { describe, expect, it } from 'vitest';
import type { DbExecutor, DbTransaction } from '../../db/drizzle';
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

describe('the wait of an on-account order', () => {
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

describe('the bells of the limits (v12 phase 8b review)', () => {
  const failing = () => ({
    transaction: async () => { throw new Error('lock timeout'); },
    select: () => { throw new Error('the bell read outside its savepoint'); },
  });

  it('fails the approval reminder when its bell fails, so the next minute rings again; other order bells stay quiet', async () => {
    const { notifySiteOrder } = await import('../../services/storefront/storefrontOrderNotices');
    const order = { id: 1, orderNumber: '1405001' };
    await expect(notifySiteOrder(failing() as unknown as DbTransaction, 'approval_due', order, { rethrow: true })).rejects.toThrow('lock timeout');
    await expect(notifySiteOrder(failing() as unknown as DbTransaction, 'placed', order)).resolves.toBeUndefined();
  });

  it('counts and rings a budget only inside its savepoint, so a failed read never aborts the text\'s transaction', async () => {
    const { warnIfBudgetNearlySpent } = await import('../../services/storefront/storefrontSmsBudget');
    let readOutside = false;
    const tx = { ...failing(), select: () => { readOutside = true; throw new Error('statement timeout'); } };
    await expect(warnIfBudgetNearlySpent(tx as unknown as DbExecutor, 10, 'codes')).resolves.toBeUndefined();
    // a read on the caller's own transaction would have aborted it (red before: the count and the dedup read ran there)
    expect(readOutside).toBe(false);
  });
});
