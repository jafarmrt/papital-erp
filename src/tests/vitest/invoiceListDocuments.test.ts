import { describe, expect, it } from 'vitest';
import {
  INVOICE_TYPE_BADGES,
  addLineDiscount,
  addLineGross,
  addLineNet,
  addLineQuantity,
  computeInvoiceListSummary,
  detailsRemainingOf,
  detailsSettlementViewOf,
  detailsTitleOf,
  detailsTypeLabelOf,
  documentAmountOf,
  partyLabelOf,
  resolveInvoiceRowFigures,
  workflowTypeLabelOf,
  type InvoiceListDocument,
  type InvoiceListLine,
} from '../../lib/invoices/invoiceListDocuments';

// Characterization (TD-080 part 3): expected values follow the expressions of the original InvoicesListPage.
const lines: InvoiceListLine[] = [
  { quantity: 2, unit_price: 100, discount: 5 },
  { quantity: '3', unit_price: '7', discount: null },
  { quantity: null, unit_price: 50, discount: 1 },
];

describe('invoice list line reducers', () => {
  it('sums net, gross, discount and quantity like the original reduce expressions', () => {
    expect(lines.reduce(addLineNet, 0)).toBe(2 * 100 - 5 + 3 * 7 - 0 + 0 - 1);
    expect(lines.reduce(addLineGross, 0)).toBe(200 + 21 + 0);
    expect(lines.reduce(addLineDiscount, 0)).toBe(6);
    expect(lines.reduce(addLineQuantity, 0)).toBe(5);
  });

  it('yields NaN for non-numeric input (the list then falls back to 0, the details modal does not)', () => {
    const bad: InvoiceListLine[] = [{ quantity: 'abc', unit_price: 1 }];
    expect(bad.reduce(addLineNet, 0)).toBeNaN();
    expect(documentAmountOf({ id: 1, items: bad })).toBe(0);
  });
});

describe('documentAmountOf', () => {
  it('prefers the server totalAmount, even 0', () => {
    expect(documentAmountOf({ id: 1, totalAmount: 1500, items: lines })).toBe(1500);
    expect(documentAmountOf({ id: 1, totalAmount: 0, items: lines })).toBe(0);
  });

  it('falls back to the net of the lines, or 0 without lines', () => {
    expect(documentAmountOf({ id: 1, items: lines })).toBe(215);
    expect(documentAmountOf({ id: 1 })).toBe(0);
    expect(documentAmountOf({ id: 1, items: [] })).toBe(0);
  });
});

describe('computeInvoiceListSummary', () => {
  it('groups totals by currency and counts proforma before invoice/receipt', () => {
    const docs: InvoiceListDocument[] = [
      { id: 1, type: 'invoice', status: 'final', totalAmount: 1000 },
      { id: 2, type: 'invoice', status: 'final', currency: 'IRR', totalAmount: 500 },
      { id: 3, type: 'invoice', status: 'final', currency: 'USD', totalAmount: 20 },
      { id: 4, type: 'invoice', status: 'proforma', totalAmount: 300 },
      { id: 5, type: 'proforma', status: 'final', currency: 'EUR', totalAmount: 7 },
      { id: 6, type: 'receipt', status: 'final', items: lines },
      { id: 7, type: 'remittance', status: 'final', totalAmount: 99 },
      { id: 8, type: 'waste', status: 'draft' },
    ];
    expect(computeInvoiceListSummary(docs)).toEqual({
      salesTotals: { IRR: 1500, USD: 20 },
      salesCount: 3,
      purchaseTotals: { IRR: 215 },
      purchaseCount: 1,
      proformaTotals: { IRR: 300, EUR: 7 },
      proformaCount: 2,
      otherCount: 2,
    });
  });

  it('returns empty buckets for an empty page', () => {
    expect(computeInvoiceListSummary([])).toEqual({
      salesTotals: {}, salesCount: 0, purchaseTotals: {}, purchaseCount: 0, proformaTotals: {}, proformaCount: 0, otherCount: 0,
    });
  });
});

