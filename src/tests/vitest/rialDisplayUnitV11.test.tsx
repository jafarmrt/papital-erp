import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// v11 phase 6.3 (U3, decision ت۵۷): screens that only show amounts follow the display unit, a field that takes a rial
// amount says «ریال» with its toman equivalent, and a printed invoice or proforma stays in rial.

const displayUnit = vi.hoisted(() => ({ current: 'TOMAN' }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => displayUnit.current, useRialDisplay: () => rialDisplayOf(displayUnit.current) };
});

const { RialDisplayProvider } = await import('../../contexts/RialDisplayContext');
const { docAmountFormatOf } = await import('../../lib/invoices/invoiceListDocuments');
const { rialDisplayOf } = await import('../../lib/rialDisplay');
const { InvoiceRowSettlementCell } = await import('../../components/invoices/list/InvoiceRowSettlementCell');
const { InvoiceDetailsTotals } = await import('../../components/invoices/list/InvoiceDetailsTotals');
const { RialEquivalent } = await import('../../components/common/RialEquivalent');
const { PayrollDeductionsField } = await import('../../components/piecework/PayrollDeductionsField');

afterEach(() => {
  cleanup();
  displayUnit.current = 'TOMAN';
});

const inApp = (node: ReactNode) => render(<RialDisplayProvider>{node}</RialDisplayProvider>);

const TOMAN_REMAINING = 'مانده: ۱۲٬۵۰۰';
const RIAL_REMAINING = 'مانده: ۱۲۵٬۰۰۰';
const TOMAN_TOTAL = '۲٬۵۰۰٬۰۰۰ تومان';
const TOMAN_EQUIVALENT = 'معادل: ۲٬۵۰۰٬۰۰۰ تومان';
const DEDUCTIONS_LABEL = 'سایر کسورات (ریال)';
const TOMAN = 'تومان';
const TOTALS_LABEL = 'جمع کل ارزش نهایی سند:';
const DOLLAR = 'دلار';

describe('display unit on screens that only show amounts', () => {
  it('reads a rial document in the display unit and a foreign one in its own currency', () => {
    const toman = rialDisplayOf('TOMAN');
    expect(docAmountFormatOf('IRR', toman).number(125)).toBe('۱۲٫۵');
    expect(docAmountFormatOf(undefined, toman).label).toBe(TOMAN);
    expect(docAmountFormatOf('USD', toman).number(200.5)).toBe(docAmountFormatOf('USD', rialDisplayOf('IRR')).number(200.5));
    expect(docAmountFormatOf('USD', toman).label).toBe(DOLLAR);
  });

  it('shows the remaining of a rial invoice row in toman under the toman setting and in rial under rial', () => {
    render(<InvoiceRowSettlementCell isCommercial settlementStatus="unpaid" remainingAmt={125_000} amounts={docAmountFormatOf('IRR', rialDisplayOf('TOMAN'))} />);
    expect(screen.getByText(TOMAN_REMAINING)).toBeTruthy();
    cleanup();
    render(<InvoiceRowSettlementCell isCommercial settlementStatus="unpaid" remainingAmt={125_000} amounts={docAmountFormatOf('IRR', rialDisplayOf('IRR'))} />);
    expect(screen.getByText(RIAL_REMAINING)).toBeTruthy();
  });

  it('shows the detail window total of a rial invoice in the display unit of the app frame', () => {
    inApp(<InvoiceDetailsTotals selectedDocDetails={{ id: 1, type: 'invoice', currency: 'IRR', payableAmount: 25_000_000, items: [] }} />);
    const total = screen.getByText(TOTALS_LABEL).parentElement?.querySelector('strong')?.textContent ?? '';
    expect(total).toBe(TOMAN_TOTAL);
  });

  it('keeps rial outside the app frame (a test, the sign-in page)', () => {
    render(<InvoiceDetailsTotals selectedDocDetails={{ id: 1, type: 'invoice', currency: 'IRR', payableAmount: 125_000, items: [] }} />);
    const total = screen.getByText(TOTALS_LABEL).parentElement?.querySelector('strong')?.textContent ?? '';
    expect(total).not.toContain(TOMAN);
  });
});

describe('fields that take a rial amount', () => {
  it('shows the toman equivalent under the toman setting only, and nothing for an empty field', () => {
    inApp(<RialEquivalent value={25_000_000} />);
    expect(screen.getByTestId('rial-equivalent').textContent).toBe(TOMAN_EQUIVALENT);
    cleanup();
    inApp(<RialEquivalent value="" />);
    expect(screen.queryByTestId('rial-equivalent')).toBeNull();
    cleanup();
    displayUnit.current = 'IRR';
    inApp(<RialEquivalent value={25_000_000} />);
    expect(screen.queryByTestId('rial-equivalent')).toBeNull();
  });

  it('labels the payslip deductions in rial, the unit the form sends, with the toman equivalent', () => {
    inApp(<PayrollDeductionsField amount={25_000_000} onAmountChange={() => undefined} description="x" onDescriptionChange={() => undefined} />);
    expect(screen.getByLabelText(DEDUCTIONS_LABEL)).toBeTruthy();
    expect(screen.getByTestId('rial-equivalent').textContent).toBe(TOMAN_EQUIVALENT);
  });
});

describe('a printed invoice or proforma stays in rial', () => {
  it('the print views never read the display unit', () => {
    for (const file of ['src/components/InvoicePrintView.tsx', 'src/components/invoices/list/InvoicePrintScreen.tsx', 'src/components/approval/PrintDocModal.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/useShownRial|useRialDisplay|RialDisplayContext|components\/Money|['"]\.\/Money['"]/);
    }
  });
});
