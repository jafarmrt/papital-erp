import { toEnglishDigits } from '../../utils/persianNumber.js';
import { excelInvoiceNumber, type StockImportKind, type StockImportRow } from './stockHistoryImport.js';
import { amountText, headerKey } from './treasurySheet.js';

/**
 * v11 history import, tool 2: reading the two cleaned warehouse sheets and turning each row, through the codes and names
 * the user mapped once, into a row the server takes. Pure functions shared by the import window and its tests.
 *
 * Sheet «ورود به انبار»: تاریخ · کد کالا · نوع ورود · تعداد · قیمت واحد · تأمین‌کننده · شماره فاکتور مرجع · انبار ·
 * توضیحات. Sheet «خروج دستی»: تاریخ · شماره · کد کالا · نوع خروج · تعداد · گیرنده · انبار · توضیحات. Sheet «اقلام
 * فاکتور» (tool 3, one row per invoice line): شماره فاکتور · تاریخ · مشتری · کد کالا · تعداد · سیاست قیمتی · قیمت · جمع
 * کل · وضعیت. Columns are found by their header, so their order and extra columns (نام محصول، واحد شمارش، دسته‌بندی) do
 * not matter.
 */

/** Opening stock is dated on the first day of 1405, whatever the Excel cell says (owner's decision, 6 Aban 1405). */
export const STOCK_OPENING_DAY = '1405-01-01';

export type StockSheetShape = 'in' | 'out' | 'sales';

/** The «وضعیت» of an invoice the sales sheet marks as issued; another status is left out unless the user includes it. */
export const SALES_FINAL_STATUS = 'ثبت نهایی';

export interface ParsedStockRow {
  sheet: string;
  rowNo: number;
  shape: StockSheetShape;
  date: string;
  code: string;
  typeText: string;
  quantity: string;
  unitCost: string;
  supplierName: string;
  slipRef: string;
  warehouseName: string;
  recipientName: string;
  description: string;
  /** sales sheet: the Excel invoice number (a return's «شماره فاکتور مرجع» is in `slipRef`) */
  invoiceRef: string;
  customerName: string;
  unitPrice: string;
  lineTotal: string;
  statusText: string;
  pricePolicy: string;
}

const HEADERS = {
  date: ['تاریخ'],
  code: ['کد کالا'],
  inType: ['نوع ورود'],
  outType: ['نوع خروج'],
  quantity: ['تعداد'],
  unitCost: ['قیمت واحد (ریال)', 'قیمت واحد'],
  supplier: ['تأمین‌کننده', 'تامین کننده'],
  invoiceRef: ['شماره فاکتور مرجع'],
  slip: ['شماره', 'شماره فاکتور/شماره قبض'],
  warehouse: ['انبار'],
  recipient: ['گیرنده'],
  description: ['توضیحات'],
  invoiceNo: ['شماره فاکتور'],
  customer: ['مشتری'],
  unitPrice: ['قیمت'],
  lineTotal: ['جمع کل'],
  status: ['وضعیت'],
  pricePolicy: ['سیاست قیمتی'],
} as const;

export function detectStockSheet(header: readonly unknown[]): StockSheetShape | null {
  const keys = header.map(headerKey);
  const has = (names: readonly string[]) => names.some(h => keys.includes(headerKey(h)));
  if (!has(HEADERS.date) || !has(HEADERS.code) || !has(HEADERS.quantity)) return null;
  if (has(HEADERS.invoiceNo) && has(HEADERS.customer)) return 'sales';
  if (has(HEADERS.inType)) return 'in';
  if (has(HEADERS.outType)) return 'out';
  return null;
}

const cellText = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

