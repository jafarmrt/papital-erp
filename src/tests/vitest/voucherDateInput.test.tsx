import fs from 'fs';
import path from 'path';
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

// v9.0.196 (TD-578, B03-36): the accounting forms and filters keep ISO dates and show them with JalaliDateInput; editing a voucher
// dated 2026-04-01 showed «۲۰۲۶/۰۴/۰۱» as a Jalali date.

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const accounts = [
  { id: 1201, code: '1201', name: 'دریافتنی تجاری', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'فروش کالا', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
const row = (id: number, accountId: number, debit: number, credit: number) => ({
  id, accountId, rowOrder: id % 10, detailedType: 'none', detailedId: null, detailedName: '', debit, credit, currency: 'IRR', exchangeRate: 1, description: '',
});
const voucher = {
  id: 80, voucherNumber: 80, manualVoucherNumber: '', date: '2026-04-01', voucherType: 'general', status: 'draft', totalDebit: 1000, totalCredit: 1000,
  description: 'هزینه', referenceModule: 'manual', referenceId: null, referenceNumber: '', currency: 'IRR', attachments: [],
  items: [row(801, 1201, 1000, 0), row(802, 5001, 0, 1000)],
} as unknown as JournalVoucher;
const jalaliInput = (container: HTMLElement) =>
  [...container.querySelectorAll('input')].find(i => /^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/.test(i.value));
const renderForm = (editingVoucher?: JournalVoucher) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<QueryClientProvider client={client()}><NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={[]}
    personnelList={[]} onSave={onSave} editingVoucher={editingVoucher} /></QueryClientProvider>);
  return { ...view, onSave };
};

beforeEach(() => fetchJson.mockReset());
afterEach(() => cleanup());

describe('accounting date inputs (TD-578)', () => {
  it('editing a voucher shows its Jalali date and saves the stored ISO date', async () => {
    fetchJson.mockResolvedValue({});
    const { container, onSave } = renderForm(voucher);
    expect(jalaliInput(container)?.value).toBe('۱۴۰۵/۰۱/۱۲');
    fireEvent.click(screen.getByText('به‌روزرسانی سند'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { date: string }).date).toBe('2026-04-01');
  });

  it('a draft saved with a Jalali date is restored and sent as ISO', async () => {
    const draft = {
      date: '1405/07/14', voucherType: 'general', manualVoucherNumber: '', description: 'هزینه', currency: 'IRR', attachments: [],
      items: [
        { accountId: 1201, detailedType: 'none', detailedId: null, detailedName: '', debit: 1000, credit: 0, description: '' },
        { accountId: 5001, detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 1000, description: '' },
      ],
    };
    fetchJson.mockImplementation(async (url: string) => (url === '/drafts/voucher?draftKey=new_voucher'
      ? { draft: { payload: draft, updatedAt: '2026-10-06T08:00:00Z', isDeleted: 0 } } : {}));
    const { container, onSave } = renderForm();
    fireEvent.click(await screen.findByText('بازیابی پیش‌نویس'));
    await waitFor(() => expect(jalaliInput(container)?.value).toBe('۱۴۰۵/۰۷/۱۴'));
    fireEvent.click(screen.getByText('ذخیره پیش‌نویس سند (Ctrl+S)'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { date: string }).date).toBe('2026-10-06');
  });

  it('no accounting component uses the raw multi-date picker instead of JalaliDateInput', () => {
    const root = path.resolve(__dirname, '../../components/accounting');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('react-multi-date-picker')) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
