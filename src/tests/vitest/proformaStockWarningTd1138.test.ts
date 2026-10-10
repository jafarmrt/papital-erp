import { describe, expect, it } from 'vitest';
import { proformaStockWarningText } from '../../lib/invoices/invoiceForm';

// v10.0.84 (TD-1138, decision 14): the invoice form warns about a saved proforma above the sellable stock
const ITEM_WARNING = 'کالای «مهره» (R-1) در انبار «main»: این پیش‌فاکتور ۵ عدد می‌خواهد و قابل فروش ۲ عدد است.';

describe('proformaStockWarningText (TD-1138)', () => {
  it('is null without warnings', () => {
    expect(proformaStockWarningText({ docId: 1 })).toBeNull();
    expect(proformaStockWarningText({ docId: 1, stockWarnings: [] })).toBeNull();
    expect(proformaStockWarningText(null)).toBeNull();
  });

  it('says the proforma was saved and names each short item', () => {
    const text = proformaStockWarningText({ docId: 1, stockWarnings: [ITEM_WARNING] });
    expect(text).toContain('پیش‌فاکتور ذخیره شد');
    expect(text).toContain(ITEM_WARNING);
  });
});
