import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const fetchJson = vi.fn(async (url: string) => (url === '/accounting/bank-accounts' ? [] : {}));
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';

afterEach(cleanup);

// v8.0.26 (TD-278، تصمیم مالک محصول — گزینه الف): چک فقط از «مدیریت چک‌های صیادی» ثبت می‌شود؛ فرم خزانه و فرم تسویه
// فاکتور روش «چک» ندارند (این روش اسناد دریافتنی را بدهکار می‌کرد ولی رکورد چکی نمی‌ساخت).
describe('treasury cheque method removed (TD-278)', () => {
  it('the treasury form offers no cheque method', async () => {
    const { container } = render(
      <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[]} customers={[]} personnelList={[]} appCurrency="IRR" onSave={async () => undefined} />
    );
    await waitFor(() => expect(container.querySelector('option[value="bank_transfer"]')).toBeTruthy());
    expect(container.querySelector('option[value="cheque"]')).toBeNull();
    expect(container.querySelector('option[value="cash"]')).toBeTruthy();
  });

  it('the invoice settlement form offers no cheque method', async () => {
    render(
      <InvoiceSettlementModal isOpen onClose={() => undefined} onSuccess={() => undefined}
        document={{ id: 7, refNumber: 'INV-7', type: 'invoice', currency: 'IRR', payableAmount: 1000, paidAmount: 0 }} />
    );
    await waitFor(() => expect(screen.getByText('کارت‌خوان')).toBeTruthy());
    expect(screen.queryByText('چک صیادی')).toBeNull();
    expect(screen.getByText('وجه نقد (صندوق)')).toBeTruthy();
  });
});
