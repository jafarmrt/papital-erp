import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));

import { voucherConfirmTexts, voucherLockNote, voucherRowActions } from '../../lib/accounting/voucherRowActions';
import { VoucherRowMenu } from '../../components/accounting/vouchers/VoucherRowMenu';
import { AutomationStatusView } from '../../components/accounting/reports/AutomationStatusView';
import { automationRow, summarizeAutomation } from '../../lib/accounting/automationStatus';
import { batchFinalizeMessage } from '../../lib/accounting/voucherBatch';
import type { JournalVoucher } from '../../types';

// Package 3 PR «و»: the journal voucher page offers only what the server accepts.

const voucher = (extra: Partial<JournalVoucher>): JournalVoucher => ({
  id: 5, voucherNumber: 12, date: '2026-10-01', voucherType: 'general', status: 'approved', totalDebit: 1000, totalCredit: 1000,
  description: 'test', items: [], ...extra,
} as JournalVoucher);

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { fetchJson.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('voucher row menu follows the server rules (TD-568, B03-26)', () => {
  it('offers per status only the actions the server accepts', () => {
    expect(voucherRowActions({ status: 'draft' })).toEqual(['edit', 'delete', 'workflow']);
    // approved: no direct edit (the server edits drafts only)
    expect(voucherRowActions({ status: 'approved' })).toEqual(['revert_to_draft', 'reverse', 'correct', 'workflow']);
    // permanent: no correction (the server refuses to correct a permanent voucher)
    expect(voucherRowActions({ status: 'permanent' })).toEqual(['reverse', 'workflow']);
    // a reversal is neither reversed nor corrected again
    expect(voucherRowActions({ status: 'approved', referenceNumber: 'REV-V31' })).toEqual(['revert_to_draft', 'workflow']);
    expect(voucherRowActions({ status: 'permanent', referenceNumber: 'VOID-REPOST-V31' })).toEqual(['workflow']);
  });

  it('locks the vouchers of a source or of a fiscal-year closing and says why', () => {
    for (const status of ['draft', 'approved', 'permanent']) {
      expect(voucherRowActions({ status, sourceKind: 'document' })).toEqual(['workflow']);
      expect(voucherRowActions({ status, sourceFiscalYear: 1404 })).toEqual(['workflow']);
    }
    expect(voucherLockNote({ status: 'approved', sourceKind: 'treasury' })).toContain('تراکنش خزانه را ابطال کنید');
    expect(voucherLockNote({ status: 'approved', sourceFiscalYear: 1404 })).toContain('بازگشایی سال ۱۴۰۴');
    expect(voucherLockNote({ status: 'approved' })).toBeNull();
  });

  it('renders the menu of an approved manual voucher without a direct edit item and runs the chosen action', () => {
    const onAction = vi.fn();
    render(<VoucherRowMenu voucher={voucher({ status: 'approved' })} onAction={onAction} />);
    const labels = screen.getAllByRole('menuitem').map(b => b.textContent);
    expect(labels).toEqual(['بازگشت به پیش‌نویس', 'صدور سند برگشتی (ابطال سند)', 'صدور سند اصلاحی جایگزین', 'گردش کار تأیید سند']);
    fireEvent.click(screen.getByText('صدور سند برگشتی (ابطال سند)'));
    expect(onAction).toHaveBeenCalledWith('reverse', expect.objectContaining({ id: 5 }));
  });

  it('shows only the lock note and the workflow for an invoice voucher', () => {
    render(<VoucherRowMenu voucher={voucher({ status: 'draft', sourceKind: 'document' })} onAction={vi.fn()} />);
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual(['گردش کار تأیید سند']);
    expect(screen.getByText(/این سند را سند انبار یا فاکتور صادر کرده است/)).toBeTruthy();
  });

  it('confirm texts promise no path the server lacks and use Persian digits', () => {
    const finalize = voucherConfirmTexts('finalize', { status: 'approved', voucherNumber: 12 });
    expect(finalize.message).not.toContain('سند اصلاحی');
    expect(finalize.message).toContain('سند شماره ۱۲');
    expect(voucherConfirmTexts('finalize', { status: 'approved', voucherNumber: 12, sourceKind: 'payroll' }).message).toContain('ابطال فیش حقوق');
    const approve = voucherConfirmTexts('approve', { status: 'draft', voucherNumber: 7 });
    expect(approve.confirmText).toBe('بله، تأیید شود');
    expect(approve.confirmText).not.toContain('ثبت قطعی');
  });
});

describe('batch finalize message (TD-556, B03-14)', () => {
  it('counts what was finalized and names each refusal', () => {
    expect(batchFinalizeMessage({ finalizedCount: 2, refused: [] })).toBe('۲ سند قطعی و دائم شد.');
    expect(batchFinalizeMessage({ finalizedCount: 1, refused: [
      { id: 40, voucherNumber: 12, reason: 'سند پیش‌تر قطعی شده است' },
      { id: 99, voucherNumber: null, reason: 'سند یافت نشد' },
    ] })).toBe('۱ سند قطعی و دائم شد؛ ۲ سند قطعی نشد: سند ۱۲ (سند پیش‌تر قطعی شده است)، سند ۹۹ (سند یافت نشد).');
  });
});

describe('automation status panel (TD-560, B03-18)', () => {
  it('summary: coverage reaches 100 only when every needed voucher exists', () => {
    const rows = [automationRow('invoice', { totalDocs: 1000, needVoucher: 1000, withVoucher: 999 }), automationRow('transfer', { totalDocs: 4, needVoucher: 0, withVoucher: 0 })];
    const summary = summarizeAutomation(rows);
    expect(summary.coveragePercent).toBe(99);
    expect(summary.missingTypes).toEqual([{ docType: 'invoice', label: 'فاکتور فروش', missingVoucher: 1 }]);
  });

  it('shows stock counts as automatic, transfers as without financial effect, and warns only for types missing a voucher', async () => {
    const report = [
      automationRow('invoice', { totalDocs: 3, needVoucher: 3, withVoucher: 2 }),
      automationRow('audit', { totalDocs: 3, needVoucher: 3, withVoucher: 3 }),
      automationRow('transfer', { totalDocs: 2, needVoucher: 0, withVoucher: 0 }),
    ];
    fetchJson.mockResolvedValue({ report, summary: summarizeAutomation(report) });
    renderWithClient(<AutomationStatusView />);
    await screen.findByText('سند انبارگردانی');
    expect(screen.getByText('بی اثر مالی')).toBeTruthy();
    expect(screen.getByText('خودکار، برای اختلاف ارزش‌دار')).toBeTruthy();
    const banner = screen.getByText(/اسناد نهایی بی سند حسابداری:/).parentElement?.textContent ?? '';
    expect(banner).toContain('«فاکتور فروش» ۱ سند');
    expect(banner).not.toContain('انبارگردانی');
    expect(document.body.textContent).not.toContain('نیازمند صدور دستی');
    expect(document.body.textContent).not.toContain('پیش‌فاکتور');
  });
});
