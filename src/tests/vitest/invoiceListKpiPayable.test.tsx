import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvoiceListKpiCards } from '../../components/invoices/list/InvoiceListKpiCards';
import { computeInvoiceListSummary, documentPayableOf, type InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';
import { formatPersianNumber } from '../../utils';

// v9.0.343 (TD-798, finding B08-29): the KPI cards sum the payable amount (net + VAT + service charge), the same figure each row shows
const invoiceWithVat: InvoiceListDocument = {
  id: 1, type: 'invoice', status: 'final', currency: 'IRR', totalAmount: 1_000_000, vatAmount: 100_000, serviceChargeAmount: 0, payableAmount: 1_100_000,
};
const shopOrder: InvoiceListDocument = {
  id: 2, type: 'invoice', status: 'final', currency: 'IRR', totalAmount: 400_000, vatAmount: 36_000, serviceChargeAmount: 50_000,
};
const usdProforma: InvoiceListDocument = { id: 3, type: 'invoice', status: 'proforma', currency: 'USD', totalAmount: 200, vatAmount: 18.5 };
const receiptWithVat: InvoiceListDocument = { id: 4, type: 'receipt', status: 'final', currency: 'IRR', totalAmount: 300_000, vatAmount: 27_000, payableAmount: 327_000 };

afterEach(cleanup);

describe('invoice list KPI cards sum the payable amount (TD-798)', () => {
  it('sales, purchase and proforma totals include VAT and the service charge per currency', () => {
    const summary = computeInvoiceListSummary([invoiceWithVat, shopOrder, usdProforma, receiptWithVat]);
    expect(summary.salesTotals).toEqual({ IRR: 1_586_000 });
    expect(summary.purchaseTotals).toEqual({ IRR: 327_000 });
    expect(summary.proformaTotals).toEqual({ USD: 218.5 });
    expect(summary.salesTotals.IRR).toBe(documentPayableOf(invoiceWithVat) + documentPayableOf(shopOrder));
  });

  it('the sales card shows the same amount as the row of a single invoice with VAT', () => {
    render(<InvoiceListKpiCards summaryMetrics={computeInvoiceListSummary([invoiceWithVat])} />);
    expect(screen.getByText(new RegExp(formatPersianNumber(1_100_000)))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`^${formatPersianNumber(1_000_000)}`))).toBeNull();
  });
});
