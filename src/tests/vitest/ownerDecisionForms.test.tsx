import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const fetchJson = vi.fn(async (url: string, _opts?: { method?: string; body?: string }) => (url === '/accounting/bank-accounts' ? [] : {}));
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: { method?: string; body?: string }) => fetchJson(url, opts) }));

const granted = { value: false };
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => granted.value && key === 'accounting.treasury_no_voucher' }));
// v9.0.286 (TD-805): the payroll buttons follow their keys; this test grants all of them
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';
import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';

afterEach(() => {
  cleanup();
  granted.value = false;
});

const treasuryForm = () => render(
  <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[]} customers={[]} personnelList={[]} appCurrency="IRR" onSave={async () => undefined} />
);
const settlementForm = () => render(
  <InvoiceSettlementModal isOpen onClose={() => undefined} onSuccess={() => undefined}
    document={{ id: 7, refNumber: 'INV-7', type: 'invoice', currency: 'IRR', payableAmount: 1000, paidAmount: 0 }} />
);

// v8.0.118 (TD-409، تصمیم مالک محصول — گزینه الف): گزینه «بدون سند حسابداری» فقط برای دارنده مجوز جدا دیده می‌شود
describe('no-voucher treasury option needs its own permission (TD-409)', () => {
  it('hides the voucher switch of the treasury form without the permission', async () => {
    const { container } = treasuryForm();
    await waitFor(() => expect(container.querySelector('option[value="bank_transfer"]')).toBeTruthy());
    expect(container.querySelector('#createVoucher')).toBeNull();
  });

  it('shows the voucher switch of the treasury form with the permission', async () => {
    granted.value = true;
    const { container } = treasuryForm();
    await waitFor(() => expect(container.querySelector('#createVoucher')).toBeTruthy());
  });

  it('hides the voucher switch of the invoice settlement form without the permission', async () => {
    settlementForm();
    await waitFor(() => expect(screen.getByText('کارت‌خوان')).toBeTruthy());
    expect(screen.queryByText('صدور خودکار سند حسابداری دوبل')).toBeNull();
  });

  it('shows the voucher switch of the invoice settlement form with the permission', async () => {
    granted.value = true;
    settlementForm();
    expect(await screen.findByText('صدور خودکار سند حسابداری دوبل')).toBeTruthy();
  });
});

// v8.0.120 (TD-411، تصمیم مالک محصول — گزینه الف): پرداخت حقوق روش «چک» ندارد
describe('payroll payment has no cheque method (TD-411)', () => {
  it('offers bank transfer, cash and POS only', async () => {
    const { container } = render(<PayrollPaymentModal payroll={{ id: 7, payrollNumber: 'PAY-7', netPayable: 1000000, paidAmount: 0, status: 'approved' }} onClose={() => undefined} />);
    await waitFor(() => expect(container.querySelector('option[value="bank_transfer"]')).toBeTruthy());
    expect(container.querySelector('option[value="cheque"]')).toBeNull();
    expect(container.querySelector('option[value="cash"]')).toBeTruthy();
    expect(container.querySelector('option[value="pos"]')).toBeTruthy();
  });
});