describe('resolveInvoiceRowFigures', () => {
  it('maps the type badge with the original precedence', () => {
    const kind = (doc: Partial<InvoiceListDocument>) => resolveInvoiceRowFigures({ id: 1, ...doc }).badgeKind;
    expect(kind({ type: 'receipt', status: 'proforma' })).toBe('receipt');
    expect(kind({ type: 'invoice', status: 'proforma' })).toBe('invoice');
    expect(kind({ type: 'remittance', status: 'proforma' })).toBe('proforma');
    expect(kind({ type: 'proforma' })).toBe('proforma');
    expect(kind({ type: 'remittance' })).toBe('remittance');
    expect(kind({ type: 'return' })).toBe('return');
    expect(kind({ type: 'waste' })).toBe('waste');
    expect(kind({ type: 'production' })).toBe('stock');
    expect(INVOICE_TYPE_BADGES.stock).toEqual({ label: 'سند انبار', bg: 'bg-slate-100 text-slate-800 border-slate-200' });
    expect(INVOICE_TYPE_BADGES.receipt.label).toBe('رسید ورود (خرید کالا)');
  });

  it('computes counts, quantity and settlement for a commercial document without server figures', () => {
    const f = resolveInvoiceRowFigures({ id: 1, type: 'invoice', status: 'final', items: lines, paidAmount: 15 });
    expect(f.itemsCount).toBe(3);
    expect(f.totalQty).toBe(5);
    expect(f.totalDocAmount).toBe(215);
    expect(f.isCommercial).toBe(true);
    expect(f.settlementStatus).toBe('unpaid');
    expect(f.remainingAmt).toBe(200);
  });

  it('uses the server figures when present and never goes below zero', () => {
    const f = resolveInvoiceRowFigures({ id: 1, type: 'receipt', itemsCount: 0, totalQuantity: '12', totalAmount: 100, paidAmount: 150, settlementStatus: 'fully_paid' });
    expect(f.itemsCount).toBe(0);
    expect(f.totalQty).toBe('12');
    expect(f.settlementStatus).toBe('fully_paid');
    expect(f.remainingAmt).toBe(0);
    expect(resolveInvoiceRowFigures({ id: 1, type: 'invoice', totalAmount: 100, remainingAmount: 40 }).remainingAmt).toBe(40);
  });

  it('marks non-commercial and zero-amount documents as "none"', () => {
    expect(resolveInvoiceRowFigures({ id: 1, type: 'remittance', totalAmount: 100 }).settlementStatus).toBe('none');
    const zero = resolveInvoiceRowFigures({ id: 1, type: 'invoice', totalAmount: 0 });
    expect(zero.isCommercial).toBe(false);
    expect(zero.settlementStatus).toBe('none');
    expect(resolveInvoiceRowFigures({ id: 1 }).totalQty).toBe(0);
  });
});

describe('labels', () => {
  it('labels the party by document type', () => {
    const party = (doc: InvoiceListDocument) => partyLabelOf(doc, resolveInvoiceRowFigures(doc));
    expect(party({ id: 1, type: 'receipt', buyer_name: 'الف' })).toBe('تامین‌کننده: الف');
    expect(party({ id: 1, type: 'invoice', buyer_name: 'ب' })).toBe('مشتری: ب');
    expect(party({ id: 1, type: 'remittance', status: 'proforma', buyer_name: 'ج' })).toBe('مشتری: ج');
    expect(party({ id: 1, type: 'return', buyer_name: 'د' })).toBe('د');
  });

  it('maps the details and workflow type labels', () => {
    expect(detailsTitleOf('receipt')).toBe('رسید ورود و فاکتور خرید');
    expect(detailsTitleOf('invoice')).toBe('صورتحساب فروش کالا');
    expect(detailsTitleOf('waste')).toBe('جزئیات سند انبارداری');
    expect(detailsTypeLabelOf('receipt')).toBe('رسید ورود (خرید کالا)');
    expect(detailsTypeLabelOf('invoice')).toBe('فاکتور فروش');
    expect(detailsTypeLabelOf('waste')).toBe('waste');
    expect(workflowTypeLabelOf('invoice')).toBe('فاکتور فروش');
    expect(workflowTypeLabelOf('receipt')).toBe('رسید ورود');
    expect(workflowTypeLabelOf(undefined)).toBeUndefined();
  });

  it('maps the details settlement status and remaining amount', () => {
    expect(detailsSettlementViewOf('fully_paid')).toEqual({ label: 'تسویه کامل', iconClass: 'bg-emerald-100 text-emerald-700', badgeClass: 'bg-emerald-100 text-emerald-800' });
    expect(detailsSettlementViewOf('partially_paid').label).toBe('تسویه ناقص');
    expect(detailsSettlementViewOf(undefined)).toEqual({ label: 'تسویه نشده', iconClass: 'bg-rose-100 text-rose-700', badgeClass: 'bg-rose-100 text-rose-800' });
    expect(detailsRemainingOf({ id: 1, remainingAmount: 7, totalAmount: 100 })).toBe(7);
    expect(detailsRemainingOf({ id: 1, totalAmount: 100, paidAmount: 30 })).toBe(70);
    expect(detailsRemainingOf({ id: 1, totalAmount: 100, paidAmount: 130 })).toBe(0);
    expect(detailsRemainingOf({ id: 1 })).toBe(0);
  });
});
