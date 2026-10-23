import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

/**
 * 10.3 (ARCH review finding 3, review of part 7): a money window counts only what it read during the current opening.
 * The windows stay mounted while closed and the cache keeps answers and errors for 30 minutes, so an earlier opening's
 * error must not show again, each opening reads the accounts again, the default account is picked once per opening, and
 * a failed refresh of a suggestion blocks the save as a failed read did before.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  issueEidi: /صدور فیش عیدی/,
  advanceBalance: /مانده مساعده تسویه‌نشده پرسنل در/,
  worker: 'کارگر',
} as const;

let failBanks = false;
let failHistoryAll = false;
let failEidi = false;
let failAdvance = false;
const BANKS = [
  { id: 1, title: 'A', type: 'bank', currency: 'IRR', code: '1' },
  { id: 2, title: 'B', type: 'bank', currency: 'IRR', code: '2' },
];
const fetchJson = vi.fn(async (url: string): Promise<unknown> => {
  if (url === '/accounting/bank-accounts/options') {
    if (failBanks) throw new Error('banks down');
    return BANKS;
  }
  if (url === '/piecework/tasks-history') {
    if (failHistoryAll) throw new Error('history down');
    return [];
  }
  if (url === '/piecework/personnel/5/advance-balance') {
    if (failAdvance) throw new Error('advance down');
    return { outstandingAdvance: 300, totalAdvances: 300, totalDeducted: 0 };
  }
  if (url.startsWith('/piecework/eidi-preview')) {
    if (failEidi) throw new Error('eidi down');
    return { suggestion: { method: 'labor_law', amount: '1000', entitlement: '1000', remainingAccrual: '0' }, period: { workedDays: 300 }, draftWarning: null };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (...args: unknown[]) => toastError(...args), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select aria-label="person" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">-</option>
      <option value="5">five</option>
    </select>
  ),
}));

import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';
import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';
import { PieceworkRateHistoryModal } from '../../components/piecework/PieceworkRateHistoryModal';
import { PayrollEidiModal } from '../../components/piecework/PayrollEidiModal';
import { PieceworkPayrollModal } from '../../components/piecework/PieceworkPayrollModal';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain } from '../../lib/queryInvalidation';
import { invalidateAfterTreasuryChange } from '../../hooks/accounting/accountingInvalidation';
import type { PieceworkTask } from '../../types';
import { READ_ON_EVERY_OPENING, useOpeningRead } from '../../hooks/queries/readOnEveryOpening';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockReset();
  failBanks = false;
  failHistoryAll = false;
  failEidi = false;
  failAdvance = false;
  onlineManager.setOnline(true);
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const withClient = (client: QueryClient) => (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
const settledDoc = { id: 2, type: 'invoice', ref_number: 'INV-2', buyer_name: 'x', currency: 'IRR', payableAmount: 200, paidAmount: 0, remainingAmount: 200 };
const payslip = { id: 7, payrollNumber: 'P-7', netPayable: 10, paidAmount: 0, status: 'approved' };
const bankReads = () => fetchJson.mock.calls.filter(([url]) => url === '/accounting/bank-accounts/options').length;
const settle = (client: QueryClient, open: boolean) => withClient(client)(
  <InvoiceSettlementModal isOpen={open} onClose={vi.fn()} onSuccess={vi.fn()} document={open ? settledDoc as never : null} />,
);
const accountSelect = () => document.querySelector('select') as HTMLSelectElement;
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

/** a failed read of the bank list, then a successful one: the cache keeps the error time */
async function bankListFailedEarlier(client: QueryClient) {
  const read = () => fetchJson('/accounting/bank-accounts/options');
  failBanks = true;
  await client.prefetchQuery({ queryKey: QUERY_KEYS.accounting.bankAccountOptions(), queryFn: read });
  failBanks = false;
  await client.fetchQuery({ queryKey: QUERY_KEYS.accounting.bankAccountOptions(), queryFn: read });
}

