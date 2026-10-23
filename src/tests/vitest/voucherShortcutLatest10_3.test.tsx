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
// the Jalali date picker as a plain field holding the ISO date, so a test can change the date directly
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ id, value, onChange }: { id?: string; value: string; onChange: (iso: string) => void }) => (
    <input id={id} value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { NewVoucherModal } from '../../components/accounting/NewVoucherModal';

/**
 * 10.3 (ARCH review finding 4 and the Ctrl+S double save of the 10.2 backlog): the voucher shortcuts act on what the form
 * shows, and one save runs at a time. Red on v10.3.0: Ctrl+S after changing only the type or the reference number sent the
 * earlier values, and a second Ctrl+S before the first answer called the save again.
 */
/** Persian text the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  restoreDraft: 'بازیابی پیش‌نویس',
  deleteRow: 'حذف سطر (Alt+D)',
  description: 'سند آزمایشی',
  reference: 'سند فیزیکی ۹۸',
  typeLabel: 'نوع سند',
  referenceLabel: 'شماره عطف دستی (اختیاری)',
  dateLabel: 'تاریخ سند *',
  saveButton: 'ذخیره پیش‌نویس سند (Ctrl+S)',
} as const;

const accounts = [
  { id: 1201, code: '1201', name: 'Receivables', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'Sales', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
const draftRow = (n: number, debit: number, credit: number) => ({
  accountId: n % 2 ? 1201 : 5001, detailedType: 'none', detailedId: null, detailedName: '', debit, credit, description: '',
});

function serveBalancedDraft() {
  const draft = {
    date: '2026-10-18', voucherType: 'general', manualVoucherNumber: '', description: SHOWN.description, currency: 'IRR', attachments: [],
    items: [draftRow(1, 250_000, 0), draftRow(2, 0, 250_000)],
  };
  fetchJson.mockImplementation(async (url: string) => (url === '/drafts/voucher?draftKey=new_voucher'
    ? { draft: { payload: draft, updatedAt: '2026-10-18T08:00:00Z', isDeleted: 0 } } : {}));
}

async function openRestoredDraft(onSave: (data: unknown) => Promise<void>) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewVoucherModal isOpen onClose={onClose} accounts={accounts as never} customers={[]} personnelList={[]} onSave={onSave} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText(SHOWN.restoreDraft));
  await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(2));
  return onClose;
}

const pressCtrlS = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

beforeEach(() => { fetchJson.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); serveBalancedDraft(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('voucher shortcuts act on the form on screen (10.3)', () => {
  it('Ctrl+S after changing only the date, the type and the reference number sends the new values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await openRestoredDraft(onSave);

    fireEvent.change(screen.getByLabelText(SHOWN.dateLabel), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(SHOWN.typeLabel), { target: { value: 'sales' } });
    fireEvent.change(screen.getByLabelText(SHOWN.referenceLabel), { target: { value: SHOWN.reference } });
    pressCtrlS();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      date: '2026-10-20', voucherType: 'sales', manualVoucherNumber: SHOWN.reference, description: SHOWN.description,
    });
  });

  it('Ctrl+S after the date alone sends that date', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await openRestoredDraft(onSave);

    fireEvent.change(screen.getByLabelText(SHOWN.dateLabel), { target: { value: '2026-10-21' } });
    pressCtrlS();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ date: '2026-10-21' });
  });

  it('a second Ctrl+S or Ctrl+Enter before the answer saves nothing more; after the answer the window closes', async () => {
    let answer: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>(resolve => { answer = resolve; }));
    const onClose = await openRestoredDraft(onSave);

    pressCtrlS();
    pressCtrlS();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => { answer(); await Promise.resolve(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('the save button and Ctrl+S share one save: a click, Ctrl+S, a form submit and a second click record once', async () => {
    let answer: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>(resolve => { answer = resolve; }));
    const onClose = await openRestoredDraft(onSave);
    const button = screen.getByText(SHOWN.saveButton).closest('button') as HTMLButtonElement;

    fireEvent.click(button);
    pressCtrlS();
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => { answer(); await Promise.resolve(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a failed save lets the next Ctrl+S try again', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('server unavailable')).mockResolvedValueOnce(undefined);
    await openRestoredDraft(onSave);

    pressCtrlS();
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith('server unavailable'));
    pressCtrlS();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });
});
