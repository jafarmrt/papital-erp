import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

// v10.0.x (TD-1240): ردیف «مانده ابتدای دوره» کاوشگر حساب سند ندارد — نه شماره «۰»، نه کد «[]»، نه دکمه سند ۰
const loadVoucherDetail = vi.fn(async () => null);
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await import('../../lib/rialDisplay');
  return { useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/accounting/useVoucherQueries', () => ({ useVoucherDetailLoader: () => loadVoucherDetail }));
vi.mock('../../hooks/accounting/useAccountExplorerQueries', () => ({
  useExplorerLedgerQuery: () => ({
    loading: false,
    hasFilter: true,
    ledger: {
      items: [
        { voucherId: 0, voucherNumber: 0, date: '2026-03-21', description: 'مانده ابتدای دوره', accountName: '', accountCode: '', debit: 0, credit: 0, runningBalance: 5000, isOpening: true },
        { voucherId: 31, voucherNumber: 31, date: '2026-04-02', description: 'فروش نقدی', accountName: 'صندوق', accountCode: '1001', debit: 2000, credit: 0, runningBalance: 7000 },
      ],
      totalDebit: 2000,
      totalCredit: 0,
      finalBalance: 7000,
    },
  }),
}));

import { AccountExplorerTab } from '../../components/accounting/AccountExplorerTab';

afterEach(cleanup);

describe('account explorer opening row (TD-1240)', () => {
  it('shows the opening balance without a voucher number, an empty code or a voucher button', () => {
    render(<AccountExplorerTab accounts={[]} customers={[]} personnelList={[]} bankAccounts={[]} />);
    const openingRow = screen.getByText('مانده ابتدای دوره').closest('tr') as HTMLTableRowElement;
    expect(openingRow).toBeTruthy();
    expect(openingRow.textContent).not.toContain('[]');
    expect(within(openingRow).queryByText('۰')).toBeNull();
    expect(within(openingRow).queryByTitle('مشاهده کامل سند حسابداری')).toBeNull();
    const voucherRow = screen.getByText('فروش نقدی').closest('tr') as HTMLTableRowElement;
    expect(within(voucherRow).getByTitle('مشاهده کامل سند حسابداری')).toBeTruthy();
    expect(within(voucherRow).getByText('[1001]')).toBeTruthy();
  });
});
