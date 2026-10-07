import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { postingAccountsOf, postingRefusal } from '../../lib/accounting/postingAccount';

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

// v9.0.198 (TD-549, B03-07): the voucher forms offer only posting accounts (active subsidiary or detailed accounts without
// an active sub-account); general accounts such as «۱۴» were offered and the server stored rows the reports never read.

const account = (id: number, code: string, name: string, level: string, parentId: number | null, isActive = 1) => ({
  id, code, name, level, parentId, isActive, isDeleted: 0, accountType: 'expense', nature: 'debit',
});
const accounts = [
  account(1, '1', 'دارایی‌ها', 'group', null),
  account(14, '14', 'موجودی مواد و کالا', 'general', 1),
  account(1401, '1401', 'موجودی مواد اولیه', 'subsidiary', 14),
  account(7002, '7002', 'هزینه اجاره', 'subsidiary', 70),
  account(700201, '700201', 'اجاره کارگاه', 'detailed', 7002),
  account(7009, '7009', 'هزینه متفرقه', 'subsidiary', 70, 0),
  account(7010, '7010', 'هزینه آب و برق', 'subsidiary', 70),
  account(701001, '701001', 'کنتور قدیم', 'detailed', 7010, 0),
];

beforeEach(() => fetchJson.mockReset().mockResolvedValue({}));
afterEach(() => cleanup());

describe('posting accounts (TD-549)', () => {
  it('keeps only active subsidiary or detailed accounts without an active sub-account', () => {
    expect(postingAccountsOf(accounts).map(a => a.code)).toEqual(['1401', '700201', '7010']);
    expect(postingRefusal(undefined, false)).toBe('missing');
    expect(postingRefusal(accounts[1], false)).toBe('summary_level');
    expect(postingRefusal(accounts[3], true)).toBe('has_children');
    expect(postingRefusal(accounts[5], false)).toBe('inactive');
  });

  it('the voucher form offers only posting accounts', () => {
    render(<QueryClientProvider client={new QueryClient()}><NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={[]}
      personnelList={[]} onSave={vi.fn()} /></QueryClientProvider>);
    const [picker] = screen.getAllByPlaceholderText('کد یا عنوان حساب...');
    fireEvent.focus(picker);
    for (const name of ['موجودی مواد اولیه', 'اجاره کارگاه', 'هزینه آب و برق']) expect(screen.getByText(name)).toBeTruthy();
    for (const name of ['دارایی‌ها', 'موجودی مواد و کالا', 'هزینه اجاره', 'هزینه متفرقه', 'کنتور قدیم']) expect(screen.queryByText(name)).toBeNull();
  });
});
