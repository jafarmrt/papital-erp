import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const fetchJson = vi.fn(async (url: string) => {
  if (url.startsWith('/accounting/bank-accounts')) {
    return { success: true, data: [{ id: 5, code: '1003-01', title: 'بانک ملت جاری', type: 'bank', bankName: 'ملت', currency: 'IRR', hasLedgerAccount: true }] };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => false }));
// v9.0.286 (TD-805): the payroll buttons follow their keys; this test grants all of them
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';
import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';

afterEach(() => { cleanup(); fetchJson.mockClear(); });

const bankUrls = () => fetchJson.mock.calls.map(c => c[0]).filter(u => u.startsWith('/accounting/bank'));

// v9.0.97 (TD-505، B04-09، تصمیم ت۷ الف): فرم‌های پرداخت حقوق و تسویه فاکتور فقط فهرست انتخاب حساب‌ها را می‌خوانند؛
// پیش‌تر فهرست کامل با شماره حساب، کارت، شبا و مانده‌ها را می‌گرفتند.
describe('payment forms read the bank pick list (TD-505)', () => {
  it('the payroll payment form lists banks from the pick list', async () => {
    render(<PayrollPaymentModal payroll={{ id: 1, payrollNumber: 'P-1', netPayable: 1_000_000 }} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText('بانک ملت جاری (ملت)')).toBeTruthy());
    expect(bankUrls()).toEqual(['/accounting/bank-accounts/options']);
  });

  it('the invoice settlement form lists banks from the pick list', async () => {
    render(<InvoiceSettlementModal isOpen onClose={() => undefined} onSuccess={() => undefined}
      document={{ id: 3, refNumber: 'INV-3', buyerName: 'مشتری', type: 'invoice', currency: 'IRR', payableAmount: 500_000, remainingAmount: 500_000 }} />);
    await waitFor(() => expect(bankUrls()).toEqual(['/accounting/bank-accounts/options']));
  });
});
