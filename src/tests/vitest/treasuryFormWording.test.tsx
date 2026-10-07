import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchJson: vi.fn(async (url: string) => (url === '/api/system/business-date' ? { success: true, data: { today: '2026-10-07' } } : {})),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/accounting/useTreasuryQueries', () => ({ useContraAccountsQuery: () => ({ data: [], isLoading: false }) }));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import { treasuryExportFileName, treasuryExportRows } from '../../lib/treasury/treasuryExport';
import type { BankAccount, TreasuryTransaction } from '../../types';

afterEach(cleanup);

const unlinkedBank = { id: 5, code: '1003-01', title: 'صندوق بی سرفصل', type: 'cash', currency: 'IRR', currentBalance: 0, accountId: null } as unknown as BankAccount;

// v9.0.106 (TD-515, B04-19): the form says a bank without a ledger account cannot be used (the server refuses it with 422),
// its heading no longer offers cheques, its date picker shows the Jalali date, and the treasury Excel export is Persian.
describe('treasury form and export wording (TD-515)', () => {
  it('a bank without a ledger account is refused by the form, as by the server', async () => {
    const { container } = render(
      <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[unlinkedBank]} customers={[]}
        personnelList={[]} appCurrency="IRR" onSave={async () => undefined} />,
    );
    const bankSelect = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option[value="5"]')) as HTMLSelectElement;
    fireEvent.change(bankSelect, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByText(/ثبت دریافت یا پرداخت با آن ممکن نیست/)).toBeTruthy());
    expect(container.textContent).not.toContain('سند دوبل صادر نخواهد شد');
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).not.toContain('پایا / چک');
  });

  it('the date field shows the business date in the Jalali calendar', async () => {
    const { container } = render(
      <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[]} customers={[]}
        personnelList={[]} appCurrency="IRR" onSave={async () => undefined} />,
    );
    await waitFor(() => {
      const values = Array.from(container.querySelectorAll('input')).map(i => i.value);
      expect(values.some(v => /^(1405|۱۴۰۵)\/(07|۰۷)\/(15|۱۵)$/.test(v))).toBe(true);
    });
  });

  it('the Excel export has Persian party types and methods and a Jalali file name', () => {
    const rows = treasuryExportRows([
      { id: 1, transactionNumber: 'REC-000001', type: 'receipt', status: 'completed', date: '2026-10-07', partyType: 'customer', method: 'bank_transfer', partyName: 'مشتری', amount: 1_000_000 },
      { id: 2, transactionNumber: 'PAY-000002', type: 'payment', status: 'completed', date: '2026-10-07', partyType: 'personnel', method: 'pos', partyName: 'کارگر', amount: 300_000 },
    ] as unknown as TreasuryTransaction[]);
    expect(rows.map(r => [r['نوع طرف'], r['روش پرداخت']])).toEqual([['مشتری', 'حواله / پایا'], ['پرسنل', 'کارتخوان']]);
    expect(treasuryExportFileName('1405/07/15')).toBe('گردش-خزانه-1405-07-15.xlsx');
  });
});
