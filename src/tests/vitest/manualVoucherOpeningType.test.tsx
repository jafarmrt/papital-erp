import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchJson, toastFn } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: () => false,
  getAuthToken: () => null,
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));

import { NewVoucherModal } from '../../components/accounting/NewVoucherModal';
import { isReservedVoucherReference, manualVoucherFormType } from '../../lib/accounting/manualVoucherRules';
import type { JournalVoucher } from '../../types';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const accounts = [
  { id: 1001, code: '1001', name: 'صندوق', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 4001, code: '4001', name: 'سرمایه', level: 'subsidiary', accountType: 'equity', nature: 'credit' },
];

function renderModal(editingVoucher?: JournalVoucher) {
  fetchJson.mockResolvedValue({});
  const onSave = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={[]} personnelList={[]} onSave={onSave} editingVoucher={editingVoucher} />
    </QueryClientProvider>,
  );
  return onSave;
}

// v9.0.149 (TD-559, B03-17): the form saved «افتتاحیه / اختتامیه» as type closing, so a manual opening balance could no longer be
// reversed or corrected; a closing voucher is issued only by the fiscal-year closing.
describe('a manual voucher is «افتتاحیه», never closing (TD-559)', () => {
  it('the type list offers the opening type and no closing type', () => {
    renderModal();
    const typeSelect = screen.getByDisplayValue('عمومی / عادی') as HTMLSelectElement;
    const types = [...typeSelect.options].map(o => `${o.value}=${o.textContent}`);
    expect(types).toContain('opening=افتتاحیه (مانده‌های اول دوره)');
    expect(types.some(t => t.startsWith('closing='))).toBe(false);
  });

  it('editing a legacy manual voucher of type closing shows and saves it as opening', async () => {
    const legacy = {
      id: 9, voucherNumber: 9, manualVoucherNumber: '', date: '2026-03-21', voucherType: 'closing', status: 'draft',
      totalDebit: 5000, totalCredit: 5000, description: 'مانده‌های اول دوره', referenceModule: 'manual', referenceId: null, currency: 'IRR',
      items: [
        { id: 91, voucherId: 9, accountId: 1001, rowOrder: 1, detailedType: 'none', detailedId: null, detailedName: '', debit: 5000, credit: 0, description: '' },
        { id: 92, voucherId: 9, accountId: 4001, rowOrder: 2, detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 5000, description: '' },
      ],
    } as unknown as JournalVoucher;
    const onSave = renderModal(legacy);
    expect((screen.getByDisplayValue('افتتاحیه (مانده‌های اول دوره)') as HTMLSelectElement).value).toBe('opening');
    fireEvent.click(screen.getByText('به‌روزرسانی سند'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { voucherType: string }).voucherType).toBe('opening');
  });

  it('reserved references of the system are recognised whatever the case', () => {
    for (const ref of ['CLOSING-1400', ' closing-1400', 'CLOSE-TEMP-1400', 'close-profit-1400', 'OPENING-1401', 'REV-V12', 'RE-REV-V12', 'VOID-REPOST-V3', 'Corr-V3', 'REPOST-V3']) {
      expect(isReservedVoucherReference(ref), ref).toBe(true);
    }
    for (const ref of ['', 'OPEN-BAL-1400', 'فاکتور ۱۲', 'INV-CLOSING-1400']) {
      expect(isReservedVoucherReference(ref), ref).toBe(false);
    }
    expect(manualVoucherFormType('closing')).toBe('opening');
    expect(manualVoucherFormType(undefined)).toBe('general');
    expect(manualVoucherFormType('sales')).toBe('sales');
  });
});