/** The rows of one sheet (the first row is the header); a row with no date, code and quantity is left out. */
export function parseStockSheet(sheet: string, rows: readonly (readonly unknown[])[]): ParsedStockRow[] {
  const header = rows[0] ?? [];
  const shape = detectStockSheet(header);
  if (!shape) return [];
  const keys = header.map(headerKey);
  const col = (names: readonly string[]) => {
    for (const h of names) {
      const i = keys.indexOf(headerKey(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const at = (row: readonly unknown[], names: readonly string[]) => {
    const i = col(names);
    return i < 0 ? '' : row[i];
  };
  const parsed: ParsedStockRow[] = [];
  rows.slice(1).forEach((row, i) => {
    const out: ParsedStockRow = {
      sheet,
      rowNo: i + 2,
      shape,
      date: toEnglishDigits(cellText(at(row, HEADERS.date))),
      code: toEnglishDigits(cellText(at(row, HEADERS.code))),
      typeText: shape === 'sales' ? 'فروش' : cellText(at(row, shape === 'in' ? HEADERS.inType : HEADERS.outType)),
      quantity: amountText(at(row, HEADERS.quantity)),
      unitCost: amountText(at(row, HEADERS.unitCost)),
      supplierName: cellText(at(row, HEADERS.supplier)),
      slipRef: toEnglishDigits(cellText(at(row, shape === 'in' ? HEADERS.invoiceRef : HEADERS.slip))),
      warehouseName: cellText(at(row, HEADERS.warehouse)),
      recipientName: cellText(at(row, HEADERS.recipient)),
      description: cellText(at(row, HEADERS.description)),
      invoiceRef: shape === 'sales' ? excelInvoiceNumber(cellText(at(row, HEADERS.invoiceNo))) : '',
      customerName: shape === 'sales' ? cellText(at(row, HEADERS.customer)) : '',
      unitPrice: shape === 'sales' ? amountText(at(row, HEADERS.unitPrice)) : '',
      lineTotal: shape === 'sales' ? amountText(at(row, HEADERS.lineTotal)) : '',
      statusText: shape === 'sales' ? cellText(at(row, HEADERS.status)) : '',
      pricePolicy: shape === 'sales' ? cellText(at(row, HEADERS.pricePolicy)) : '',
    };
    if (out.date || out.code || out.quantity) parsed.push(out);
  });
  return parsed;
}

/** The key an item code is compared and mapped by: letter case and outer spaces ignored, as the database's unique code is. */
export const codeKey = (code: string) => code.trim().toUpperCase();

export type ItemTarget = { kind: 'code'; code: string } | { kind: 'skip' };
export type WarehouseTarget = { kind: 'warehouse'; code: string } | { kind: 'skip' };
export type SupplierTarget = { kind: 'supplier'; partyId: number } | { kind: 'skip' };
export type CustomerTarget = { kind: 'customer'; partyId: number } | { kind: 'skip' };

export interface StockImportMapping {
  /** by `codeKey`: an Excel code the app does not have, mapped to the app's code (the server finds the item by code) */
  items: Record<string, ItemTarget>;
  /** by the «انبار» text; an empty cell is the default warehouse */
  warehouses: Record<string, WarehouseTarget>;
  suppliers: Record<string, SupplierTarget>;
  /** tool 3: the customer of each name of the sales sheet (one customer is often typed several ways) */
  customers?: Record<string, CustomerTarget>;
  /** tool 3: the warehouse past sales leave (empty = the default warehouse) */
  salesWarehouse?: string | null;
  /** the warehouse «انتقال به نمایش» moves to */
  displayWarehouse?: string | null;
}

export const emptyStockMapping = (): StockImportMapping => ({ items: {}, warehouses: {}, suppliers: {}, customers: {}, displayWarehouse: null });

/** The key an invoice the user included although its Excel status is not «ثبت نهایی» is kept by in the accepted set. */
export const salesInvoiceKey = (invoiceRef: string) => `invoice#${invoiceRef}`;

/** The lists of the app the rows are matched with: warehouses by name or code. */
export interface StockImportLookups {
  warehouseCodeOf: (name: string) => string | null;
}

export type ResolvedStockRow =
  | { status: 'ready'; parsed: ParsedStockRow; row: StockImportRow }
  | { status: 'skipped'; parsed: ParsedStockRow; reason: string }
  | { status: 'unresolved'; parsed: ParsedStockRow; reason: string };

const IN_KINDS: Record<string, StockImportKind> = { 'موجودی اولیه': 'opening', 'خرید جدید': 'purchase', 'خرید': 'purchase', 'تولید': 'production' };
const OUT_KINDS: Record<string, StockImportKind> = { 'مصرف داخلی': 'consumption', 'تبدیل': 'consumption', 'ضایعات': 'waste', 'انتقال به نمایش': 'transfer' };

const typeKey = (text: string) => text.replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();

/**
 * The names of the file the user still has to map: warehouses and suppliers. Item codes are checked by the server's
 * preview, which names each code it does not know (`unknownCode`).
 */
export function unmappedStockNames(rows: ParsedStockRow[], mapping: StockImportMapping, lookups: Pick<StockImportLookups, 'warehouseCodeOf'>) {
  const warehouses = new Set<string>();
  const suppliers = new Set<string>();
  const customers = new Set<string>();
  for (const r of rows) {
    if (r.shape === 'sales') {
      if (r.customerName && !mapping.customers?.[r.customerName]) customers.add(r.customerName);
      continue;
    }
    if (r.warehouseName && !mapping.warehouses[r.warehouseName] && lookups.warehouseCodeOf(r.warehouseName) === null) warehouses.add(r.warehouseName);
    if (r.shape === 'in' && IN_KINDS[typeKey(r.typeText)] === 'purchase' && r.supplierName && !mapping.suppliers[r.supplierName]) suppliers.add(r.supplierName);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'fa'));
  return { warehouses: sorted(warehouses), suppliers: sorted(suppliers), customers: sorted(customers) };
}

/** One parsed row through the mapping: ready for the server, left out on purpose, or waiting for a mapping or a fix. */
export function resolveStockRow(parsed: ParsedStockRow, mapping: StockImportMapping, lookups: StockImportLookups, accepted?: ReadonlySet<string>): ResolvedStockRow {
  const unresolved = (reason: string): ResolvedStockRow => ({ status: 'unresolved', parsed, reason });
  const skipped = (reason: string): ResolvedStockRow => ({ status: 'skipped', parsed, reason });
  if (parsed.shape === 'sales') return resolveSalesRow(parsed, mapping, accepted);
  const type = typeKey(parsed.typeText);
  if (parsed.shape === 'in' && type === 'برگشت از کارگاه') return unresolved('برگشت از کارگاه را از تعداد همان ردیف «خروج دستی» کم کنید و این ردیف را بردارید؛ سندی برای آن نیست.');
  const kind = parsed.shape === 'in' && type === 'مرجوعی' ? 'return' : (parsed.shape === 'in' ? IN_KINDS : OUT_KINDS)[type];
  if (!kind) return unresolved(`نوع «${parsed.typeText || 'خالی'}» شناخته نیست؛ یکی از ${Object.keys(parsed.shape === 'in' ? IN_KINDS : OUT_KINDS).map(k => `«${k}»`).join('، ')} بنویسید.`);

  if (!parsed.code) return unresolved('کد کالا خالی است.');
  const itemTarget = mapping.items[codeKey(parsed.code)];
  if (itemTarget?.kind === 'skip') return skipped(`کد «${parsed.code}» کنار گذاشته شد.`);
  const itemCode = itemTarget?.kind === 'code' ? itemTarget.code : parsed.code;

  let warehouse: string | null = null;
  if (parsed.warehouseName) {
    const wt = mapping.warehouses[parsed.warehouseName];
    if (wt?.kind === 'skip') return skipped(`انبار «${parsed.warehouseName}» کنار گذاشته شد.`);
    warehouse = wt?.kind === 'warehouse' ? wt.code : lookups.warehouseCodeOf(parsed.warehouseName);
    if (!warehouse) return unresolved(`انبار «${parsed.warehouseName}» را به یک انبار برنامه وصل کنید.`);
  }

  const row: StockImportRow = {
    rowNo: parsed.rowNo,
    sheet: parsed.sheet,
    date: kind === 'opening' ? STOCK_OPENING_DAY : parsed.date,
    kind,
    itemCode,
    quantity: parsed.quantity,
    unitCost: parsed.unitCost || null,
    warehouse,
    slipRef: parsed.slipRef,
    description: [parsed.recipientName && `گیرنده: ${parsed.recipientName}`, parsed.description].filter(Boolean).join(' — '),
    duplicateAccepted: accepted?.has(`${parsed.sheet}#${parsed.rowNo}`) || undefined,
  };
  if (kind !== 'opening' && !parsed.date) return unresolved('تاریخ ردیف خالی است.');
  if (kind === 'purchase') {
    const st = mapping.suppliers[parsed.supplierName];
    if (!parsed.supplierName) return unresolved('تأمین‌کنندهٔ این خرید خالی است.');
    if (st?.kind === 'skip') return skipped(`تأمین‌کننده «${parsed.supplierName}» کنار گذاشته شد.`);
    if (st?.kind !== 'supplier') return unresolved(`تأمین‌کننده «${parsed.supplierName}» را به یک تأمین‌کنندهٔ برنامه وصل کنید.`);
    row.supplierId = st.partyId;
  }
  // the recipient stays in the notes only: a past remittance with a recipient would ask them today to confirm the delivery
  if (kind === 'transfer') {
    if (!mapping.displayWarehouse) return unresolved('انبار «نمایش» را برای «انتقال به نمایش» انتخاب کنید.');
    row.toWarehouse = mapping.displayWarehouse;
  }
  if (kind === 'return') {
    // a sales return goes back on its invoice (recorded by this import from the sales sheet), at that invoice's prices
    const invoiceRef = excelInvoiceNumber(parsed.slipRef);
    if (!invoiceRef) return unresolved('شمارهٔ فاکتور مرجع این برگشت خالی است؛ شمارهٔ فاکتور اکسلی را که کالا با آن فروخته شده بنویسید.');
    row.invoiceRef = invoiceRef;
    row.unitCost = null;
    // sold from the sales warehouse, so with no warehouse named it comes back there
    if (!parsed.warehouseName) row.warehouse = mapping.salesWarehouse || null;
  }
  return { status: 'ready', parsed, row };
}

const decimalTimes = (a: string, b: string): number => Number(a) * Number(b);

/** A line of the sales sheet: one line of the final sales invoice its Excel number names. */
function resolveSalesRow(parsed: ParsedStockRow, mapping: StockImportMapping, accepted?: ReadonlySet<string>): ResolvedStockRow {
  const unresolved = (reason: string): ResolvedStockRow => ({ status: 'unresolved', parsed, reason });
  const skipped = (reason: string): ResolvedStockRow => ({ status: 'skipped', parsed, reason });
  if (!parsed.invoiceRef) return unresolved('شمارهٔ فاکتور خالی است.');
  if (typeKey(parsed.statusText) !== SALES_FINAL_STATUS && !accepted?.has(salesInvoiceKey(parsed.invoiceRef))) {
    return skipped(`وضعیت فاکتور ${parsed.invoiceRef} در اکسل «${SALES_FINAL_STATUS}» نیست؛ اگر فروش انجام شده، آن را در مرحلهٔ نام‌ها در فهرست بیاورید.`);
  }
  if (!parsed.code) return unresolved('کد کالا خالی است.');
  const itemTarget = mapping.items[codeKey(parsed.code)];
  if (itemTarget?.kind === 'skip') return skipped(`کد «${parsed.code}» کنار گذاشته شد.`);
  if (!parsed.date) return unresolved('تاریخ فاکتور خالی است.');
  if (!parsed.quantity) return unresolved('تعداد خالی است.');
  if (!parsed.unitPrice) return unresolved('قیمت این ردیف خالی است.');
  if (parsed.lineTotal && Math.abs(decimalTimes(parsed.quantity, parsed.unitPrice) - Number(parsed.lineTotal)) > 1) {
    return unresolved(`جمع کل (${parsed.lineTotal}) با تعداد × قیمت نمی‌خواند؛ یکی را درست کنید.`);
  }
  if (!parsed.customerName) return unresolved('مشتری فاکتور خالی است.');
  const ct = mapping.customers?.[parsed.customerName];
  if (ct?.kind === 'skip') return skipped(`مشتری «${parsed.customerName}» کنار گذاشته شد.`);
  if (ct?.kind !== 'customer') return unresolved(`مشتری «${parsed.customerName}» را به یک مشتری برنامه وصل کنید.`);
  const row: StockImportRow = {
    rowNo: parsed.rowNo,
    sheet: parsed.sheet,
    date: parsed.date,
    kind: 'sale',
    itemCode: itemTarget?.kind === 'code' ? itemTarget.code : parsed.code,
    quantity: parsed.quantity,
    unitPrice: parsed.unitPrice,
    invoiceRef: parsed.invoiceRef,
    customerId: ct.partyId,
    warehouse: mapping.salesWarehouse || null,
    description: parsed.pricePolicy ? `سیاست قیمتی: ${parsed.pricePolicy}` : '',
    duplicateAccepted: accepted?.has(`${parsed.sheet}#${parsed.rowNo}`) || undefined,
  };
  return { status: 'ready', parsed, row };
}

/** The day of a sales line as the window reads it; an empty or unreadable date (which the window puts in no month) is a day of its own. */
const salesDayKey = (date: string): string => {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(date.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : `«${date.trim() || 'خالی'}»`;
};

/**
 * An Excel invoice is imported whole or not at all: when a line of it is left out (its code or customer left out, its
 * status not «ثبت نهایی») or waits for a fix, its other lines wait too, since a part of an invoice recorded under its
 * Excel number could never be completed (the number is then taken). Lines of an invoice left out as a whole stay left out.
 */
export function wholeSalesInvoices(resolved: ResolvedStockRow[], allRows: ParsedStockRow[] = []): ResolvedStockRow[] {
  const blocked = new Map<string, string>();
  // an invoice has one date: lines of one Excel number on two days (perhaps in two months, imported apart) or with an empty
  // or unreadable date (in no month's view) are a data error
  const daysOf = new Map<string, Set<string>>();
  for (const p of allRows) {
    if (p.shape !== 'sales' || !p.invoiceRef) continue;
    daysOf.set(p.invoiceRef, (daysOf.get(p.invoiceRef) ?? new Set()).add(salesDayKey(p.date)));
  }
  for (const [ref, days] of daysOf) {
    if (days.size > 1) blocked.set(ref, `ردیف‌های آن تاریخ‌های مختلف دارند (${[...days].sort().join('، ')})؛ همه را تاریخ خود فاکتور بزنید`);
  }
  for (const r of resolved) {
    if (r.parsed.shape !== 'sales' || r.status === 'ready' || !r.parsed.invoiceRef) continue;
    if (!blocked.has(r.parsed.invoiceRef)) blocked.set(r.parsed.invoiceRef, `ردیف ${r.parsed.rowNo}: ${r.reason}`);
  }
  return resolved.map(r => {
    if (r.parsed.shape !== 'sales' || r.status !== 'ready') return r;
    const why = blocked.get(r.parsed.invoiceRef);
    return why ? { status: 'unresolved', parsed: r.parsed, reason: `فاکتور ${r.parsed.invoiceRef} یک‌جا ثبت می‌شود و ردیف دیگری از آن آماده نیست (${why})؛ آن ردیف را درست کنید یا کل فاکتور را کنار بگذارید.` } : r;
  });
}

/** Invoices of the sales sheet whose Excel status is not «ثبت نهایی»: the user decides, one by one, whether each was sold. */
export function unissuedSalesInvoices(rows: ParsedStockRow[]): Array<{ invoiceRef: string; customerName: string; lines: number }> {
  const byRef = new Map<string, { invoiceRef: string; customerName: string; lines: number }>();
  for (const r of rows) {
    if (r.shape !== 'sales' || !r.invoiceRef || !r.code || typeKey(r.statusText) === SALES_FINAL_STATUS) continue;
    const seen = byRef.get(r.invoiceRef) ?? { invoiceRef: r.invoiceRef, customerName: r.customerName, lines: 0 };
    seen.lines += 1;
    byRef.set(r.invoiceRef, seen);
  }
  return [...byRef.values()].sort((a, b) => Number(a.invoiceRef) - Number(b.invoiceRef) || a.invoiceRef.localeCompare(b.invoiceRef));
}

/**
 * The mapping after the user fixed or left out a code the preview named. The server names the code it was sent, which may
 * already be a mapped one (a mistyped first fix); the mapping is kept by the Excel code of the rows that sent it.
 */
export function remapItemCode(mapping: StockImportMapping, resolved: ResolvedStockRow[], sentCode: string, target: string): StockImportMapping {
  const excelCodes = new Set(resolved.flatMap(r => (r.status === 'ready' && codeKey(r.row.itemCode) === codeKey(sentCode) ? [codeKey(r.parsed.code)] : [])));
  if (excelCodes.size === 0) excelCodes.add(codeKey(sentCode));
  const items = { ...mapping.items };
  for (const key of excelCodes) items[key] = target ? { kind: 'code', code: target } : { kind: 'skip' };
  return { ...mapping, items };
}
