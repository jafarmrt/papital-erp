import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvoiceDetailsTotals } from '../../components/invoices/list/InvoiceDetailsTotals';
import InvoicePrintView from '../../components/InvoicePrintView';
import { documentPayableOf, type InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';
import { formatPersianPrice } from '../../utils';

// v7.0.103 (TD-191): هزینه ارسال و کارمزد سفارش ووکامرس جزء مبلغ قابل پرداخت فاکتور است و جدا نمایش داده می‌شود
const wooInvoice: InvoiceListDocument = {
  id: 9,
  type: 'invoice',
  status: 'final',
  currency: 'IRR',
  items: [{ quantity: 2, unit_price: 1000, discount: 0 }],
  totalAmount: 2000,
  vatAmount: 230,
  serviceChargeAmount: 330,
};

afterEach(cleanup);

describe('invoice service charge (TD-191)', () => {
  it('adds the service charge to the payable amount when the server total is missing', () => {
    expect(documentPayableOf(wooInvoice)).toBe(2560);
  });

  it('shows the service charge in the details totals', () => {
    render(<InvoiceDetailsTotals selectedDocDetails={wooInvoice} />);
    expect(screen.getByText('هزینه ارسال و خدمات:')).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(330))).toBeTruthy();
    expect(screen.getByText(new RegExp(formatPersianPrice(2560)))).toBeTruthy();
  });

  it('prints the service charge row and includes it in the payable amount', () => {
    render(<InvoicePrintView printedDoc={{ ...wooInvoice, ref_number: 'INV-9', date: '2026-10-03', items: [{ name: 'گردنبند', quantity: 2, unit_price: 1000, discount: 0 }] }} />);
    expect(screen.getByText(/هزینه ارسال و خدمات/)).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(330))).toBeTruthy();
    expect(screen.getAllByText(new RegExp(formatPersianPrice(2560))).length).toBeGreaterThan(0);
  });
});
