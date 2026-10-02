import { describe, expect, it } from 'vitest';
import {
  addLineDiscount,
  addLineGross,
  addLineNet,
  addLineQuantity,
  computeInvoiceListSummary,
  detailsRemainingOf,
  documentPayableOf,
  resolveInvoiceRowFigures,
  type InvoiceListLine,
} from '../../lib/invoices/invoiceListDocuments';

// TD-235 (بند ۴): جمع مبالغ فهرست فاکتورها دهدهی دقیق است، نه جمع اعشاری جاوااسکریپت.
describe('invoice list money sums are exact decimals (TD-235 part 4)', () => {
  it('sums the KPI card totals per currency without float drift', () => {
    const summary = computeInvoiceListSummary([
      { id: 1, type: 'invoice', status: 'final', currency: 'USD', totalAmount: 0.1 },
      { id: 2, type: 'invoice', status: 'final', currency: 'USD', totalAmount: 0.2 },
      { id: 3, type: 'receipt', status: 'final', currency: 'EUR', totalAmount: 1.1 },
      { id: 4, type: 'receipt', status: 'final', currency: 'EUR', totalAmount: 2.2 },
      { id: 5, type: 'proforma', status: 'proforma', currency: 'AED', totalAmount: 0.7 },
      { id: 6, type: 'proforma', status: 'proforma', currency: 'AED', totalAmount: 0.1 },
    ]);
    expect(summary.salesTotals).toEqual({ USD: 0.3 });
    expect(summary.purchaseTotals).toEqual({ EUR: 3.3 });
    expect(summary.proformaTotals).toEqual({ AED: 0.8 });
  });

  it('sums line amounts and quantities exactly', () => {
    const lines: InvoiceListLine[] = [
      { quantity: 0.1, unit_price: 3, discount: 0.1 },
      { quantity: 0.2, unit_price: 3, discount: 0.2 },
    ];
    expect(lines.reduce(addLineGross, 0)).toBe(0.9);
    expect(lines.reduce(addLineDiscount, 0)).toBe(0.3);
    expect(lines.reduce(addLineNet, 0)).toBe(0.6);
    expect(lines.reduce(addLineQuantity, 0)).toBe(0.3);
  });

  it('computes the payable and remaining amounts exactly', () => {
    expect(documentPayableOf({ id: 1, totalAmount: 0.1, vatAmount: 0.2 })).toBe(0.3);
    expect(detailsRemainingOf({ id: 1, totalAmount: 100.1, paidAmount: 0.2 })).toBe(99.9);
    expect(resolveInvoiceRowFigures({ id: 1, type: 'invoice', totalAmount: 0.3, paidAmount: 0.1 }).remainingAmt).toBe(0.2);
  });
});
