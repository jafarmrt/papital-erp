import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// v10.1.x closing sweep, accounting UI: OBS-R1-51 (sync error in the error box), OBS-R1-52 (dead onViewVoucher prop),
// OBS-R1-53 UI part (decimal money sums), OBS-R1-54 (cleared mapping clears its code), OBS-R1-55 (parties of the picked kind
// only) and OBS-R2-104 (no page reload after a payslip voucher).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const apiMock = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('../../api', () => apiMock);
vi.mock('react-hot-toast', () => {
  const t = { success: vi.fn(), error: vi.fn() };
  return { default: t, toast: t };
});

const syncState = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
// one stable report object: a new object per render would loop the view's report effect
const healthQuery = vi.hoisted(() => ({
  data: {
    overallScore: 70, healthGrade: 'C', healthStatus: 'warning', scannedAt: '', scannedAtJalali: '1405/07/24', scanDurationMs: 5,
    scannedStats: { totalVouchers: 0, totalVoucherItems: 0, totalAccounts: 0, totalDocuments: 0, totalCheques: 0, totalItems: 0 },
    summary: { healthyTestsCount: 0, warningTestsCount: 0, errorTestsCount: 1, totalIssuesCount: 2 },
    tests: [{
      id: 'commercial_docs_unlinked', category: 'documents', title: 'docs', description: '', status: 'error', message: '',
      scoreImpact: 10, items: [], metrics: { unlinkedFinalDocs: 2 },
    }],
  },
  isFetching: false, isError: false, error: null, refetch: () => undefined,
}));
vi.mock('../../hooks/accounting/useAccountingAuditQueries', () => ({
  useFinancialHealthQuery: () => healthQuery,
  useSyncMissingVouchers: () => ({ isPending: false, mutateAsync: syncState.mutateAsync }),
}));

