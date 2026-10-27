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

// the row's actions and notes cells read permissions and list state; the amounts are what is checked here
vi.mock('../../components/invoices/list/InvoiceRowActions', () => ({ InvoiceRowActions: () => <td /> }));
vi.mock('../../components/invoices/list/InvoiceRowNotesCell', () => ({ InvoiceRowNotesCell: () => <td /> }));

const { RialDisplayProvider } = await import('../../contexts/RialDisplayContext');
const { docAmountFormatOf } = await import('../../lib/invoices/invoiceListDocuments');
const { rialDisplayOf } = await import('../../lib/rialDisplay');
const { InvoiceRowSettlementCell } = await import('../../components/invoices/list/InvoiceRowSettlementCell');
const { InvoiceDetailsTotals } = await import('../../components/invoices/list/InvoiceDetailsTotals');
const { RialEquivalent } = await import('../../components/common/RialEquivalent');
const { PayrollDeductionsField } = await import('../../components/piecework/PayrollDeductionsField');
const { InvoiceListRow } = await import('../../components/invoices/list/InvoiceListRow');
const { DocumentDetailsPreview } = await import('../../components/approval/DocumentDetailsPreview');
const { Money } = await import('../../components/Money');
const { formatPersianPrice } = await import('../../utils');

afterEach(() => {
  cleanup();
  displayUnit.current = 'TOMAN';
});

const inApp = (node: ReactNode) => render(<RialDisplayProvider>{node}</RialDisplayProvider>);

const TOMAN_REMAINING = 'مانده: ۱۲٬۵۰۰ تومان';
const RIAL_REMAINING = 'مانده: ۱۲۵٬۰۰۰ ریال';
const RIAL_TOTAL = '۱۲۵٬۰۰۰ ریال';
const TOMAN_AMOUNT = '۱۲٬۵۰۰ تومان';
const PAYABLE_LABEL = 'مبلغ قابل پرداخت:';
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
    expect(total).toBe(RIAL_TOTAL);
  });

  const listRow = (currency: string, amount: number) => inApp(
    <table><tbody>
      <InvoiceListRow doc={{ id: 1, type: 'invoice', status: 'final', currency, payableAmount: amount, paidAmount: 0, items: [] }} actions={{} as never} />
    </tbody></table>,
  );

  it('shows an invoice list row of a rial document in toman, amount and remaining alike', () => {
    listRow('IRR', 125_000);
    const cell = document.querySelector('td[data-label="مبلغ سند"]')?.textContent ?? '';
    expect(cell).toBe(TOMAN_AMOUNT.replace(' ', ''));
    expect(screen.getByText(TOMAN_REMAINING)).toBeTruthy();
  });

  it('keeps an invoice list row of a dollar document in dollars with its cents', () => {
    listRow('USD', 200.5);
    const cell = document.querySelector('td[data-label="مبلغ سند"]')?.textContent ?? '';
    expect(cell).toBe(`${formatPersianPrice(200.5, undefined, 2)}${DOLLAR}`);
    expect(document.body.textContent).not.toContain(TOMAN);
  });

  it('shows the approval preview of a rial document in toman and of a dollar document in dollars', () => {
    inApp(<DocumentDetailsPreview isLoadingDoc={false} docDetails={{ id: 1, currency: 'IRR', payableAmount: 125_000, items: [] }} />);
    expect(screen.getByText(PAYABLE_LABEL).nextElementSibling?.textContent).toBe(TOMAN_AMOUNT);
    cleanup();
    inApp(<DocumentDetailsPreview isLoadingDoc={false} docDetails={{ id: 1, currency: 'USD', payableAmount: 200.5, items: [{ quantity: 1, unit_price: 200.5 }] }} />);
    expect(screen.getByText(PAYABLE_LABEL).nextElementSibling?.textContent).toBe(`${formatPersianPrice(200.5, undefined, 2)} ${DOLLAR}`);
    expect(document.body.textContent).not.toContain(TOMAN);
  });

  it('shows the invoice list totals cards (Money) in the display unit, a foreign amount in its currency', () => {
    inApp(<Money amount={125_000} currency="IRR" />);
    expect(document.body.textContent).toBe(TOMAN_AMOUNT);
    cleanup();
    inApp(<Money amount={200.5} currency="USD" />);
    expect(document.body.textContent).not.toContain(TOMAN);
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
