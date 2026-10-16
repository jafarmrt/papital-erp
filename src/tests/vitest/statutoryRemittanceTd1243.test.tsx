import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() }, toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => granted.has(key) }));

import {
  STATUTORY_REMITTANCE_NOTHING, STATUTORY_REMITTANCE_PERMISSION, STATUTORY_REMITTANCE_TEXT,
  statutoryRemittanceDraftLines, statutoryRemittanceFormError, statutoryRemittancePayload, statutoryRemittanceTotal,
  type StatutoryRemittanceOptions,
} from '../../lib/treasury/statutoryRemittance';
import { StatutoryRemittanceModal } from '../../components/piecework/StatutoryRemittanceModal';
import { PayrollStatutoryReportModal } from '../../components/piecework/PayrollStatutoryReportModal';

/**
 * TD-1243 (product-owner decision t33 «الف»): one treasury payment for a month's insurance or payroll tax list, with a
 * row per person. The window lists only personnel with an amount this month, suggests each balance, refuses an amount
 * above a balance before sending, and sends the server body; the report window shows the two buttons only to treasury
 * users.
 */

afterEach(() => { cleanup(); fetchJson.mockReset(); granted.clear(); });

const HIGH = 'کارگر بیمه‌شده';
const LOW = 'کارگر دوم';
const PAID = 'کارگر پرداخت‌شده';
const BANK_TITLE = 'بانک ملت کارگاه';
const ACCOUNT_NAME = 'بیمه پرداختنی';

const options = (rows: StatutoryRemittanceOptions['rows'] = []): StatutoryRemittanceOptions => ({
  kind: 'insurance', jalaliYear: 1405, jalaliMonth: 1, accountCode: '3204', accountName: ACCOUNT_NAME, rows,
  totals: { monthAmount: '0', remitted: '0', suggested: '0' },
});
const ROWS: StatutoryRemittanceOptions['rows'] = [
  { personnelId: 1, fullName: HIGH, personnelCode: 'P1', monthAmount: '6000000', remitted: '0', balance: '6000000', suggested: '6000000' },
  { personnelId: 2, fullName: LOW, personnelCode: '', monthAmount: '3000000', remitted: '0', balance: '3000000', suggested: '3000000' },
  { personnelId: 3, fullName: PAID, personnelCode: '', monthAmount: '1000000', remitted: '1000000', balance: '0', suggested: '0' },
];

function serve(rows: StatutoryRemittanceOptions['rows']) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { id: 99 };
    if (url.startsWith('/accounting/treasury/statutory-remittance/options')) return options(rows);
    if (url === '/accounting/bank-accounts/options') {
      return { data: [
        { id: 5, code: 'B1', title: BANK_TITLE, type: 'bank', bankName: null, currency: 'IRR', hasLedgerAccount: true },
        { id: 6, code: 'B2', title: 'USD', type: 'bank', bankName: null, currency: 'USD', hasLedgerAccount: true },
      ] };
    }
    if (url === '/accounting/treasury/contra-accounts') return { data: [{ id: 70, code: '7009', name: 'سایر هزینه‌ها', accountType: 'expense' }] };
    return {};
  });
}

const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;

