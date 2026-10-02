import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceDetailsTotals } from '../../components/invoices/list/InvoiceDetailsTotals';
import {
  detailsRemainingOf,
  documentPayableOf,
  resolveInvoiceRowFigures,
  type InvoiceListDocument,
} from '../../lib/invoices/invoiceListDocuments';
import { formatPersianPrice } from '../../utils';

// v7.0.94 (TD-235 بند ۱): مبلغ سند در جدول و جمع کل پنجره جزئیات = خالص اقلام + مالیات (AGENTS §۶)
const vatInvoice: InvoiceListDocument = {
  id: 7,
  type: 'invoice',
  status: 'final',
  currency: 'IRR',
  items: [{ quantity: 2, unit_price: 1000, discount: 100 }],
  totalAmount: 1900,
  vatAmount: 190,
  payableAmount: 2090,
  paidAmount: 0,
};

describe('invoice payable amount (net + VAT)', () => {
  it('uses the server payableAmount, else net + vatAmount', () => {
    expect(documentPayableOf(vatInvoice)).toBe(2090);
    expect(documentPayableOf({ id: 1, totalAmount: 1900, vatAmount: 190 })).toBe(2090);
    expect(documentPayableOf({ id: 1, items: [{ quantity: 1, unit_price: 500, discount: 0 }], vatAmount: 50 })).toBe(550);
    expect(documentPayableOf({ id: 1, totalAmount: 1900 })).toBe(1900);
  });

  it('shows the payable amount in the list row and in the remaining fallback', () => {
    expect(resolveInvoiceRowFigures(vatInvoice).totalDocAmount).toBe(2090);
    const noRemaining = { ...vatInvoice, remainingAmount: undefined, paidAmount: 90 };
    expect(resolveInvoiceRowFigures(noRemaining).remainingAmt).toBe(2000);
    expect(detailsRemainingOf(noRemaining)).toBe(2000);
  });

  it('details total includes VAT and shows the VAT figure', () => {
    render(<InvoiceDetailsTotals selectedDocDetails={vatInvoice} />);
    expect(screen.getByText(new RegExp(formatPersianPrice(2090)))).toBeTruthy();
    expect(screen.getByText('مالیات بر ارزش افزوده:')).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(190))).toBeTruthy();
  });

  it('details total of a row summary without lines is its payable amount, not zero', () => {
    const summaryOnly: InvoiceListDocument = { id: 8, type: 'invoice', currency: 'IRR', totalAmount: 1000, payableAmount: 1090, vatAmount: 90 };
    render(<InvoiceDetailsTotals selectedDocDetails={summaryOnly} />);
    expect(screen.getByText(new RegExp(formatPersianPrice(1090)))).toBeTruthy();
  });
});
