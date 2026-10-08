import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { fetchJson, toastFn, confirmAction } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t, confirmAction: vi.fn() };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...a: unknown[]) => confirmAction(...a) }));
// v9.0.228 (TD-567): the seed button shows only for the system admin
vi.mock('../../contexts/AuthContext', () => ({ useIsSystemAdmin: () => true, useHasPermission: () => true }));

import { ChartOfAccountsSettingsTab } from '../../components/settings/ChartOfAccountsSettingsTab';

// v9.0.203 (TD-576, B03-34): the chart of accounts settings tab showed every save and error message twice, its seed button
// left a refused request as an unhandled rejection, and the delete confirm said nothing about accounts used in vouchers.

const accounts = [
  { id: 1, code: '1', name: 'دارایی‌ها', level: 'group', parentId: null, accountType: 'asset', nature: 'debit', isSystem: 1, balance: 0 },
  { id: 11, code: '11', name: 'دارایی‌های جاری', level: 'general', parentId: 1, accountType: 'asset', nature: 'debit', isSystem: 1, balance: 0 },
  { id: 1101, code: '1101', name: 'صندوق', level: 'subsidiary', parentId: 11, accountType: 'asset', nature: 'debit', isSystem: 0, balance: 0 },
];
const tree = [{ ...accounts[0], children: [{ ...accounts[1], children: [{ ...accounts[2], children: [] }] }] }];

function server(write?: (method: string, url: string) => unknown) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/accounting/accounts') return accounts;
    if (method === 'GET' && url === '/accounting/accounts/tree') return tree;
    if (method !== 'GET') return write ? write(method, url) : { id: 1105, ...JSON.parse(init?.body ?? '{}') };
    return [];
  });
}
const renderTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
  return render(wrap(<ChartOfAccountsSettingsTab />));
};
const createAccount = () => {
  fireEvent.click(screen.getByText('تعریف حساب جدید'));
  fireEvent.change(screen.getByPlaceholderText('مثال: 1001'), { target: { value: '1105' } });
  fireEvent.change(screen.getByPlaceholderText('مثال: صندوق مرکزی کارگاه'), { target: { value: 'صندوق فروشگاه' } });
  fireEvent.click(screen.getByText('ایجاد حساب'));
};

beforeEach(() => { fetchJson.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); confirmAction.mockReset(); });
afterEach(() => cleanup());

/** Server error messages that the page shows as they are */
const CODE_TAKEN = 'کد ۱۱۰۵ را حساب «صندوق دوم» دارد؛ کد دیگری انتخاب کنید.';
const NO_ACCESS = 'شما دسترسی لازم را ندارید';

describe('chart of accounts messages (TD-576)', () => {
  it('a saved account shows one success message and a refused one one error message', async () => {
    server();
    renderTab();
    await screen.findByText('صندوق');
    createAccount();
    await waitFor(() => expect(toastFn.success).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(toastFn.success).toHaveBeenCalledTimes(1);

    server(() => { throw new Error(CODE_TAKEN); });
    createAccount();
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(toastFn.error.mock.calls.map(c => c[0])).toEqual([CODE_TAKEN]);
  });

  it('a refused seed shows its error once and leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      server(() => { throw new Error(NO_ACCESS); });
      renderTab();
      await screen.findByText('صندوق');
      await act(async () => { fireEvent.click(screen.getByText('همگام‌سازی کدینگ پیش‌فرض')); });
      await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(NO_ACCESS));
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(toastFn.error).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('the delete confirm says an account used in vouchers is not deleted and points to deactivation', async () => {
    server();
    confirmAction.mockResolvedValue(false);
    renderTab();
    await screen.findByText('صندوق');
    const row = screen.getByText('صندوق').closest('div.select-none') as HTMLElement;
    fireEvent.click(within(row).getAllByTitle('حذف')[0]);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction.mock.calls[0][0]).toEqual({
      title: 'حذف حساب',
      message: 'حساب «صندوق» (کد ۱۱۰۱) حذف شود؟ حسابی که در سندی به کار رفته یا زیرحساب دارد حذف نمی‌شود؛ برای کنار گذاشتن چنین حسابی، آن را غیرفعال کنید.',
    });
    expect(fetchJson.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'DELETE')).toHaveLength(0);
  });
});
