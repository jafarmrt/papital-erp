import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { PieceworkPayroll } from '../../types';
import { rialDisplayOf } from '../../lib/rialDisplay';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';
import { formatPersianCode } from '../../utils';

/**
 * 10.3 (ARCH review finding 3, part 15): the payslip window shows its payslip's cache entry. A payment, approval or
 * return made while it is open shows at once (before, it kept the figures it opened with: a paid slip still offered
 * «بازگشت به پیش‌نویس» and its old remainder); while the slip is read again, or when that read failed, its writes wait.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  approve: 'تأیید فیش',
  backToDraft: 'بازگشت به پیش‌نویس',
  pay: 'ثبت پرداخت (از خزانه)',
  voidSlip: 'ابطال فیش',
  print: 'چاپ فیش',
  refreshFailed: /فیش پس از آخرین تغییر دوباره خوانده نشد/,
} as const;

type Opts = { method?: string; body?: string; signal?: AbortSignal };
const slips = new Map<number, PieceworkPayroll>();
const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  const id = Number(url.match(/^\/piecework\/payrolls\/(\d+)/)?.[1]);
  if (opts?.method === 'PUT' && url.endsWith('/status')) {
    const slip = slips.get(id);
    if (slip) slips.set(id, { ...slip, status: JSON.parse(opts.body ?? '{}').status });
    return { message: 'done' };
  }
  if (opts?.method === 'DELETE') { slips.delete(id); return { message: 'done' }; }
  if (opts?.method) return { message: 'done' };
  if (reads.hold === url) { reads.hold = null; return new Promise(resolve => { reads.held.push(resolve); }); }
  if (reads.fail === url) { reads.fail = null; throw new Error('server refused the read'); }
  if (id && slips.has(id)) return slips.get(id);
  return [];
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => toastError(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { isAdmin: true, permissions: [] } }),
  useViewerIdentity: () => ({ id: 1, isAdmin: true }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf: display } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => display('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canApprovePayroll: true, canPay: true }),
}));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import { usePiecework } from '../../hooks/usePiecework';
import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  slips.clear();
  Object.assign(reads, { hold: null, fail: null, held: [] });
});

const slip = (id: number, status: PieceworkPayroll['status'], paidAmount = 0): PieceworkPayroll => ({
  id, payrollNumber: `PAY-${id}`, personnelId: 5, personnelName: 'worker', startDate: '2026-08-23', endDate: '2026-09-22', title: 'slip',
  totalPieceworkAmount: 1_000_000, totalBonuses: 0, totalDeductions: 0, netPayable: 1_000_000, paidAmount, status, createdById: null,
});
const rial = rialDisplayOf('IRR');
const button = (text: string) => screen.getByText(text).closest('button') as HTMLButtonElement;
const listReadsOf = () => fetchJson.mock.calls.filter(([u, o]) => u === '/piecework/payrolls' && !o?.method).length;
const slipReads = (id: number) => fetchJson.mock.calls.filter(([u, o]) => u === `/piecework/payrolls/${id}` && !o?.method).length;

let hook: ReturnType<typeof usePiecework>;
/** the payroll page's payslip window, wired as the page wires it */
function PayslipWindow() {
  hook = usePiecework();
  return (
    <PieceworkPayslipModal
      viewingPayroll={hook.viewingPayroll}
      freshness={hook.viewingPayrollFreshness}
      onClose={hook.closePayslip}
      onUpdateStatus={hook.handleUpdatePayrollStatus}
      onDeletePayroll={hook.handleDeletePayroll}
      onReload={hook.reloadAfterPayrollChange}
    />
  );
}
/** the app's read defaults (fresh for five minutes): the window must read again on its own */
const client = appQueryClient;
async function openSlip(id: number, queryClient = client()) {
  render(<QueryClientProvider client={queryClient}><PayslipWindow /></QueryClientProvider>);
  await act(async () => { await hook.handleViewPayslip(id); });
  // v11 phase 6.3a (U21): the window shows the slip number in Persian digits, in its title and its header
  expect((await screen.findAllByText(new RegExp(`PAY-${formatPersianCode(id)}`))).length).toBeGreaterThan(0);
  return queryClient;
}

