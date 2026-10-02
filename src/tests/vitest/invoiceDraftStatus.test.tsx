import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceDetailsInfoCards } from '../../components/invoices/list/InvoiceDetailsInfoCards';
import {
  computeInvoiceListSummary,
  documentStatusLabelOf,
  type InvoiceListDocument,
} from '../../lib/invoices/invoiceListDocuments';

// v7.0.95 (TD-235 بند ۳): سند پیش‌نویس «نهایی» نامیده و جزو فاکتور فروش/خرید نهایی شمرده نمی‌شد
describe('draft documents in the invoices list', () => {
  it('labels draft, proforma and final statuses', () => {
    expect(documentStatusLabelOf('draft')).toBe('پیش‌نویس');
    expect(documentStatusLabelOf('proforma')).toBe('پیش‌فاکتور');
    expect(documentStatusLabelOf('final')).toBe('نهایی');
    expect(documentStatusLabelOf('final', 'نهایی‌شده')).toBe('نهایی‌شده');
  });

  it('does not count drafts as final sales or purchases', () => {
    const docs: InvoiceListDocument[] = [
      { id: 1, type: 'invoice', status: 'final', currency: 'IRR', totalAmount: 1000 },
      { id: 2, type: 'invoice', status: 'draft', currency: 'IRR', totalAmount: 500 },
      { id: 3, type: 'receipt', status: 'draft', currency: 'IRR', totalAmount: 300 },
    ];
    const summary = computeInvoiceListSummary(docs);
    expect(summary.salesCount).toBe(1);
    expect(summary.salesTotals).toEqual({ IRR: 1000 });
    expect(summary.purchaseCount).toBe(0);
    expect(summary.otherCount).toBe(2);
  });

  it('details card shows پیش‌نویس for a draft', () => {
    render(<InvoiceDetailsInfoCards selectedDocDetails={{ id: 5, type: 'invoice', status: 'draft', currency: 'IRR' }} />);
    expect(screen.getByText('پیش‌نویس')).toBeTruthy();
    expect(screen.queryByText('نهایی‌شده')).toBeNull();
  });
});
