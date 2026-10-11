import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// v10.0.x (TD-1237): پاسخ پیش‌نمایش سند خزانه همان شکل سرور است — { debit, credit, warnings } بی پوشش success/data
const PREVIEW = {
  debit: { accountId: 40, accountCode: '1003', accountName: 'بانک‌ها', detailedName: 'بانک آزمون', amount: 2_500_000 },
  credit: { accountId: 12, accountCode: '1201', accountName: 'حساب‌های دریافتنی تجاری', detailedName: 'مشتری نمونه', amount: 2_500_000 },
  warnings: ['هشدار نمونه پیش‌نمایش'],
  contraConceptLabel: 'حساب‌های دریافتنی تجاری',
};

const fetchJson = vi.fn(async (url: string) => (url === '/api/accounting/treasury/preview-voucher' ? PREVIEW : {}));
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/accounting/useTreasuryQueries', () => ({ useContraAccountsQuery: () => ({ data: [], isLoading: false }) }));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import { readTreasuryVoucherPreview } from '../../lib/treasury/treasuryVoucherPreview';
import type { BankAccount } from '../../types';

afterEach(cleanup);

const bank = { id: 5, code: '1003-01', title: 'بانک آزمون', type: 'bank', currency: 'IRR', currentBalance: 0, accountId: 40 } as unknown as BankAccount;

describe('treasury voucher preview reads the server answer (TD-1237)', () => {
  it('the contract reader takes the bare server shape and refuses anything else', () => {
    expect(readTreasuryVoucherPreview(PREVIEW)?.debit?.accountCode).toBe('1003');
    expect(readTreasuryVoucherPreview({ debit: null, credit: null, warnings: ['x'] })?.warnings).toEqual(['x']);
    expect(readTreasuryVoucherPreview(null)).toBeNull();
    expect(readTreasuryVoucherPreview({ success: true })).toBeNull();
  });

  it('the form shows the debit and credit rows and the warnings the server sends', async () => {
    const { container } = render(
      <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[bank]} customers={[]}
        personnelList={[]} appCurrency="IRR" onSave={async () => undefined} />
    );
    const bankSelect = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option[value="5"]'));
    if (!bankSelect) throw new Error('bank select not found');
    fireEvent.change(bankSelect, { target: { value: '5' } });
    const amount = screen.getByLabelText(/مبلغ تراکنش/) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '2500000' } });
    fireEvent.blur(amount);

    await waitFor(() => expect(screen.getByText(/حساب‌های دریافتنی تجاری/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('مشتری نمونه')).toBeTruthy();
    expect(screen.getByText(/هشدار نمونه پیش‌نمایش/)).toBeTruthy();
  });
});
