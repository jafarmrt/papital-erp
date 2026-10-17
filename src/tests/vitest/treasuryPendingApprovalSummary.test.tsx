import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { TreasuryHealthBanner } from '../../components/accounting/treasury/TreasuryHealthBanner';
import { useTreasuryCalculations } from '../../components/accounting/treasury/useTreasuryCalculations';
import { BANK_PENDING_APPROVAL_LABEL } from '../../lib/treasury/bankSyncStatus';
import type { BankAccount } from '../../types';

// review of #307: an account whose only difference is a draft voucher was counted neither as synced nor as discrepant,
// and the banner said «انطباق ۱۰۰٪» over it
const FULL_MATCH = 'انطباق ۱۰۰٪';

const account = (id: number, syncStatus: string) => ({ id, title: `Bank ${id}`, syncStatus } as unknown as BankAccount);

describe('treasury_summary_pending_approval_v10_1_66', () => {
  afterEach(cleanup);

  it('counts pending_approval accounts on their own', () => {
    const accounts = [account(1, 'synced'), account(2, 'pending_approval'), account(3, 'pending_approval')];
    const { result } = renderHook(() => useTreasuryCalculations({ bankAccounts: accounts }));
    expect(result.current.summary.syncedAccountsCount).toBe(1);
    expect(result.current.summary.discrepantAccountsCount).toBe(0);
    expect(result.current.summary.pendingApprovalAccountsCount).toBe(2);
  });

  it('names the accounts waiting for a voucher approval instead of a full match', () => {
    render(<TreasuryHealthBanner totalLedgerBalance={0} totalTreasuryBalance={0} totalDiscrepancy={0}
      syncedAccountsCount={1} discrepantAccountsCount={0} pendingApprovalAccountsCount={2} totalAccountsCount={3} appCurrency="IRR" />);
    expect(screen.getByRole('heading').textContent).toContain(BANK_PENDING_APPROVAL_LABEL);
    expect(screen.getByRole('heading').textContent).not.toContain(FULL_MATCH);
  });

  it('keeps the full match when nothing waits', () => {
    render(<TreasuryHealthBanner totalLedgerBalance={0} totalTreasuryBalance={0} totalDiscrepancy={0}
      syncedAccountsCount={2} discrepantAccountsCount={0} pendingApprovalAccountsCount={0} totalAccountsCount={2} appCurrency="IRR" />);
    expect(screen.getByRole('heading').textContent).toContain(FULL_MATCH);
  });
});
