// @vitest-environment node
/**
 * v10.0.119 (TD-1184): text the app writes for the user prints its numbers in Persian digits: the note of an invoice
 * finalized from a proforma and the default description of a quick settlement held Latin digits («شماره 1 به تاریخ
 * 1405/07/18», «شماره 1000»), found by the user guide test.
 */
import { describe, expect, it } from 'vitest';
import { proformaInvoiceNote } from '../../lib/documents/proformaInvoiceNote';
import { settlementDefaultDescription } from '../../lib/invoices/settlementDescription';

const LATIN_DIGIT = /[0-9]/;

describe('generated_text_persian_digits_td_1184', () => {
  it('the invoice note made from a proforma has Persian digits', () => {
    const note = proformaInvoiceNote('1', '1405/07/18');
    expect(note).toBe('صادرشده از پیش‌فاکتور شماره ۱ به تاریخ ۱۴۰۵/۰۷/۱۸');
    expect(proformaInvoiceNote('', '')).toBe('صادرشده از پیش‌فاکتور');
  });

  it('the default quick settlement description has Persian digits', () => {
    const sale = settlementDefaultDescription({ refNumber: '1000', buyerName: 'مینو', isPurchase: false });
    expect(sale).toBe('تسویه فاکتور فروش شماره ۱۰۰۰ - مینو');
    const purchase = settlementDefaultDescription({ refNumber: 'P-12', buyerName: 'تأمین', isPurchase: true });
    expect(LATIN_DIGIT.test(purchase)).toBe(false);
    expect(purchase).toContain('P-۱۲');
  });
});
