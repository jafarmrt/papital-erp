import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LedgerView } from '../../components/accounting/reports/LedgerView';
import type { Account, AccountLedgerReport } from '../../types';

afterEach(cleanup);

// the account card as GET /accounting/reports/ledger returns it: the server puts the opening row first (`isOpening`)
const card: AccountLedgerReport = {
  items: [
    { voucherId: 0, voucherNumber: 0, date: '2026-03-21', description: 'مانده ابتدای دوره', accountName: '', accountCode: '', currency: 'IRR', debit: 50_000_000, credit: 0, runningBalance: 50_000_000, isOpening: true },
    { voucherId: 9, voucherNumber: 120, date: '2026-04-01', description: 'دریافت از مشتری', accountName: 'صندوق', accountCode: '1101', currency: 'IRR', debit: 10_000_000, credit: 0, runningBalance: 60_000_000 },
  ],
  openingBalance: 50_000_000, totalDebit: 10_000_000, totalCredit: 0, finalBalance: 60_000_000, currency: 'IRR',
};
const accounts = [
  { id: 1, code: '1', name: 'دارایی‌ها', level: 'group' },
  { id: 1101, code: '1101', name: 'صندوق', level: 'subsidiary' },
] as unknown as Account[];

function renderLedger(selected: number) {
  return render(<LedgerView accounts={accounts} ledgerReport={card} selectedLedgerAccountId={selected} setSelectedLedgerAccountId={() => {}}
    onApplyLedgerFilter={() => {}} onFetchLedger={() => {}} startDate="2026-03-21" endDate="" />);
}

// v9.0.113 (TD-574, B03-32): the ledger printed «مانده ابتدای دوره» twice (its own row and the server's) and its title read
// `accountName`, which the server never sends, so it said only «دفتر معین حساب».
describe('account card view (TD-574)', () => {
  it('prints the server opening row once, numbers the first voucher row ۱ and names the account in the title', () => {
    const { container } = renderLedger(1101);
    expect(screen.getAllByText('مانده ابتدای دوره')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 4 }).textContent?.trim()).toBe('دفتر حساب معین 1101 - صندوق');
    const firstVoucherRow = screen.getByText('دریافت از مشتری').closest('tr')!;
    expect(firstVoucherRow.querySelector('td')!.textContent).toBe('۱');
    expect(container.textContent).toContain('۶۰,۰۰۰,۰۰۰');
  });

  it('a group card says it carries its sub-accounts and names the sub-account of each row', () => {
    renderLedger(1);
    expect(screen.getByRole('heading', { level: 4 }).textContent?.trim()).toBe('دفتر حساب گروه 1 - دارایی‌ها');
    expect(screen.getByText('با گردش همه زیرحساب‌ها')).toBeTruthy();
    expect(screen.getByText('1101 - صندوق')).toBeTruthy();
  });
});