describe('the payslip window shows its payslip as the server has it now (10.3)', () => {
  it('a payment made from the window shows its paid amount and no longer offers a return to draft', async () => {
    slips.set(7, slip(7, 'approved'));
    await openSlip(7);
    expect(button(SHOWN.backToDraft)).toBeTruthy();
    slips.set(7, slip(7, 'partially_paid', 400_000));
    // what the payment window's «onPaid» does
    await act(async () => { hook.reloadAfterPayrollChange(); });
    await waitFor(() => expect(screen.queryByText(SHOWN.backToDraft)).toBeNull());
    expect(screen.getByText(`+${rial.amount(400_000)}`)).toBeTruthy();
    expect(screen.getByText(rial.amount(600_000))).toBeTruthy();
  });

  it('an approval reads the slip again instead of patching the one on screen', async () => {
    slips.set(7, slip(7, 'draft'));
    await openSlip(7);
    fireEvent.click(button(SHOWN.approve));
    await waitFor(() => expect(slipReads(7)).toBe(2));
    expect(await screen.findByText(SHOWN.pay)).toBeTruthy();
    expect(screen.queryByText(SHOWN.approve)).toBeNull();
  });

  it('its writes wait while the slip is read again after a write', async () => {
    slips.set(7, slip(7, 'approved'));
    const queryClient = await openSlip(7);
    reads.hold = '/piecework/payrolls/7';
    act(() => { void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all }); });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    for (const text of [SHOWN.pay, SHOWN.backToDraft, SHOWN.voidSlip, SHOWN.print]) expect(button(text).disabled).toBe(true);
    await act(async () => { reads.held[0]?.(slip(7, 'approved')); });
    await waitFor(() => expect(button(SHOWN.pay).disabled).toBe(false));
    expect(button(SHOWN.backToDraft).disabled).toBe(false);
    expect(button(SHOWN.voidSlip).disabled).toBe(false);
    expect(button(SHOWN.print).disabled).toBe(false);
  });

  it('a failed read after a write says so and keeps its writes waiting', async () => {
    slips.set(7, slip(7, 'draft'));
    const queryClient = await openSlip(7);
    reads.fail = '/piecework/payrolls/7';
    await act(async () => { await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all }); });
    expect((await screen.findByRole('alert')).textContent).toMatch(SHOWN.refreshFailed);
    expect(button(SHOWN.approve).disabled).toBe(true);
    expect(button(SHOWN.voidSlip).disabled).toBe(true);
    expect(button(SHOWN.print).disabled).toBe(true);
  });
});

describe('opening the payslip window (10.3)', () => {
  it('reads the slip again on every opening', async () => {
    slips.set(7, slip(7, 'approved'));
    await openSlip(7);
    act(() => { hook.closePayslip(); });
    slips.set(7, slip(7, 'paid', 1_000_000));
    await act(async () => { await hook.handleViewPayslip(7); });
    await waitFor(() => expect(screen.getByText(`+${rial.amount(1_000_000)}`)).toBeTruthy());
    expect(slipReads(7)).toBe(2);
  });

  it('an earlier click whose answer comes late never opens over the later one', async () => {
    slips.set(7, slip(7, 'approved'));
    slips.set(8, slip(8, 'approved'));
    render(<QueryClientProvider client={client()}><PayslipWindow /></QueryClientProvider>);
    reads.hold = '/piecework/payrolls/7';
    let first: Promise<void> = Promise.resolve();
    act(() => { first = hook.handleViewPayslip(7); });
    await act(async () => { await hook.handleViewPayslip(8); });
    expect((await screen.findAllByText(/PAY-۸/)).length).toBeGreaterThan(0);
    await act(async () => { reads.held[0]?.(slips.get(7)); await first; });
    expect(screen.queryAllByText(/PAY-۷/)).toHaveLength(0);
    expect(screen.getAllByText(/PAY-۸/).length).toBeGreaterThan(0);
  });

  it('a failed read opens no window and says why, as before', async () => {
    slips.set(7, slip(7, 'approved'));
    render(<QueryClientProvider client={client()}><PayslipWindow /></QueryClientProvider>);
    reads.fail = '/piecework/payrolls/7';
    await act(async () => { await hook.handleViewPayslip(7); });
    expect(toastError).toHaveBeenCalledWith('server refused the read');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('voiding the slip on screen closes its window, reads the payroll list again and never reads the slip again', async () => {
    slips.set(7, slip(7, 'draft'));
    await openSlip(7);
    const listReads = listReadsOf();
    fireEvent.click(button(SHOWN.voidSlip));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(listReadsOf()).toBeGreaterThan(listReads));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slipReads(7)).toBe(1);
  });

  it('the payroll page makes no read of its own', () => {
    expect(ownReads('hooks/usePiecework.ts')).toEqual([]);
  });
});
