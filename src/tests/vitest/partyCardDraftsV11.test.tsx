import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PartyDraftRowsPanel } from '../../components/accounting/reports/PartyDraftRowsPanel';
import { TreasuryHealthBanner } from '../../components/accounting/treasury/TreasuryHealthBanner';
import { PARTY_BALANCE_WITH_DRAFTS_LABEL, PARTY_DRAFT_ROWS_TITLE, partyBalanceSide, partyDraftRowsOf } from '../../lib/accounting/partyDraftRows';

// v11 phase 6.1t (U1, evaluation finding F1): the party's draft vouchers apart on its card and statement, with the balance
// they make, and a treasury banner that claims no match before any account exists.

afterEach(cleanup);

const FULL_MATCH = 'انطباق ۱۰۰٪';

describe('the draft vouchers of a party card', () => {
  const rows = {
    items: [
      { voucherId: 16, voucherNumber: 16, date: '2026-10-07', description: 'فاکتور فروش', accountCode: '1201', accountName: 'حساب‌های دریافتنی', currency: 'IRR', debit: 1_700_000, credit: 0 },
      { voucherId: 17, voucherNumber: 17, date: '2026-10-07', description: 'دریافت', accountCode: '1201', accountName: 'حساب‌های دریافتنی', currency: 'IRR', debit: 0, credit: 200_000 },
    ],
    totalDebit: 1_700_000,
    totalCredit: 200_000,
    voucherCount: 2,
    balanceWithDrafts: 1_500_000,
  };

  it('lists the draft rows under their own title with the balance they make and its side', () => {
    render(<PartyDraftRowsPanel rows={rows} formatAmount={v => String(v)} />);
    const panel = screen.getByTestId('party-draft-rows');
    expect(panel.textContent).toContain(PARTY_DRAFT_ROWS_TITLE);
    expect(panel.textContent).toContain(PARTY_BALANCE_WITH_DRAFTS_LABEL);
    expect(panel.textContent).toContain('1500000 (بدهکار)');
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('shows nothing without draft rows', () => {
    const { container } = render(<PartyDraftRowsPanel rows={{ ...rows, items: [] }} formatAmount={v => String(v)} />);
    expect(container.textContent).toBe('');
    expect(partyDraftRowsOf({})).toEqual([]);
  });

  it('names the side of a balance', () => {
    expect(partyBalanceSide(10)).toBe('بدهکار');
    expect(partyBalanceSide(-10)).toBe('بستانکار');
    expect(partyBalanceSide(0)).toBe('بی‌حساب');
  });
});

describe('the treasury health banner before any account', () => {
  it('claims no match with no account', () => {
    render(<TreasuryHealthBanner totalLedgerBalance={0} totalTreasuryBalance={0} totalDiscrepancy={0}
      syncedAccountsCount={0} discrepantAccountsCount={0} pendingApprovalAccountsCount={0} totalAccountsCount={0} appCurrency="IRR" />);
    expect(screen.getByTestId('treasury-health-empty').textContent).toContain('هنوز حساب بانکی یا صندوقی تعریف نشده است');
    expect(document.body.textContent).not.toContain(FULL_MATCH);
  });
});
