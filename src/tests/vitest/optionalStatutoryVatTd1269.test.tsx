import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithQuery } from './helpers/queryWrapper';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { VAT_WARNINGS, vatDocumentRateLabel, vatRateLabel, vatReportMeta } from '../../lib/reports/vatReport';
import { statutoryReportSheetRows, statutoryReportWithoutNote, type StatutoryReport } from '../../lib/payroll/statutoryReport';
import { PayrollStatutoryReportModal } from '../../components/piecework/PayrollStatutoryReportModal';

/**
 * v10.1.19 (TD-1269, owner rule of 15 Oct 2026: insurance, payroll tax and VAT are supported but never required, per
 * person and per document): the VAT report does not warn about an invoice without VAT, and the monthly insurance and tax
 * list leaves out personnel without insurance or payroll tax and only counts them.
 */

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const NO_VAT_LABEL = 'بی مالیات';
const UNKNOWN_LABEL = 'نامشخص';

describe('VAT report: an invoice without VAT is normal (TD-1269)', () => {
  it('has no «invoice without VAT» warning', () => {
    expect((VAT_WARNINGS as readonly string[]).includes('no_vat')).toBe(false);
  });

  it('labels the zero percent row and a document without VAT as no VAT, and a VAT without a percent as unknown', () => {
    expect(vatRateLabel(0)).toBe(NO_VAT_LABEL);
    expect(vatRateLabel(10)).toBe('۱۰٪');
    expect(vatDocumentRateLabel({ percent: 0, vatOwn: '0' })).toBe(NO_VAT_LABEL);
    expect(vatDocumentRateLabel({ percent: 0, vatOwn: '20000' })).toBe(UNKNOWN_LABEL);
    expect(vatDocumentRateLabel({ percent: 9, vatOwn: '0.9' })).toBe('۹٪');
  });

  it('says in the report header that VAT is optional per invoice', () => {
    const meta = vatReportMeta({ range: { from: '2026-06-22', to: '2026-09-22' }, ledger: null });
    expect(meta.some(([label, text]) => label === 'فاکتور بی مالیات' && text.includes('اختیاری'))).toBe(true);
  });
});

function report(over: Partial<StatutoryReport> = {}): StatutoryReport {
  return {
    jalaliYear: 1405,
    jalaliMonth: 8,
    from: '2026-10-23',
    to: '2026-11-21',
    rows: [{ personnelId: 1, fullName: 'کارگر بیمه‌شده', personnelCode: 'P1', nationalId: '0012345678', payslips: 1, gross: '20000000', employeeInsurance: '1400000', employerInsurance: '4600000', incomeTax: '0' }],
    totals: { gross: '20000000', employeeInsurance: '1400000', employerInsurance: '4600000', incomeTax: '0' },
    draftPayslips: 0,
    withoutStatutory: { personnel: 2, payslips: 3 },
    ...over,
  };
}

describe('monthly insurance and tax list: only personnel with insurance or tax (TD-1269)', () => {
  it('counts the personnel without insurance and tax in a Persian note, and none when there are none', () => {
    expect(statutoryReportWithoutNote(report())).toBe('۲ نفر با ۳ فیش تأییدشده در این ماه بیمه و مالیات حقوق ندارند و در این فهرست و خروجی اکسل نیامده‌اند.');
    expect(statutoryReportWithoutNote(report({ withoutStatutory: { personnel: 0, payslips: 0 } }))).toBeNull();
  });

  it('exports only the listed personnel and the total row', () => {
    const rows = statutoryReportSheetRows(report());
    expect(rows).toHaveLength(2);
    expect(rows[0]['نام پرسنل']).toBe('کارگر بیمه‌شده');
    expect(rows[1]['حقوق و مزایا (ریال)']).toBe(20_000_000);
  });

  it('shows the note in the report window', async () => {
    fetchJson.mockResolvedValue(report());
    renderWithQuery(<PayrollStatutoryReportModal onClose={() => undefined} />);
    expect((await screen.findByTestId('statutory-report-without')).textContent).toContain('۲ نفر با ۳ فیش');
    expect(screen.getByText('کارگر بیمه‌شده')).toBeTruthy();
  });

  it('says so when nobody has insurance or tax in the month', async () => {
    fetchJson.mockResolvedValue(report({ rows: [], totals: { gross: '0', employeeInsurance: '0', employerInsurance: '0', incomeTax: '0' }, withoutStatutory: { personnel: 4, payslips: 4 } }));
    renderWithQuery(<PayrollStatutoryReportModal onClose={() => undefined} />);
    expect(await screen.findByText('در این ماه فیش تأییدشده‌ای با بیمه یا مالیات حقوق نیست.')).toBeTruthy();
    expect(screen.getByTestId('statutory-report-without').textContent).toContain('۴ نفر');
  });
});
