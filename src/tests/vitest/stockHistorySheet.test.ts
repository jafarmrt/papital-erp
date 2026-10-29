import { describe, expect, it } from 'vitest';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount';
import {
  STOCK_OPENING_DAY, detectStockSheet, emptyStockMapping, parseStockSheet, remapItemCode, resolveStockRow, unmappedStockNames,
  type StockImportMapping, type StockImportLookups,
} from '../../lib/historyImport/stockSheet';
import { stockImportDocumentKey, stockImportNotes, stockImportOrder, type StockImportRow } from '../../lib/historyImport/stockHistoryImport';

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
    expect(r[3].status).toBe('skipped'); // a sales return comes with the sales invoices
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
    expect(unmappedStockNames([...ins, ...outs], mapping({ suppliers: {} }), lookups)).toEqual({ warehouses: [], suppliers: ['فروشگاه رنگ'] });
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

describe('stock import order and documents', () => {
  const row = (rowNo: number, kind: StockImportRow['kind'], extra: Partial<StockImportRow> = {}): StockImportRow => ({ rowNo, sheet: 'S', date: '', kind, itemCode: 'A', quantity: '1', ...extra });
  it('posts by day, stock in before stock out, then the Excel order', () => {
    const ordered = stockImportOrder([
      { isoDate: '2026-03-30', row: row(2, 'consumption') },
      { isoDate: '2026-03-30', row: row(5, 'purchase') },
      { isoDate: '2026-03-21', row: row(9, 'opening') },
      { isoDate: '2026-03-30', row: row(3, 'transfer') },
    ]);
    expect(ordered.map(o => o.row.rowNo)).toEqual([9, 5, 3, 2]);
  });
  it('puts the lines of one purchase slip in one document, and keeps the Excel slip in the notes', () => {
    const a = stockImportDocumentKey('2026-03-30', row(2, 'purchase', { supplierId: 3, slipRef: 'خ۱' }));
    expect(stockImportDocumentKey('2026-03-30', row(3, 'purchase', { supplierId: 3, slipRef: 'خ۱' }))).toBe(a);
    expect(stockImportDocumentKey('2026-03-30', row(4, 'purchase', { supplierId: 4, slipRef: 'خ۱' }))).not.toBe(a);
    expect(stockImportDocumentKey('2026-03-21', row(5, 'opening'))).toBeNull();
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
