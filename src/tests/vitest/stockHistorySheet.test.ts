import { describe, expect, it } from 'vitest';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount';
import {
  STOCK_OPENING_DAY, detectStockSheet, emptyStockMapping, parseStockSheet, remapItemCode, resolveStockRow, salesInvoiceKey, unissuedSalesInvoices, unmappedStockNames, wholeSalesInvoices,
  type StockImportMapping, type StockImportLookups,
} from '../../lib/historyImport/stockSheet';
import { excelInvoiceNumber, stockImportDocumentKey, stockImportNotes, stockImportOrder, type StockImportRow } from '../../lib/historyImport/stockHistoryImport';

// v11 history import, tool 2: reading the cleaned warehouse sheets and resolving their rows through the mapping
const IN_HEADER = ['تاریخ', 'کد کالا', 'نام محصول', 'نوع ورود', 'تعداد', 'قیمت واحد (ریال)', 'تأمین‌کننده', 'شماره فاکتور مرجع', 'انبار', 'توضیحات'];
const OUT_HEADER = ['تاریخ', 'شماره فاکتور/شماره قبض', 'کد کالا', 'نوع خروج', 'تعداد', 'نام محصول', 'گیرنده', 'توضیحات'];

const ins = parseStockSheet('ورود به انبار', [
  IN_HEADER,
  ['', 'M-B-023', 'سیم', 'موجودی اولیه', '1,500', 1200, '', '', '', ''],
  ['1405/01/10', 'm-b-023', 'سیم', 'خرید جدید', 20, '1,250', 'فروشگاه رنگ', '35', 'مرکزی', 'خ۱'],
  ['1405-01-15', 'P-001', 'دستبند', 'تولید', 2, 60000, '', '', '', ''],
  ['1405-01-20', 'P-001', 'دستبند', 'مرجوعی', 1, '', '', '61', '', ''],
  ['1405-01-21', 'M-X-001', 'سنباده', 'برگشت از کارگاه', 1, '', '', '', '', ''],
  ['1405-01-22', 'P-001', 'دستبند', 'هدیه', 1, '', '', '', '', ''],
  [],
]);
const outs = parseStockSheet('خروج دستی', [
  OUT_HEADER,
  ['1405-01-12', '۱۲', 'M-B-023', 'مصرف داخلی', 5, 'سیم', 'همکار یک', 'کارگاه'],
  ['1405-01-25', '', 'P-001', 'انتقال به نمایش', 1, 'دستبند', '', 'کشو'],
  ['1405-01-26', '', 'P-001', 'تبدیل', 1, 'دستبند', '', 'به گردنبند'],
]);

const lookups: StockImportLookups = {
  warehouseCodeOf: name => (name === 'مرکزی' ? 'MAIN' : name === 'نمایش' ? 'SHOW' : null),
};
const mapping = (extra: Partial<StockImportMapping> = {}): StockImportMapping => ({
  ...emptyStockMapping(), suppliers: { 'فروشگاه رنگ': { kind: 'supplier', partyId: 3 } }, displayWarehouse: 'SHOW', ...extra,
});

