import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ACCOUNT_MAPPING_CONCEPTS } from '../../lib/accounting/accountMappingConcepts';

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

import { AccountingSettingsTab } from '../../components/settings/AccountingSettingsTab';

// v9.0.199 (TD-550, B03-08): the mapping page lists all 26 server concepts (23 before: work in progress, fixed salary and
// deductions were missing) and each picker offers only posting accounts of the concept's type («۱ دارایی‌ها» and revenue
// accounts were offered for raw materials).

const account = (id: number, code: string, name: string, level: string, parentId: number | null, accountType: string) => ({
  id, code, name, level, parentId, accountType, nature: 'debit', isActive: 1, isDeleted: 0,
});
const chart = [
  account(1, '1', 'دارایی‌ها', 'group', null, 'asset'),
  account(14, '14', 'موجودی مواد و کالا', 'general', 1, 'asset'),
  account(1401, '1401', 'موجودی مواد اولیه و ملزومات', 'subsidiary', 14, 'asset'),
  account(1499, '1499', 'موجودی مواد کارگاه دوم', 'subsidiary', 14, 'asset'),
  account(5001, '5001', 'درآمد فروش محصولات', 'subsidiary', 50, 'revenue'),
];
const mappings = Object.fromEntries(ACCOUNT_MAPPING_CONCEPTS.map(c => [c.key, c.defaultCode]));

beforeEach(() => {
  fetchJson.mockReset();
  toastFn.error.mockReset();
  fetchJson.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/accounting/mappings' && init?.method === 'POST') {
      throw new Error('نگاشت حساب ذخیره نشد؛ «موجودی مواد اولیه» (کد ۵۰۰۱): نوع حساب باید دارایی باشد.');
    }
    if (url === '/accounting/mappings') return { ...mappings, disabled: [], accountsCount: chart.length, chartHasAccounts: true };
    if (url === '/accounting/accounts') return chart;
    return {};
  });
});
afterEach(() => cleanup());

describe('account mapping page (TD-550)', () => {
  it('lists every server concept with Persian labels', async () => {
    render(<AccountingSettingsTab currentUser={{ role: 'admin' }} />);
    expect(await screen.findByText('کالای در جریان ساخت')).toBeTruthy();
    for (const label of ['هزینه حقوق ثابت', 'سایر کسورات پرداختنی', 'تراز اختتامیه و افتتاحیه']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByPlaceholderText('انتخاب حساب معین یا تفصیلی...')).toHaveLength(ACCOUNT_MAPPING_CONCEPTS.length);
    expect(document.body.textContent).not.toMatch(/Closing|مپینگ/);
  });

  it('the raw materials picker offers only posting asset accounts, and a refused save shows the server reason', async () => {
    render(<AccountingSettingsTab currentUser={{ role: 'admin' }} />);
    const row = (await screen.findByText('موجودی مواد اولیه')).closest('div.p-3') as HTMLElement;
    const picker = within(row).getByPlaceholderText('انتخاب حساب معین یا تفصیلی...');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: '' } });
    const options = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(options.some(t => t.includes('موجودی مواد کارگاه دوم'))).toBe(true);
    expect(options.some(t => t.includes('دارایی‌ها') || t.includes('موجودی مواد و کالا') || t.includes('درآمد فروش'))).toBe(false);
    fireEvent.click(screen.getByText('ذخیره تنظیمات'));
    await vi.waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(expect.stringContaining('نوع حساب باید دارایی باشد')));
  });
});
