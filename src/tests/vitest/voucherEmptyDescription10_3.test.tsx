import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

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
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ id, value, onChange }: { id?: string; value: string; onChange: (iso: string) => void }) => (
    <input id={id} value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { NewVoucherModal } from '../../components/accounting/NewVoucherModal';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 package 4 (10.2 backlog, review of the voucher Ctrl+S fix): a balanced voucher without a description is refused
 * with a Persian message and the description field takes the focus. Red on v10.3.18: the field was `required`, so Ctrl+S
 * stopped at the form's validity check and showed only the browser's own bubble.
 */
/** Persian text the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  restoreDraft: 'بازیابی پیش‌نویس',
  deleteRow: 'حذف سطر (Alt+D)',
  descriptionLabel: 'شرح کلی سند حسابداری *',
  descriptionRequired: 'شرح کلی سند الزامی است',
  saveButton: 'ذخیره پیش‌نویس سند (Ctrl+S)',
} as const;

const accounts = [
  { id: 1201, code: '1201', name: 'Receivables', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'Sales', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];
const draftRow = (accountId: number, debit: number, credit: number) => ({
  accountId, detailedType: 'none', detailedId: null, detailedName: '', debit, credit, description: '',
});

beforeEach(() => {
  fetchJson.mockReset();
  toastFn.error.mockReset();
  const draft = {
    date: '2026-10-18', voucherType: 'general', manualVoucherNumber: '', description: '', currency: 'IRR', attachments: [],
    items: [draftRow(1201, 250_000, 0), draftRow(5001, 0, 250_000)],
  };
  fetchJson.mockImplementation(async (url: string) => (url === '/drafts/voucher?draftKey=new_voucher'
    ? { draft: { payload: draft, updatedAt: '2026-10-18T08:00:00Z', isDeleted: 0 } } : {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openBalancedDraftWithoutDescription(onSave: (data: unknown) => Promise<void>) {
  render(
    <QueryClientProvider client={appQueryClient()}>
      <NewVoucherModal isOpen onClose={vi.fn()} accounts={accounts as never} customers={[]} personnelList={[]} onSave={onSave} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText(SHOWN.restoreDraft));
  await waitFor(() => expect(screen.getAllByTitle(SHOWN.deleteRow)).toHaveLength(2));
}

describe('an empty voucher description is told in Persian (10.3 package 4)', () => {
  it('Ctrl+S on a balanced voucher without a description shows the Persian message, focuses the field and saves nothing', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await openBalancedDraftWithoutDescription(onSave);
    const field = screen.getByLabelText(SHOWN.descriptionLabel);
    expect(field.hasAttribute('required')).toBe(false);
    expect(field.getAttribute('aria-required')).toBe('true');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(SHOWN.descriptionRequired));
    expect(document.activeElement).toBe(field);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('the save button does the same, and a description lets the voucher save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await openBalancedDraftWithoutDescription(onSave);
    const field = screen.getByLabelText(SHOWN.descriptionLabel);
    const form = screen.getByText(SHOWN.saveButton).closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(SHOWN.descriptionRequired));
    expect(document.activeElement).toBe(field);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'سند آزمایشی' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
