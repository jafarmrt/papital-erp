import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { VOUCHER_DETAILED_TYPES, voucherDetailedTypeFromStored } from '../../lib/accounting/voucherDetailedTypes';

// v9.0.193 (TD-569, B03-27): the voucher forms offer the server's detailed types: «متفرقه» is `other` (was `custom`, refused with
// 400), project and bank account are offered, and the correction form has the supplier.

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const accounts = [
  { id: 1201, code: '1201', name: 'دریافتنی تجاری', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'فروش کالا', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
const customers = [
  { id: 3, name: 'مشتری الف', partyType: 'customer' },
  { id: 4, name: 'تأمین‌کننده ب', partyType: 'supplier', supplierCategory: 'سنگ' },
];
const row = (id: number, accountId: number, debit: number, credit: number, detailedType: string, detailedName = '') => ({
  id, accountId, rowOrder: id % 10, detailedType, detailedId: null, detailedName, debit, credit, currency: 'IRR', exchangeRate: 1, description: '',
});
const voucher = (status: string): JournalVoucher => ({
  id: 90, voucherNumber: 90, manualVoucherNumber: '', date: '2026-09-01', voucherType: 'general', status, totalDebit: 1000, totalCredit: 1000,
  description: 'هزینه متفرقه', referenceModule: 'manual', referenceId: null, referenceNumber: '', currency: 'IRR', attachments: [],
  items: [row(901, 1201, 1000, 0, 'custom', 'هزینه متفرقه'), row(902, 5001, 0, 1000, 'none')],
} as unknown as JournalVoucher);

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/projects/options') return { success: true, data: [{ id: 7, projectCode: 'PRJ-7', project_code: 'PRJ-7', title: 'گردنبند سفارشی', status: 'in_progress' }] };
    if (url === '/accounting/bank-accounts/options') return [{ id: 2, code: 'B2', title: 'بانک ملت جاری', type: 'bank', bankName: 'ملت', currency: 'IRR', hasLedgerAccount: true }];
    return {};
  });
});
afterEach(() => cleanup());

const typeSelects = () => screen.getAllByLabelText('نوع تفصیلی') as HTMLSelectElement[];

describe('voucher detailed types (TD-569)', () => {
  it('the voucher form offers the server types; a stored "custom" row is "miscellaneous" (other) and a project row is sent with its id and label', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<QueryClientProvider client={client()}><NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={customers as never}
      personnelList={[]} onSave={onSave} editingVoucher={voucher('draft')} /></QueryClientProvider>);
    const selects = typeSelects();
    expect([...selects[0].options].map(o => o.value)).toEqual([...VOUCHER_DETAILED_TYPES]);
    expect([...selects[0].options].map(o => o.textContent)).toEqual(['بدون تفصیلی', 'مشتری', 'تأمین‌کننده', 'پرسنل', 'پروژه', 'حساب بانکی و صندوق', 'متفرقه']);
    expect(selects[0].value).toBe('other');
    expect((screen.getByLabelText('عنوان تفصیلی') as HTMLInputElement).value).toBe('هزینه متفرقه');

    fireEvent.change(selects[1], { target: { value: 'project' } });
    const projectSelect = await screen.findByLabelText('انتخاب پروژه') as HTMLSelectElement;
    await waitFor(() => expect(within(projectSelect).getByText('گردنبند سفارشی (PRJ-7)')).toBeTruthy());
    fireEvent.change(projectSelect, { target: { value: '7' } });
    fireEvent.click(screen.getByText('به‌روزرسانی سند'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const items = (onSave.mock.calls[0][0] as { items: Array<Record<string, unknown>> }).items;
    expect(items.map(r => `${r.detailedType}:${r.detailedId ?? '-'}:${r.detailedName}`)).toEqual(['other:-:هزینه متفرقه', 'project:7:گردنبند سفارشی (PRJ-7)']);
  });

  it('the correction form offers the supplier and the bank account and sends them', async () => {
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<QueryClientProvider client={client()}><VoucherCorrectionModal isOpen onClose={() => {}} voucher={voucher('approved')}
      accounts={accounts as never} customers={customers as never} personnelList={[]} onCorrect={onCorrect} /></QueryClientProvider>);
    const selects = typeSelects();
    expect([...selects[0].options].map(o => o.value)).toEqual([...VOUCHER_DETAILED_TYPES]);
    fireEvent.change(selects[0], { target: { value: 'supplier' } });
    const supplier = screen.getByLabelText('انتخاب تأمین‌کننده') as HTMLSelectElement;
    expect([...supplier.options].map(o => o.textContent)).toEqual(['انتخاب تأمین‌کننده...', 'تأمین‌کننده ب [سنگ]']);
    fireEvent.change(supplier, { target: { value: '4' } });
    fireEvent.change(typeSelects()[1], { target: { value: 'bank_account' } });
    const bank = await screen.findByLabelText('انتخاب حساب بانکی و صندوق') as HTMLSelectElement;
    await waitFor(() => expect(within(bank).getByText('بانک ملت جاری (ملت)')).toBeTruthy());
    fireEvent.change(bank, { target: { value: '2' } });
    fireEvent.click(screen.getByText('تصحیح مبالغ بدهکار و بستانکار'));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onCorrect).toHaveBeenCalledTimes(1));
    const items = (onCorrect.mock.calls[0][1] as { newItems: Array<Record<string, unknown>> }).newItems;
    expect(items.map(r => `${r.detailedType}:${r.detailedId ?? '-'}:${r.detailedName}`)).toEqual(['supplier:4:تأمین‌کننده ب', 'bank_account:2:بانک ملت جاری']);
    expect(fetchJson.mock.calls.map(c => c[0])).toContain('/accounting/bank-accounts/options');
  });

  it('legacy and empty types map to the server list', () => {
    expect(voucherDetailedTypeFromStored('custom')).toBe('other');
    expect(voucherDetailedTypeFromStored(null)).toBe('none');
    expect(voucherDetailedTypeFromStored('supplier')).toBe('supplier');
  });
});