describe('stock sheets', () => {
  it('finds the two sheets by their headers and reads their cells', () => {
    expect(detectStockSheet(IN_HEADER)).toBe('in');
    expect(detectStockSheet(OUT_HEADER)).toBe('out');
    expect(detectStockSheet(['تاریخ', 'مبلغ'])).toBeNull();
    expect(ins).toHaveLength(6);
    expect(ins[0]).toMatchObject({ rowNo: 2, quantity: '1500', unitCost: '1200' });
    expect(ins[1]).toMatchObject({ date: '1405/01/10', unitCost: '1250', supplierName: 'فروشگاه رنگ', warehouseName: 'مرکزی' });
    expect(outs[0]).toMatchObject({ slipRef: '12', recipientName: 'همکار یک' });
  });

  it('resolves each kind: opening on 1 Farvardin, purchase with its supplier, transfer to the display warehouse, conversion as consumption', () => {
    const r = [...ins, ...outs].map(p => resolveStockRow(p, mapping(), lookups));
    expect(r[0]).toMatchObject({ status: 'ready', row: { kind: 'opening', date: STOCK_OPENING_DAY, itemCode: 'M-B-023', unitCost: '1200' } });
    expect(r[1]).toMatchObject({ status: 'ready', row: { kind: 'purchase', supplierId: 3, warehouse: 'MAIN', itemCode: 'm-b-023', slipRef: '35' } });
    // tool 6: a purchase with no «هزینه‌ها» row (on credit, by cheque) goes in with no number
    expect(resolveStockRow({ ...ins[1], slipRef: ' ' }, mapping(), lookups)).toMatchObject({ status: 'ready', row: { kind: 'purchase' } });
    expect(r[2]).toMatchObject({ status: 'ready', row: { kind: 'production', warehouse: null } });
    expect(r[3]).toMatchObject({ status: 'ready', row: { kind: 'return', invoiceRef: '61', unitCost: null } }); // back on its invoice
    expect(r[4].status).toBe('unresolved'); // a workshop return is netted against its consumption row
    expect(r[5].status).toBe('unresolved'); // an unknown type
    expect(r[6]).toMatchObject({ status: 'ready', row: { kind: 'consumption', slipRef: '12', description: 'گیرنده: همکار یک — کارگاه' } });
    expect(r[6].status === 'ready' && r[6].row.recipientPersonnelId).toBeFalsy(); // the recipient stays in the notes
    expect(r[7]).toMatchObject({ status: 'ready', row: { kind: 'transfer', toWarehouse: 'SHOW' } });
    expect(r[8]).toMatchObject({ status: 'ready', row: { kind: 'consumption' } });
  });

  it('asks for what is missing: a supplier, the display warehouse, a warehouse name; maps or skips an unknown code', () => {
    expect(resolveStockRow(ins[1], mapping({ suppliers: {} }), lookups).status).toBe('unresolved');
    expect(resolveStockRow(outs[1], mapping({ displayWarehouse: null }), lookups).status).toBe('unresolved');
    expect(unmappedStockNames([...ins, ...outs], mapping({ suppliers: {} }), lookups)).toEqual({ warehouses: [], suppliers: ['فروشگاه رنگ'], customers: [] });
    const mapped = resolveStockRow(ins[2], mapping({ items: { 'P-001': { kind: 'code', code: '888' } } }), lookups);
    expect(mapped).toMatchObject({ status: 'ready', row: { itemCode: '888' } });
    expect(resolveStockRow(ins[2], mapping({ items: { 'P-001': { kind: 'skip' } } }), lookups).status).toBe('skipped');
    expect(resolveStockRow(outs[0], mapping(), lookups, new Set(['خروج دستی#2']))).toMatchObject({ row: { duplicateAccepted: true } });
  });

  it('corrects or leaves out a mistyped fix of a code by the Excel code the row came with', () => {
    const typo = mapping({ items: { 'P-001': { kind: 'code', code: 'P-01X' } } });
    const resolvedRows = [resolveStockRow(ins[2], typo, lookups)];
    expect(resolvedRows[0]).toMatchObject({ row: { itemCode: 'P-01X' } });
    const fixed = remapItemCode(typo, resolvedRows, 'P-01X', 'P-010');
    expect(resolveStockRow(ins[2], fixed, lookups)).toMatchObject({ status: 'ready', row: { itemCode: 'P-010' } });
    expect(resolveStockRow(ins[2], remapItemCode(typo, resolvedRows, 'P-01X', ''), lookups).status).toBe('skipped');
  });
});

const SALES_HEADER = ['شماره فاکتور', 'تاریخ', 'مشتری', 'کد کالا', 'نام کالا', 'تعداد', 'سیاست قیمتی', 'قیمت', 'جمع کل', 'وضعیت', 'دسته‌بندی'];
const sales = parseStockSheet('اقلام فاکتور', [
  SALES_HEADER,
  ['50', '1405-03-21', 'گالری الف', 'P-001', 'دستبند', 11, 'قیمت 4', '2,625,000', '28,875,000', 'ثبت نهایی', ''],
  ['50', '1405-03-21', 'گالری الف', 'P-002', 'گوشواره', '2', 'قیمت 4', 3000000, 6000000, 'ثبت نهایی', ''],
  ['51', '1405-03-10', 'مشتری ب', 'P-001', 'دستبند', 1, '', 3375000, 3375000, '', ''],
  ['52', '', 'مشتری ج', '', '', '', 'قیمت 4'],
  ['54', '1405-04-01', 'گالری الف', 'P-001', 'دستبند', 2, '', 1000, 5000, 'ثبت نهایی', ''],
]);