const pieceworkKeys = vi.hoisted(() => ({ canManageTasks: false, canLog: false, canIssuePayroll: true, canApprovePayroll: false, canPay: false }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({ usePieceworkPermissions: () => pieceworkKeys }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { AccountingAuditChecklistView } from '../../components/accounting/reports/AccountingAuditChecklistView';
import { AccountingSettingsTab } from '../../components/settings/AccountingSettingsTab';
import { VoucherDetailedPicker } from '../../components/accounting/VoucherDetailedPicker';
import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import { trialBalanceTotals } from '../../components/accounting/reports/trialBalanceTotals';
import type { PieceworkPayroll, TrialBalanceRow } from '../../types';

const SYNC_BUTTON = 'صدور خودکار اسناد فاکتورها';
const SYNC_FAILURE = 'صدور اسناد معوق هم‌اکنون در حال اجراست';
const PARTIAL_FAILURE = '۱ سند به دلیل خطا صادر نشد';
const SYNC_SUCCESS = '۲ سند حسابداری صادر شد';
const CLEAR_PICK = 'پاک کردن انتخاب';
const SAVE_MAPPINGS = 'ذخیره تنظیمات';
const SUPPLIER_NAME = 'تأمین‌کننده نمونه';
const PICK_CUSTOMER = 'انتخاب مشتری';
const RECORD_VOUCHER = 'ثبت سند حسابداری';

afterEach(() => {
  cleanup();
  apiMock.fetchJson.mockReset();
  syncState.mutateAsync.mockReset();
});

const boxOf = (text: string) => screen.getByText(text).closest('div') as HTMLElement;

describe('OBS-R1-51: the voucher sync message shows an error as an error', () => {
  it('a refused sync is shown in the error box, never the green success box', async () => {
    syncState.mutateAsync.mockRejectedValue(new Error(SYNC_FAILURE));
    render(<AccountingAuditChecklistView />);
    fireEvent.click(screen.getByText(SYNC_BUTTON));
    await screen.findByText(SYNC_FAILURE);
    expect(boxOf(SYNC_FAILURE).className).toContain('rose');
    expect(boxOf(SYNC_FAILURE).className).not.toContain('emerald');
    expect(screen.getByRole('alert').textContent).toContain(SYNC_FAILURE);
  });

  it('an answer with failed documents is an error and a full success stays green', async () => {
    syncState.mutateAsync.mockResolvedValue({ success: false, message: PARTIAL_FAILURE, syncedCount: 1 });
    render(<AccountingAuditChecklistView />);
    fireEvent.click(screen.getByText(SYNC_BUTTON));
    await screen.findByText(PARTIAL_FAILURE);
    expect(boxOf(PARTIAL_FAILURE).className).toContain('rose');
    cleanup();
    syncState.mutateAsync.mockResolvedValue({ success: true, message: SYNC_SUCCESS, syncedCount: 2 });
    render(<AccountingAuditChecklistView />);
    fireEvent.click(screen.getByText(SYNC_BUTTON));
    await screen.findByText(SYNC_SUCCESS);
    expect(boxOf(SYNC_SUCCESS).className).toContain('emerald');
  });
});

describe('OBS-R1-52: no unused onViewVoucher prop', () => {
  it('the explorer and fiscal closing tabs neither declare nor receive it', () => {
    for (const rel of ['src/components/accounting/AccountExplorerTab.tsx', 'src/components/accounting/FiscalYearClosingTab.tsx', 'src/pages/AccountingPage.tsx']) {
      expect(read(rel), rel).not.toContain('onViewVoucher');
    }
  });
});

describe('OBS-R1-53 (UI): browser money sums are decimal', () => {
  const row = (over: Partial<TrialBalanceRow>): TrialBalanceRow => ({
    accountId: 1, code: '1', name: 'a', level: 'group', accountType: 'asset', nature: 'debit',
    debitTurnover: 0, creditTurnover: 0, totalDebit: 0, totalCredit: 0, debitBalance: 0, creditBalance: 0, ...over,
  });

  it('the trial balance totals add 0.1 and 0.2 to exactly 0.3', () => {
    const totals = trialBalanceTotals([row({ debitBalance: 0.1, debitTurnover: 0.1 }), row({ accountId: 2, debitBalance: 0.2, debitTurnover: 0.2 }), row({ accountId: 3, level: 'general', debitBalance: 5 })], 'all');
    expect(totals.debitBalance).toBe(0.3);
    expect(totals.debitTurnover).toBe(0.3);
    expect(totals.isBalanced).toBe(false);
    expect(trialBalanceTotals([row({ debitBalance: 0.3 }), row({ accountId: 2, creditBalance: 0.1 }), row({ accountId: 3, creditBalance: 0.2 })], 'group').isBalanced).toBe(true);
  });

  it('the trial balance tab and the document line table no longer sum with Number', () => {
    const reports = read('src/components/accounting/FinancialReportsTab.tsx');
    expect(reports).not.toMatch(/\+=\s*Number\(/);
    expect(reports).toContain('trialBalanceTotals(');
    const lines = read('src/components/invoices/list/InvoiceDetailsItemsTable.tsx');
    expect(lines).not.toContain('(qty * price) - disc');
    expect(lines).toContain('addLineNet(0, it)');
  });
});

describe('OBS-R1-54: clearing a mapping picker clears its code', () => {
  it('the save body sends an empty code for the cleared concept', async () => {
    const posted: Array<Record<string, unknown>> = [];
    apiMock.fetchJson.mockImplementation(async (url: string, opts?: { method?: string; body?: string }) => {
      if (url === '/accounting/mappings' && opts?.method === 'POST') { posted.push(JSON.parse(String(opts.body))); return {}; }
      if (url === '/accounting/mappings') return { tradeReceivablesAccountCode: '1201', disabled: [], accountsCount: 1 };
      if (url === '/accounting/accounts') return [{ id: 7, code: '1201', name: 'receivables', level: 'subsidiary', accountType: 'asset', nature: 'debit', isActive: 1 }];
      return {};
    });
    render(<AccountingSettingsTab currentUser={null} />);
    const clear = await screen.findByTitle(CLEAR_PICK);
    fireEvent.click(clear);
    fireEvent.click(screen.getByText(SAVE_MAPPINGS));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].tradeReceivablesAccountCode).toBe('');
  });
});

describe('OBS-R1-55: the voucher detail picker lists only parties of the picked kind', () => {
  it('no customer party means no option under customer', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <VoucherDetailedPicker
          value={{ detailedType: 'customer', detailedId: null, detailedName: '' }} onChange={() => undefined}
          customers={[{ id: 4, name: SUPPLIER_NAME, partyType: 'supplier' }]} personnelList={[]}
        />
      </QueryClientProvider>,
    );
    const select = screen.getByLabelText(PICK_CUSTOMER) as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(screen.queryByText(SUPPLIER_NAME)).toBeNull();
  });
});

describe('OBS-R2-104: no browser dialogs or page reloads in these screens', () => {
  it('a payslip voucher refreshes through the callback, never window.location.reload', async () => {
    apiMock.fetchJson.mockResolvedValue({ voucher: { voucherNumber: 15 } });
    const onVoucherSynced = vi.fn();
    const payroll = {
      id: 1, payrollNumber: 'PR-1', personnelName: 'p', startDate: '2026-09-23', endDate: '2026-10-07', status: 'draft', voucherNumber: null,
      totalPieceworkAmount: 1000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000, paidAmount: 0, notes: '',
    } as unknown as PieceworkPayroll;
    render(<PieceworkPayrollsTab payrollsList={[payroll]} onOpenPayrollModal={() => undefined} onViewPayslip={() => undefined}
      onUpdateStatus={() => undefined} onDeletePayroll={() => undefined} onVoucherSynced={onVoucherSynced} />);
    fireEvent.click(screen.getByText(RECORD_VOUCHER));
    await waitFor(() => expect(onVoucherSynced).toHaveBeenCalledTimes(1));
    expect(read('src/components/piecework/PieceworkPayrollsTab.tsx')).not.toContain('location.reload');
    expect(read('src/pages/PieceworkPayrollPage.tsx')).toContain('invalidateAfterVoucherChange(queryClient)');
  });

  it('the treasury transfer and void windows and the mapping settings use no native alert or confirm', () => {
    for (const rel of ['src/components/accounting/treasury/TreasuryTransferModal.tsx', 'src/components/accounting/treasury/TreasuryVoidModal.tsx', 'src/components/settings/AccountingSettingsTab.tsx']) {
      expect(read(rel), rel).not.toMatch(/\b(?:window\.)?(?:alert|confirm)\(/);
    }
  });
});
