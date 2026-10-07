import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JournalVoucher } from '../../types';

const { fetchJson, toastFn } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
  getAuthToken: () => null,
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));

import { NewVoucherModal } from '../../components/accounting/NewVoucherModal';
import { VoucherCorrectionModal } from '../../components/accounting/VoucherCorrectionModal';
import {
  voucherBalancingAmount, voucherFormCurrency, voucherHeaderRateFromRows, voucherRowDraftFromStored, withVoucherRowCurrency,
} from '../../lib/accounting/voucherFormCurrency';

// v9.0.181 (TD-564, B03-22, decision t7): the manual voucher form, its edit and the correction form send each row's currency and
// rate; «تومان» is no longer offered.

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const accounts = [
  { id: 1201, code: '1201', name: 'دریافتنی تجاری', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'فروش کالا', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
type Row = Record<string, unknown>;
const row = (id: number, accountId: number, debit: number, credit: number, currency: string, exchangeRate: number): Row => ({
  id, accountId, rowOrder: id % 10, detailedType: 'none', detailedId: null, detailedName: '', debit, credit, currency, exchangeRate, description: '',
});
function voucher(id: number, over: Row): JournalVoucher {
  return {
    id, voucherNumber: id, manualVoucherNumber: '', date: '2026-09-01', voucherType: 'general', status: 'draft', totalDebit: 100,
    totalCredit: 100, description: 'فروش صادراتی', referenceModule: 'manual', referenceId: null, referenceNumber: '', currency: 'USD',
    attachments: [], ...over,
  } as unknown as JournalVoucher;
}
const usdRows = (v: number) => [row(v * 10 + 1, 1201, 100, 0, 'USD', 600_000), row(v * 10 + 2, 5001, 0, 100, 'USD', 600_000)];
const renderNew = (props: Partial<Parameters<typeof NewVoucherModal>[0]> = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={client()}><NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={[]} personnelList={[]} onSave={onSave} {...props} /></QueryClientProvider>);
  return onSave;
};
const savedRows = (fn: ReturnType<typeof vi.fn>, arg = 0, key = 'items') => (fn.mock.calls[0][arg] as Record<string, Row[]>)[key]
  .map(r => `${r.currency}@${r.exchangeRate ?? '-'}:${r.debit}/${r.credit}`);

beforeEach(() => { fetchJson.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); });
afterEach(() => cleanup());