describe('sales sheet (tool 3)', () => {
  const salesMapping = (extra: Partial<StockImportMapping> = {}) => mapping({ customers: { 'گالری الف': { kind: 'customer', partyId: 9 } }, ...extra });
  it('reads the invoice lines and resolves each as a line of its Excel invoice', () => {
    expect(detectStockSheet(SALES_HEADER)).toBe('sales');
    expect(sales).toHaveLength(4); // invoice 52 has no line
    expect(sales[0]).toMatchObject({ shape: 'sales', invoiceRef: '50', customerName: 'گالری الف', unitPrice: '2625000', lineTotal: '28875000', quantity: '11' });
    expect(resolveStockRow(sales[0], salesMapping(), lookups)).toMatchObject({ status: 'ready', row: { kind: 'sale', invoiceRef: '50', customerId: 9, unitPrice: '2625000', itemCode: 'P-001' } });
  });
  it('leaves out an invoice that is not issued unless the user includes it, and asks for the customer and a matching total', () => {
    expect(resolveStockRow(sales[2], salesMapping(), lookups).status).toBe('skipped');
    expect(unissuedSalesInvoices(sales)).toEqual([{ invoiceRef: '51', customerName: 'مشتری ب', lines: 1 }]);
    expect(resolveStockRow(sales[2], salesMapping(), lookups, new Set([salesInvoiceKey('51')])).status).toBe('unresolved'); // its customer is not mapped
    expect(unmappedStockNames(sales, salesMapping(), lookups).customers).toEqual(['مشتری ب']);
    const wrongTotal = resolveStockRow(sales[3], salesMapping(), lookups);
    expect(wrongTotal.status).toBe('unresolved');
  });
  it('reads an Excel invoice number written in any form', () => {
    expect(excelInvoiceNumber('فاکتور ۶۱ اکسل')).toBe('61');
    expect(excelInvoiceNumber(' 061 ')).toBe('61');
    expect(excelInvoiceNumber('61-62')).toBe('61-62');
    expect(excelInvoiceNumber('')).toBe('');
    expect(excelInvoiceNumber('12345678901234567891')).toBe('12345678901234567891'); // never through a float
  });

  it('imports an Excel invoice whole: a line left out or waiting holds back the other lines, and the sales warehouse is the mapped one', () => {
    const two = [sales[0], sales[1]];
    const ready = wholeSalesInvoices(two.map(p => resolveStockRow(p, salesMapping({ salesWarehouse: 'SHOW' }), lookups)));
    expect(ready.every(r => r.status === 'ready' && r.row.warehouse === 'SHOW')).toBe(true);
    const oneSkipped = wholeSalesInvoices(two.map(p => resolveStockRow(p, salesMapping({ items: { 'P-002': { kind: 'skip' } } }), lookups)));
    expect(oneSkipped.map(r => r.status)).toEqual(['unresolved', 'skipped']);
    const bothSkipped = wholeSalesInvoices(two.map(p => resolveStockRow(p, salesMapping({ customers: { 'گالری الف': { kind: 'skip' } } }), lookups)));
    expect(bothSkipped.map(r => r.status)).toEqual(['skipped', 'skipped']);
  });
  it('holds back an invoice whose lines carry two dates, even when the other line is in another month', () => {
    const split = parseStockSheet('اقلام فاکتور', [
      SALES_HEADER,
      ['60', '1405-03-31', 'گالری الف', 'P-001', 'دستبند', 1, '', 1000, 1000, 'ثبت نهایی', ''],
      ['60', '1405/4/1', 'گالری الف', 'P-002', 'گوشواره', 1, '', 1000, 1000, 'ثبت نهایی', ''],
      ['61', '1405/3/31', 'گالری الف', 'P-001', 'دستبند', 1, '', 1000, 1000, 'ثبت نهایی', ''],
      ['61', '1405-03-31', 'گالری الف', 'P-002', 'گوشواره', 1, '', 1000, 1000, 'ثبت نهایی', ''],
    ]);
    const month3 = split.filter(p => p.date.replace(/\//g, '-').startsWith('1405-03') || p.date.startsWith('1405/3'));
    const out = wholeSalesInvoices(month3.map(p => resolveStockRow(p, salesMapping(), lookups)), split);
    expect(out.map(r => r.status)).toEqual(['unresolved', 'ready', 'ready']);
    // a line with no date, or a date the window cannot place in a month, holds its invoice back too
    for (const second of ['', '1405.03.31']) {
      const lines = parseStockSheet('اقلام فاکتور', [
        SALES_HEADER,
        ['62', '1405-03-31', 'گالری الف', 'P-001', 'دستبند', 1, '', 1000, 1000, 'ثبت نهایی', ''],
        ['62', second, 'گالری الف', 'P-002', 'گوشواره', 1, '', 1000, 1000, 'ثبت نهایی', ''],
      ]);
      expect(wholeSalesInvoices([resolveStockRow(lines[0], salesMapping(), lookups)], lines).map(r => r.status)).toEqual(['unresolved']);
    }
  });
  it('brings a sales return with no warehouse back to the sales warehouse', () => {
    expect(resolveStockRow(ins[3], mapping({ salesWarehouse: 'SHOW' }), lookups)).toMatchObject({ status: 'ready', row: { kind: 'return', warehouse: 'SHOW' } });
    expect(resolveStockRow(ins[3], mapping(), lookups)).toMatchObject({ status: 'ready', row: { kind: 'return', warehouse: null } });
  });
});

describe('stock import order and documents', () => {
  const row = (rowNo: number, kind: StockImportRow['kind'], extra: Partial<StockImportRow> = {}): StockImportRow => ({ rowNo, sheet: 'S', date: '', kind, itemCode: 'A', quantity: '1', ...extra });
  it('posts by day, stock in before stock out, then the Excel order', () => {
    const ordered = stockImportOrder([
      { isoDate: '2026-03-30', row: row(2, 'consumption') },
      { isoDate: '2026-03-30', row: row(5, 'purchase') },
      { isoDate: '2026-03-21', row: row(9, 'opening') },
      { isoDate: '2026-03-30', row: row(3, 'transfer') },
      { isoDate: '2026-03-30', row: row(7, 'return') },
      { isoDate: '2026-03-30', row: row(8, 'sale') },
    ]);
    expect(ordered.map(o => o.row.rowNo)).toEqual([9, 5, 3, 8, 2, 7]);
  });
  it('puts the lines of one purchase slip in one document, and keeps the Excel slip in the notes', () => {
    const a = stockImportDocumentKey('2026-03-30', row(2, 'purchase', { supplierId: 3, slipRef: 'خ۱' }));
    expect(stockImportDocumentKey('2026-03-30', row(3, 'purchase', { supplierId: 3, slipRef: 'خ۱' }))).toBe(a);
    expect(stockImportDocumentKey('2026-03-30', row(4, 'purchase', { supplierId: 4, slipRef: 'خ۱' }))).not.toBe(a);
    expect(stockImportDocumentKey('2026-03-21', row(5, 'opening'))).toBeNull();
    expect(stockImportDocumentKey('2026-03-30', row(6, 'sale', { invoiceRef: '50' }))).toBe(stockImportDocumentKey('2026-04-01', row(7, 'sale', { invoiceRef: '50' })));
    expect(stockImportNotes('خ۱', ['a', 'a', ''])).toBe('ورود سابقه از اکسل (شماره اکسل: خ۱) a');
  });
});

describe('history import amounts', () => {
  it('takes plain decimals above zero and refuses exponents, float noise and zero', () => {
    expect(historyImportAmount('1500')).toBe('1500');
    expect(historyImportAmount('0012.50')).toBe('12.5');
    expect(historyImportAmount('1e3')).toBeNull();
    expect(historyImportAmount('0.30000000000000004')).toBeNull();
    expect(historyImportAmount('0')).toBeNull();
    expect(historyImportAmount('-5')).toBeNull();
    expect(historyImportAmount('')).toBeNull();
  });
});
