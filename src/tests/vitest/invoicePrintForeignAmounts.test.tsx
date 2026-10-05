import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import InvoicePrintView from '../../components/InvoicePrintView';
import { printLineAmounts, printTotalsOf } from '../../lib/invoices/invoicePrintTotals';
import { formatPersianPrice } from '../../utils';

// v8.0.84 (TD-383): فاکتور چاپی ارزی مبالغ را با دو رقم اعشار و مبلغ قابل پرداخت سرور نشان می‌دهد
const usdInvoice = {
  id: 31,
  type: 'invoice',
  status: 'final',
  currency: 'USD',
  ref_number: 'INV-31',
  date: '2026-10-03',
  items: [{ name: 'گردنبند', quantity: 1, unit_price: 200.5, discount: 0 }],
  totalAmount: 200.5,
  vatAmount: 18.05,
  payableAmount: 218.55,
};

afterEach(cleanup);

describe('printed foreign-currency invoice (TD-383)', () => {
  it('keeps cents in line amounts and totals', () => {
    expect(printLineAmounts({ quantity: 3, unit_price: 0.1, discount: 0 }).total).toBe(0.3);
    expect(printLineAmounts({ quantity: 0.7, unit_price: 15, discount: 0.5 }).net).toBe(10);
    const t = printTotalsOf(usdInvoice);
    expect(t.decimals).toBe(2);
    expect(t.payable).toBe(218.55);
  });

  it('uses the server payable amount', () => {
    expect(printTotalsOf({ ...usdInvoice, payableAmount: 999 }).payable).toBe(999);
    expect(printTotalsOf({ ...usdInvoice, payableAmount: undefined, payable_amount: '218.55' }).payable).toBe(218.55);
  });

  it('prints 200.5 USD, not 201', () => {
    render(<InvoicePrintView printedDoc={usdInvoice} />);
    const unit = formatPersianPrice(200.5, undefined, 2);
    expect(unit).not.toBe(formatPersianPrice(201));
    expect(screen.getAllByText(unit).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatPersianPrice(201))).toBeNull();
    expect(screen.getAllByText(new RegExp(formatPersianPrice(218.55, undefined, 2))).length).toBeGreaterThan(0);
  });
});