describe('manual voucher row currency and rate (TD-564)', () => {
  it('a USD voucher needs the dollar rate and is sent with the currency and rate on every row', async () => {
    const draft = {
      date: '1405/07/14', voucherType: 'general', manualVoucherNumber: '', description: 'فروش صادراتی ۱۰۰ دلار', currency: 'USD', attachments: [],
      items: [
        { accountId: 1201, detailedType: 'none', detailedId: null, detailedName: '', debit: 100, credit: 0, description: 'فروش صادراتی' },
        { accountId: 5001, detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 100, description: 'فروش صادراتی' },
      ],
    };
    fetchJson.mockImplementation(async (url: string) => (url === '/drafts/voucher?draftKey=new_voucher'
      ? { draft: { payload: draft, updatedAt: '2026-10-06T08:00:00Z', isDeleted: 0 } } : {}));
    const onSave = renderNew();
    fireEvent.click(await screen.findByText('بازیابی پیش‌نویس'));
    await waitFor(() => expect(screen.getByLabelText('نرخ دلار به ریال *')).toBeTruthy());
    expect(document.body.textContent).toContain('نرخ تبدیل ردیف ۱، ۲ به ریال را وارد کنید');
    expect((screen.getByText('ثبت قطعی سند (Ctrl+S)').closest('button') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('نرخ دلار به ریال *'), { target: { value: '۶۰۰,۰۰۰' } });
    fireEvent.click(screen.getByText('ثبت قطعی سند (Ctrl+S)'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as Row).currency).toBe('USD');
    expect(savedRows(onSave)).toEqual(['USD@600000:100/0', 'USD@600000:0/100']);
  });

  it('the currency list is the treasury list; «تومان» is not offered', () => {
    fetchJson.mockResolvedValue({});
    renderNew();
    const select = screen.getByDisplayValue('ریال (IRR)') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['IRR', 'USD', 'EUR', 'AED', 'GBP']);
    expect(document.body.textContent).not.toContain('تومان');
  });

  it('editing keeps each stored row currency and rate, a dollar row in a rial voucher included', async () => {
    fetchJson.mockResolvedValue({});
    const onSave = renderNew({ editingVoucher: voucher(70, { items: usdRows(7) }) });
    fireEvent.click(screen.getByText('به‌روزرسانی سند'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(savedRows(onSave)).toEqual(['USD@600000:100/0', 'USD@600000:0/100']);
    cleanup();

    const mixed = voucher(71, { currency: 'IRR', items: [row(711, 1201, 100, 0, 'USD', 600_000), row(712, 5001, 0, 60_000_000, 'IRR', 1)] });
    const onSaveMixed = renderNew({ editingVoucher: mixed });
    expect(document.body.textContent).toContain('سند کاملاً تراز است');
    fireEvent.click(screen.getByText('به‌روزرسانی سند'));
    await waitFor(() => expect(onSaveMixed).toHaveBeenCalledTimes(1));
    expect(savedRows(onSaveMixed)).toEqual(['USD@600000:100/0', 'IRR@-:0/60000000']);
  });

  it('the correction keeps the currency and rate of the replacement rows', async () => {
    fetchJson.mockResolvedValue({});
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<QueryClientProvider client={client()}><VoucherCorrectionModal isOpen onClose={() => {}}
      voucher={voucher(72, { status: 'approved', items: usdRows(7) })} accounts={accounts as never} customers={[]} personnelList={[]}
      onCorrect={onCorrect} /></QueryClientProvider>);
    expect((screen.getByLabelText('نرخ دلار به ریال *') as HTMLInputElement).value).toBe('600000');
    fireEvent.click(screen.getByText('تصحیح مبالغ بدهکار و بستانکار'));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onCorrect).toHaveBeenCalledTimes(1));
    expect(savedRows(onCorrect, 1, 'newItems')).toEqual(['USD@600000:100/0', 'USD@600000:0/100']);
  });

  it('form helpers: rows follow the voucher, a stored rate survives, balancing divides the rial difference by the row rate', () => {
    const header = { currency: 'USD', rate: 600000 };
    expect(withVoucherRowCurrency([{ currency: '' }, { currency: 'IRR', exchangeRate: 5 }, { currency: 'EUR', exchangeRate: '700000' }], header))
      .toEqual([{ currency: 'USD', exchangeRate: 600000 }, { currency: 'IRR' }, { currency: 'EUR', exchangeRate: 700000 }]);
    expect(voucherHeaderRateFromRows([{ currency: 'IRR', exchangeRate: 1 }, { currency: 'USD', exchangeRate: 610000 }], 'USD')).toBe(610000);
    expect(voucherRowDraftFromStored({ currency: 'USD', exchangeRate: 610000 }, header)).toEqual({ currency: '', exchangeRate: 610000 });
    expect(voucherRowDraftFromStored({ currency: 'USD', exchangeRate: 600000 }, header)).toEqual({ currency: '', exchangeRate: '' });
    expect(voucherFormCurrency('TOMAN')).toEqual({ currency: 'IRR', replaced: 'TOMAN' });
    expect(voucherFormCurrency('usd')).toEqual({ currency: 'USD', replaced: null });

    const rial = { currency: 'IRR', rate: '' };
    const rows = [{ debit: 100, credit: 0, currency: 'USD', exchangeRate: 600000 }, { debit: 0, credit: 0, currency: '' }];
    expect(voucherBalancingAmount(rows, 1, rial)).toEqual({ kind: 'amount', side: 'credit', amount: 60_000_000 });
    const toUsd = [{ debit: 0, credit: 59_999_000, currency: '' }, { debit: 0, credit: 0, currency: 'USD', exchangeRate: 600000 }];
    expect(voucherBalancingAmount(toUsd, 1, rial)).toEqual({ kind: 'amount', side: 'debit', amount: 100 });
    expect(voucherBalancingAmount([{ debit: 100, credit: 0, currency: 'USD' }, { debit: 0, credit: 0 }], 1, rial).kind).toBe('error');
  });
});
