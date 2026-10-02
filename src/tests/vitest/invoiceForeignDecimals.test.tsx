import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceRowSettlementCell } from '../../components/invoices/list/InvoiceRowSettlementCell';
import { InvoiceDetailsTotals } from '../../components/invoices/list/InvoiceDetailsTotals';
import { amountDecimalsOf, type InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';
import { formatPersianPrice } from '../../utils';

// v7.0.96 (TD-235 بند ۲): مبلغ و مانده سند ارزی با اعشار (تا ۲ رقم)؛ پیش‌تر ۲۰۰٫۵ دلار «۲۰۱» نمایش داده می‌شد
describe('foreign-currency amounts in the invoices list', () => {
  it('uses two decimals for foreign currencies and none for IRR', () => {
    expect(amountDecimalsOf('USD')).toBe(2);
    expect(amountDecimalsOf('IRR')).toBe(0);
    expect(amountDecimalsOf(undefined)).toBe(0);
  });

  it('row remaining keeps the cents of a USD invoice', () => {
    render(<InvoiceRowSettlementCell isCommercial settlementStatus="unpaid" remainingAmt={200.5} currency="USD" />);
    const expected = formatPersianPrice(200.5, undefined, 2);
    expect(expected).not.toBe(formatPersianPrice(200.5));
    expect(screen.getByText(`مانده: ${expected}`)).toBeTruthy();
  });

  it('details total keeps the cents of a USD invoice', () => {
    const doc: InvoiceListDocument = { id: 1, type: 'invoice', currency: 'USD', payableAmount: 200.5, items: [] };
    render(<InvoiceDetailsTotals selectedDocDetails={doc} />);
    const total = screen.getByText('جمع کل ارزش نهایی سند:').parentElement?.querySelector('strong')?.textContent ?? '';
    expect(total).toContain(formatPersianPrice(200.5, undefined, 2));
  });
});
