import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import { withFreshRowKeys, withoutRowKey, withRowKeys } from '../../lib/rowKey';

// v10.2.4 (TD-1291, final delta review B1 / M1): the browser row key never goes into the voucher draft, a restored draft gets
// fresh keys, and Ctrl+S does not save a form whose amount field holds a misplaced separator.

/** Persian text the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  restoreDraft: 'بازیابی پیش‌نویس',
  addRow: 'کلید میانبر: Alt+N یا Insert',
  deleteRow: 'حذف سطر (Alt+D)',
  groupKey: '٬',
  description: 'سند آزمایشی',
} as const;

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const accounts = [
  { id: 1201, code: '1201', name: 'Receivables', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'Sales', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
const draftRow = (n: number, debit: number, credit: number) => ({
  rowKey: `row-${n}`, accountId: n % 2 ? 1201 : 5001, detailedType: 'none', detailedId: null, detailedName: '', debit, credit, description: '',
});

function serveDraft(items: unknown[]) {
  const draft = { date: '2026-10-18', voucherType: 'general', manualVoucherNumber: '', description: SHOWN.description, currency: 'IRR', attachments: [], items };
  fetchJson.mockImplementation(async (url: string) => (url === '/drafts/voucher?draftKey=new_voucher'
    ? { draft: { payload: draft, updatedAt: '2026-10-18T08:00:00Z', isDeleted: 0 } } : {}));
}
function renderNew() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={client()}><NewVoucherModal isOpen onClose={() => {}} accounts={accounts as never} customers={[]} personnelList={[]} onSave={onSave} /></QueryClientProvider>);
  return onSave;
}
const amountFields = () => screen.getAllByRole('textbox').filter(el => el.getAttribute('data-decimal-input') !== null) as HTMLInputElement[];
async function nextFrame() {
  await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); });
}
async function typeKeys(input: HTMLInputElement, keys: string[]) {
  input.focus();
  for (const key of keys) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const caret = start + key.length;
    fireEvent.change(input, { target: { value: input.value.slice(0, start) + key + input.value.slice(end), selectionStart: caret, selectionEnd: caret } });
    await nextFrame();
  }
}

beforeEach(() => { fetchJson.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('TD-1291 voucher row keys stay in the browser', () => {
  it('row key helpers: a stored key is dropped and every restored row gets a new unique key', () => {
    const fresh = withFreshRowKeys([{ a: 1, rowKey: 'row-1' }, { a: 2, rowKey: 'row-1' }]);
    expect(fresh[0].rowKey).not.toBe('row-1');
    expect(new Set([...fresh, ...withRowKeys([{ a: 3 }])].map(r => r.rowKey)).size).toBe(3);
    expect('rowKey' in withoutRowKey({ a: 1, rowKey: 'row-9' })).toBe(false);
  });

  it('reload, restore a draft with stored keys, add a row and delete row 2: four rows, no duplicate keys, draft saved without keys', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    serveDraft([draftRow(1, 100, 0), draftRow(2, 0, 50), draftRow(3, 0, 30), draftRow(4, 0, 20)]);
    renderNew();
    fireEvent.click(await screen.findByText(SHOWN.restoreDraft));
    await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(4));
    fireEvent.click(screen.getByTitle(SHOWN.addRow));
    await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(5));
    fireEvent.click(screen.getAllByTitle(SHOWN.deleteRow)[1]);
    await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(4));
    expect(amountFields()).toHaveLength(8);
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(false);

    await waitFor(() => expect(fetchJson.mock.calls.some(([url, opts]) => url === '/drafts' && (opts as { method?: string })?.method === 'POST')).toBe(true), { timeout: 10000 });
    const posts = fetchJson.mock.calls.filter(([url]) => url === '/drafts');
    const saved = JSON.parse(String((posts[posts.length - 1][1] as { body: string }).body)) as { payload: { items: Array<Record<string, unknown>> } };
    expect(saved.payload.items).toHaveLength(4);
    expect(saved.payload.items.every(row => !('rowKey' in row))).toBe(true);
  }, 20000);

  it('Ctrl+S does not save while a credit field still holds 12,5 after a debit was typed in the same row', async () => {
    serveDraft([draftRow(1, 0, 100), draftRow(2, 0, 0)]);
    const onSave = renderNew();
    fireEvent.click(await screen.findByText(SHOWN.restoreDraft));
    await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(2));
    const [, , debit2, credit2] = amountFields();
    await typeKeys(credit2, ['1', '2', SHOWN.groupKey, '5']);
    expect(credit2.validity.valid).toBe(false);
    await typeKeys(debit2, ['1', '0', '0']);
    expect(credit2.validity.valid).toBe(false);

    const form = credit2.closest('form') as HTMLFormElement;
    const reportValidity = vi.spyOn(form, 'reportValidity');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await nextFrame();
    expect(reportValidity).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
