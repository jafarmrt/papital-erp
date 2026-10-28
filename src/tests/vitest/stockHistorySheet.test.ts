import { describe, expect, it } from 'vitest';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount';
import {
  STOCK_OPENING_DAY, detectStockSheet, emptyStockMapping, parseStockSheet, resolveStockRow, salesInvoiceKey, unissuedSalesInvoices, unmappedStockNames,
  type StockImportMapping, type StockImportLookups,
} from '../../lib/historyImport/stockSheet';
import { excelInvoiceNumber, stockImportDocumentKey, stockImportNotes, stockImportOrder, type StockImportRow } from '../../lib/historyImport/stockHistoryImport';

// v11 history import, tool 2: reading the cleaned warehouse sheets and resolving their rows through the mapping
const IN_HEADER = ['تاریخ', 'کد کالا', 'نام محصول', 'نوع ورود', 'تعداد', 'قیمت واحد (ریال)', 'تأمین‌کننده', 'شماره فاکتور مرجع', 'انبار', 'توضیحات'];
const OUT_HEADER = ['تاریخ', 'شماره فاکتور/شماره قبض', 'کد کالا', 'نوع خروج', 'تعداد', 'نام محصول', 'گیرنده', 'توضیحات'];

const ins = parseStockSheet('ورود به انبار', [
  IN_HEADER,
  ['', 'M-B-023', 'سیم', 'موجودی اولیه', '1,500', 1200, '', '', '', ''],
  ['1405/01/10', 'm-b-023', 'سیم', 'خرید جدید', 20, '1,250', 'فروشگاه رنگ', '', 'مرکزی', 'خ۱'],
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
  personnelIdOf: name => (name === 'همکار یک' ? 7 : null),
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
    expect(r[1]).toMatchObject({ status: 'ready', row: { kind: 'purchase', supplierId: 3, warehouse: 'MAIN', itemCode: 'm-b-023' } });
    expect(r[2]).toMatchObject({ status: 'ready', row: { kind: 'production', warehouse: null } });
    expect(r[3]).toMatchObject({ status: 'ready', row: { kind: 'return', invoiceRef: '61', unitCost: null } }); // back on its invoice
    expect(r[4].status).toBe('unresolved'); // a workshop return is netted against its consumption row
    expect(r[5].status).toBe('unresolved'); // an unknown type
    expect(r[6]).toMatchObject({ status: 'ready', row: { kind: 'consumption', recipientPersonnelId: 7, slipRef: '12' } });
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