describe('monthly remittance rules (TD-1243)', () => {
  it('suggests each balance and leaves out a person with nothing left', () => {
    const lines = statutoryRemittanceDraftLines(options(ROWS));
    expect(lines.map(l => [l.personnelId, l.include, l.amount])).toEqual([[1, true, '6000000'], [2, true, '3000000'], [3, false, '']]);
    expect(statutoryRemittanceTotal(lines, '150000').toNumber()).toBe(9_150_000);
  });

  it('refuses no person, a non-positive amount, an amount above a balance, no bank, and a penalty without its account', () => {
    const lines = statutoryRemittanceDraftLines(options(ROWS));
    const base = { lines, bankAccountId: '5', penaltyAmount: '', penaltyAccountId: '' };
    expect(statutoryRemittanceFormError(base)).toBe('');
    expect(statutoryRemittanceFormError({ ...base, lines: lines.map(l => ({ ...l, include: false })) })).not.toBe('');
    expect(statutoryRemittanceFormError({ ...base, lines: lines.map(l => (l.personnelId === 1 ? { ...l, amount: '0' } : l)) })).toContain(HIGH);
    expect(statutoryRemittanceFormError({ ...base, lines: lines.map(l => (l.personnelId === 2 ? { ...l, amount: '3000001' } : l)) })).toContain(LOW);
    expect(statutoryRemittanceFormError({ ...base, bankAccountId: '' })).not.toBe('');
    expect(statutoryRemittanceFormError({ ...base, penaltyAmount: '1000' })).not.toBe('');
    expect(statutoryRemittanceFormError({ ...base, penaltyAmount: '1000', penaltyAccountId: '70' })).toBe('');
  });

  it('sends only the chosen people, with Latin digits, and no penalty when it is empty', () => {
    const lines = statutoryRemittanceDraftLines(options(ROWS)).map(l => (l.personnelId === 2 ? { ...l, amount: '۲۵۰۰۰۰۰' } : l));
    const body = statutoryRemittancePayload({
      kind: 'insurance', jalaliYear: 1405, jalaliMonth: 1, lines, bankAccountId: '5', penaltyAmount: '', penaltyAccountId: '',
      date: '2026-04-20', method: 'bank_transfer', trackingNumber: ' ', description: '',
    });
    expect(body).toEqual({
      kind: 'insurance', year: 1405, month: 1, bankAccountId: 5, date: '2026-04-20', method: 'bank_transfer',
      lines: [{ personnelId: 1, amount: '6000000' }, { personnelId: 2, amount: '2500000' }],
    });
    const withPenalty = statutoryRemittancePayload({
      kind: 'tax', jalaliYear: 1405, jalaliMonth: 1, lines, bankAccountId: '5', penaltyAmount: '150000', penaltyAccountId: '70',
      date: '2026-04-20', method: 'cash', trackingNumber: 'T-1', description: '',
    });
    expect(withPenalty.penalty).toEqual({ amount: '150000', accountId: 70 });
    expect(withPenalty.trackingNumber).toBe('T-1');
  });
});

describe('remittance window (TD-1243)', () => {
  it('lists the people, offers only rial banks with a ledger account, and posts the payment', async () => {
    serve(ROWS);
    render(wrap(<StatutoryRemittanceModal kind="insurance" jalaliYear={1405} jalaliMonth={1} onClose={() => undefined} />));
    expect(await screen.findByLabelText(`مبلغ پرداخت ${HIGH} (ریال)`)).toBeTruthy();
    expect(screen.getByLabelText(`مبلغ پرداخت ${LOW} (ریال)`)).toBeTruthy();
    const bank = await screen.findByLabelText(/حساب بانکی یا صندوق/) as HTMLSelectElement;
    await waitFor(() => expect(bank.options.length).toBe(2));
    fireEvent.change(bank, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'ثبت پرداخت با سند حسابداری' }));
    await waitFor(() => expect(fetchJson.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')).toBe(true));
    const post = fetchJson.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');
    expect(post?.[0]).toBe('/accounting/treasury/statutory-remittance');
    const sent = JSON.parse(String((post?.[1] as { body?: string }).body));
    expect(sent.lines).toEqual([{ personnelId: 1, amount: '6000000' }, { personnelId: 2, amount: '3000000' }]);
    expect(sent.bankAccountId).toBe(5);
  });

  it('says there is nothing to pay in a month without insurance', async () => {
    serve([]);
    render(wrap(<StatutoryRemittanceModal kind="insurance" jalaliYear={1405} jalaliMonth={1} onClose={() => undefined} />));
    expect(await screen.findByText(STATUTORY_REMITTANCE_NOTHING)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ثبت پرداخت با سند حسابداری' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the two payment buttons in the monthly list only to treasury users', async () => {
    const report = { jalaliYear: 1405, jalaliMonth: 1, from: '', to: '', rows: [], totals: { gross: '0', employeeInsurance: '0', employerInsurance: '0', incomeTax: '0' }, draftPayslips: 0, withoutStatutory: { personnel: 0, payslips: 0 } };
    fetchJson.mockResolvedValue(report);
    const { unmount } = render(wrap(<PayrollStatutoryReportModal onClose={() => undefined} />));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: STATUTORY_REMITTANCE_TEXT.insurance.button })).toBeNull();
    unmount();
    granted.add(STATUTORY_REMITTANCE_PERMISSION);
    render(wrap(<PayrollStatutoryReportModal onClose={() => undefined} />));
    expect(await screen.findByRole('button', { name: STATUTORY_REMITTANCE_TEXT.insurance.button })).toBeTruthy();
    expect(screen.getByRole('button', { name: STATUTORY_REMITTANCE_TEXT.tax.button })).toBeTruthy();
  });
});
