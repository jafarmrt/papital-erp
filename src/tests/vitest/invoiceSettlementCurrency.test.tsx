import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';
import { defaultSettlementAccountId, settlementAccountsFor } from '../../lib/invoices/settlementAccounts';

// v9.0.345 (TD-802, finding B08-33): the settlement form offers and pre-selects only accounts in the invoice's currency
// (the server refuses a treasury row in another currency) and names each account's currency
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
  default: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

const accounts = [
  { id: 1, title: 'بانک ملت ریالی', type: 'bank', currency: 'IRR', code: '1101' },
  { id: 2, title: 'صندوق دلاری', type: 'cash', currency: 'USD', code: '1102' },
  { id: 3, title: 'حساب ارزی پاسارگاد', type: 'bank', currency: 'USD', code: '1103' },
  { id: 4, title: 'صندوق قدیمی', type: 'cash', code: '1104' },
];
const usdInvoice = { id: 2, type: 'invoice', ref_number: 'INV-2', buyer_name: 'مشتری دبی', currency: 'USD', payableAmount: 200, paidAmount: 0, remainingAmount: 200 };

function renderModal(doc: typeof usdInvoice) {
  render(<InvoiceSettlementModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} document={doc} />);
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastError.mockReset();
});

describe('settlement account by invoice currency (TD-802)', () => {
  it('keeps only accounts of the currency (an account without currency is rial) and prefers a bank or POS', () => {
    expect(settlementAccountsFor(accounts, 'USD').map(a => a.id)).toEqual([2, 3]);
    expect(settlementAccountsFor(accounts, 'IRR').map(a => a.id)).toEqual([1, 4]);
    expect(defaultSettlementAccountId(accounts, 'USD')).toBe(3);
    expect(defaultSettlementAccountId(accounts, 'EUR')).toBe('');
  });

  it('a USD invoice pre-selects a USD account, lists no rial account and posts with it', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/accounting/bank-accounts/options' ? accounts : { success: true }));
    renderModal(usdInvoice);
    const select = await screen.findByDisplayValue(/حساب ارزی پاسارگاد/) as HTMLSelectElement;
    expect(select.value).toBe('3');
    const texts = Array.from(select.options).map(o => o.text);
    expect(texts.some(t => t.includes('بانک ملت ریالی'))).toBe(false);
    expect(texts.filter(t => t.includes('دلار'))).toHaveLength(2);

    fireEvent.click(screen.getByText('تایید و ثبت تسویه'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/accounting/treasury', expect.anything()));
    const body = JSON.parse(String((fetchJson.mock.calls.find(([u]) => u === '/accounting/treasury') as [string, { body: string }])[1].body));
    expect(body).toMatchObject({ currency: 'USD', bankAccountId: 3 });
  });

  it('an invoice in a currency with no account selects nothing and says so', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/accounting/bank-accounts/options' ? accounts : { success: true }));
    renderModal({ ...usdInvoice, currency: 'EUR' });
    expect(await screen.findByText(/حساب بانکی یا صندوقی با ارز یورو تعریف نشده است/)).toBeTruthy();
    const select = screen.getByDisplayValue('انتخاب حساب / صندوق...') as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
  });
});