describe('money windows count only what this opening read (10.3)', () => {
  it('closed settlement and payment windows stay quiet about an earlier failed read', async () => {
    const client = newClient();
    await bankListFailedEarlier(client);
    render(settle(client, false));
    render(withClient(client)(<PayrollPaymentModal payroll={null} onClose={vi.fn()} />));
    await tick();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('one failed read says so once, from the open window only', async () => {
    const client = newClient();
    failBanks = true;
    render(withClient(client)(<>
      <PayrollPaymentModal payroll={null} onClose={vi.fn()} />
      <PayrollPaymentModal payroll={payslip} onClose={vi.fn()} />
    </>));
    await waitFor(() => expect(bankReads()).toBe(1));
    await tick();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('the rate history does not repeat an earlier failure when another title is viewed and closed', async () => {
    const client = newClient();
    failHistoryAll = true;
    const task = { id: 3, title: 'T' } as PieceworkTask;
    const view = (open: boolean, selected: PieceworkTask | null) => withClient(client)(
      <PieceworkRateHistoryModal isOpen={open} onClose={vi.fn()} selectedTask={selected} />,
    );
    const { rerender } = render(view(true, null));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    rerender(view(false, null));
    rerender(view(true, task));
    await tick();
    rerender(view(false, null));
    await tick();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('each opening of the settlement window reads the accounts again', async () => {
    const client = newClient();
    const { rerender } = render(settle(client, true));
    await waitFor(() => expect(bankReads()).toBe(1));
    rerender(settle(client, false));
    rerender(settle(client, true));
    await waitFor(() => expect(bankReads()).toBe(2));
  });

  it('each opening of the payment window reads the accounts again', async () => {
    const client = newClient();
    const view = (payroll: typeof payslip | null) => withClient(client)(<PayrollPaymentModal payroll={payroll} onClose={vi.fn()} />);
    const { rerender } = render(view(payslip));
    await waitFor(() => expect(bankReads()).toBe(1));
    rerender(view(null));
    rerender(view(payslip));
    await waitFor(() => expect(bankReads()).toBe(2));
  });

  it('the default account is picked once per opening: a refresh keeps the choice, a reopening picks again', async () => {
    const client = newClient();
    const { rerender } = render(settle(client, true));
    await waitFor(() => expect(accountSelect().value).toBe('1'));
    fireEvent.change(accountSelect(), { target: { value: '2' } });
    await act(() => invalidateAfterTreasuryChange(client));
    expect(accountSelect().value).toBe('2');

    rerender(settle(client, false));
    rerender(settle(client, true));
    await waitFor(() => expect(bankReads()).toBe(3));
    await waitFor(() => expect(accountSelect().value).toBe('1'));
  });

  it('a failed refresh of the eidi suggestion blocks the issue, as a failed read did before', async () => {
    const client = newClient();
    render(withClient(client)(<PayrollEidiModal personnelSelectOptions={[]} onClose={vi.fn()} onIssued={vi.fn()} />));
    fireEvent.change(screen.getByLabelText('person'), { target: { value: '5' } });
    const issue = () => screen.getByRole('button', { name: SHOWN.issueEidi });
    await waitFor(() => expect(issue().hasAttribute('disabled')).toBe(false));

    failEidi = true;
    await act(() => invalidateDomain(client, 'piecework'));
    await screen.findByText('eidi down');
    expect(issue().hasAttribute('disabled')).toBe(true);
  });

  it('an eidi suggestion cached from an earlier opening does not enable the issue before this opening reads it', async () => {
    const client = newClient();
    const first = render(withClient(client)(<PayrollEidiModal personnelSelectOptions={[]} onClose={vi.fn()} onIssued={vi.fn()} />));
    fireEvent.change(screen.getByLabelText('person'), { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('button', { name: SHOWN.issueEidi }).hasAttribute('disabled')).toBe(false));
    first.unmount();

    let answer: (value: unknown) => void = () => undefined;
    fetchJson.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    render(withClient(client)(<PayrollEidiModal personnelSelectOptions={[]} onClose={vi.fn()} onIssued={vi.fn()} />));
    fireEvent.change(screen.getByLabelText('person'), { target: { value: '5' } });
    await tick();
    expect(screen.getByRole('button', { name: SHOWN.issueEidi }).hasAttribute('disabled')).toBe(true);
    answer({ suggestion: { method: 'labor_law', amount: '1000', entitlement: '1000', remainingAccrual: '0' }, period: { workedDays: 300 }, draftWarning: null });
    await waitFor(() => expect(screen.getByRole('button', { name: SHOWN.issueEidi }).hasAttribute('disabled')).toBe(false));
  });
});

describe('money windows after a failed or impossible read (10.3)', () => {
  it('the payslip form drops the advance balance after a failed refresh, as a failed read did before', async () => {
    const client = newClient();
    const noop = () => undefined;
    render(withClient(client)(
      <PieceworkPayrollModal
        isOpen onClose={noop} onSubmit={noop} personnelSelectOptions={[{ value: '5', label: SHOWN.worker }]}
        payrollPersonnelId={5} setPayrollPersonnelId={noop} payrollStartDate="1405/01/01" setPayrollStartDate={noop}
        payrollEndDate="1405/01/31" setPayrollEndDate={noop} payrollBonuses={0} setPayrollBonuses={noop}
        payrollDeductions={0} setPayrollDeductions={noop} payrollNotes="" setPayrollNotes={noop}
        payrollPreviewLogs={[]} allowNoLogs advanceDeduction={0} setAdvanceDeduction={noop}
      />,
    ));
    expect(await screen.findByText(SHOWN.advanceBalance)).toBeTruthy();
    failAdvance = true;
    await act(() => invalidateDomain(client, 'piecework'));
    await waitFor(() => expect(screen.queryByText(SHOWN.advanceBalance)).toBeNull());
  });

  it('opening the settlement window offline says the accounts could not be read', async () => {
    onlineManager.setOnline(false);
    failBanks = true;
    render(settle(newClient(), true));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});

describe('useOpeningRead (10.3)', () => {
  const KEY = ['probe', 'opening-read'];
  let answers: Array<() => Promise<string>> = [];
  const probe = (client: QueryClient) => renderHook(
    ({ open }: { open: boolean }) => useOpeningRead(
      useQuery({ queryKey: KEY, queryFn: () => (answers.shift() ?? (() => Promise.resolve('none')))(), ...READ_ON_EVERY_OPENING, enabled: open }),
      open,
    ),
    { initialProps: { open: false }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  );

  it('ignores what was cached before the opening and keeps a list after a failed refresh, but not as current', async () => {
    const client = newClient();
    client.setQueryData(KEY, 'cached earlier');
    answers = [() => Promise.resolve('read now'), () => Promise.reject(new Error('refresh failed')), () => Promise.resolve('read again')];
    const { result, rerender } = probe(client);
    expect(result.current).toEqual({ data: undefined, current: undefined, error: null, failedAt: 0 });

    rerender({ open: true });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.current).toBe('read now'));

    await act(() => client.invalidateQueries({ queryKey: KEY }));
    await waitFor(() => expect(result.current.failedAt).toBeGreaterThan(0));
    expect(result.current.data).toBe('read now');
    expect(result.current.current).toBeUndefined();
    expect((result.current.error as Error).message).toBe('refresh failed');

    await act(() => client.invalidateQueries({ queryKey: KEY }));
    await waitFor(() => expect(result.current.current).toBe('read again'));
    expect(result.current.error).toBeNull();
    expect(result.current.failedAt).toBe(0);
  });

  it('a closed window and the next opening do not carry the last opening\'s error', async () => {
    const client = newClient();
    let release: (value: string) => void = () => undefined;
    answers = [() => Promise.reject(new Error('first opening failed')), () => new Promise<string>(resolve => { release = resolve; })];
    const { result, rerender } = probe(client);
    rerender({ open: true });
    await waitFor(() => expect(result.current.failedAt).toBeGreaterThan(0));

    rerender({ open: false });
    expect(result.current.error).toBeNull();
    rerender({ open: true });
    expect(result.current.error).toBeNull();
    expect(result.current.failedAt).toBe(0);
    act(() => release('second opening'));
    await waitFor(() => expect(result.current.current).toBe('second opening'));
  });
});
