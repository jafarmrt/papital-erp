/**
 * v11 history import (tools 2 and 3 of the 1405 replay): the contract between the warehouse Excel import window and the
 * server. The window reads the cleaned sheets «ورود به انبار», «خروج دستی» and «اقلام فاکتور», the user maps each item
 * code, warehouse, supplier and customer once, and the window sends one resolved row per Excel row. The server previews them (the real services in a
 * transaction that is rolled back) or posts them all in one transaction, day by day; one refused row posts nothing.
 */

/** one month at a time (warehouse and sales rows together), so a post (a preview pass, then the real one) answers well
 * within the proxy's two minutes and holds its locks briefly */
export const STOCK_IMPORT_MAX_ROWS = 400;

/**
 * What one Excel row becomes: opening stock on the first day (Dr inventory / Cr opening capital), a purchase receipt with
 * its price and supplier, a production receipt with its cost, a consumption remittance, a waste document, or a transfer
 * between two warehouses (tool 2); a final sales invoice, one per Excel invoice number, or a sales return of an invoice
 * the import recorded, found by its Excel number (tool 3).
 */
export type StockImportKind = 'opening' | 'purchase' | 'production' | 'consumption' | 'waste' | 'transfer' | 'sale' | 'return';

export interface StockImportRow {
  /** the Excel row number, for messages */
  rowNo: number;
  /** the sheet the row came from */
  sheet: string;
  /** the date as written in Excel (Jalali, `1405-01-05` or `1405/01/05`) */
  date: string;
  kind: StockImportKind;
  /** the item's code in the app (the Excel code, or the code the user mapped it to); the server finds the item by it */
  itemCode: string;
  /** the quantity as decimal text, in the item's unit */
  quantity: string;
  /** opening, purchase and production: the unit cost in rials, as decimal text */
  unitCost?: string | null;
  /** the warehouse (code) the stock enters or leaves; empty = the default warehouse */
  warehouse?: string | null;
  /** transfer only: the warehouse (code) the stock enters */
  toWarehouse?: string | null;
  /** purchase only: the supplier */
  supplierId?: number | null;
  /** consumption only: the colleague who received the goods */
  recipientPersonnelId?: number | null;
  /** sale and return: the Excel invoice number; the lines of one number are one invoice, and a return names its invoice */
  invoiceRef?: string;
  /** sale only: the customer (a party of type customer or both) */
  customerId?: number | null;
  /** sale only: the unit price in rials, as decimal text */
  unitPrice?: string | null;
  /** the Excel slip or invoice number (شماره فاکتور / شماره قبض), kept in the notes; rows of one slip share a document */
  slipRef?: string;
  description?: string;
  /** the user has seen that this row looks like one already recorded and wants it recorded again */
  duplicateAccepted?: boolean;
}

export type StockImportRowStatus = 'ok' | 'error' | 'duplicate';

export interface StockImportRowOutcome {
  rowNo: number;
  sheet: string;
  status: StockImportRowStatus;
  /** the reason of an error or a duplicate, in Persian */
  message?: string;
  /** the document number the row went into, on a posted import */
  created?: string[];
  /** the row's code names no item of the app: the window offers to map it to another code */
  unknownCode?: string;
}

export interface StockImportResult {
  /** true only when every row was posted */
  committed: boolean;
  rows: StockImportRowOutcome[];
  okCount: number;
  errorCount: number;
  duplicateCount: number;
}

/**
 * Within a day: stock comes in first (opening, purchases, production), then moves between warehouses, then leaves (sales
 * first); a return comes last, since it may return what was sold the same day.
 */
const KIND_ORDER: Record<StockImportKind, number> = { opening: 0, purchase: 1, production: 2, transfer: 3, sale: 4, consumption: 5, waste: 6, return: 7 };

export const STOCK_IMPORT_INCOMING_KINDS: ReadonlySet<StockImportKind> = new Set(['opening', 'purchase', 'production']);

/**
 * The order rows are posted in: by day, then the kind order above, then the Excel order. The Excel sheets are not in date
 * order, and stock must not go below zero on a day it ends above zero.
 */
export function stockImportOrder<T extends { isoDate: string; row: Pick<StockImportRow, 'kind' | 'rowNo' | 'sheet'> }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isoDate !== b.isoDate) return a.isoDate < b.isoDate ? -1 : 1;
    const k = KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind];
    if (k !== 0) return k;
    if (a.row.sheet !== b.row.sheet) return a.row.sheet < b.row.sheet ? -1 : 1;
    return a.row.rowNo - b.row.rowNo;
  });
}

/**
 * Rows that become one document, as a hand entry would make them: a purchase per supplier, day, warehouse and slip; a
 * production receipt per day, warehouse and slip; a consumption or waste per day, warehouse, slip and recipient. Opening
 * rows and transfers have no shared document (each opening row is its own Kardex row; a transfer has one line). A sale is
 * one invoice per Excel number (its lines must share the day and the customer); a return one per day, invoice and warehouse.
 */
export function stockImportDocumentKey(isoDate: string, row: StockImportRow): string | null {
  const wh = (row.warehouse ?? '').trim();
  const slip = (row.slipRef ?? '').trim();
  switch (row.kind) {
    case 'purchase': return ['purchase', isoDate, row.supplierId ?? '', wh, slip].join('|');
    case 'production': return ['production', isoDate, wh, slip].join('|');
    case 'consumption': return ['consumption', isoDate, wh, slip, row.recipientPersonnelId ?? ''].join('|');
    case 'waste': return ['waste', isoDate, wh, slip].join('|');
    case 'sale': return ['sale', (row.invoiceRef ?? '').trim()].join('|');
    case 'return': return ['return', isoDate, (row.invoiceRef ?? '').trim(), wh].join('|');
    default: return null;
  }
}

/** Two rows are the same movement when they have the same day, kind, item, quantity, warehouses and invoice. */
export function stockImportDuplicateKey(isoDate: string, row: StockImportRow, itemId: number, quantity: string): string {
  return [isoDate, row.kind, itemId, quantity, (row.warehouse ?? '').trim(), (row.toWarehouse ?? '').trim(), (row.invoiceRef ?? '').trim()].join('|');
}

/** The notes a document is recorded with: the Excel slip number and the rows' texts. */
export function stockImportNotes(slipRef: string | undefined, descriptions: Array<string | undefined>): string {
  const texts = [...new Set(descriptions.map(d => (d ?? '').trim()).filter(Boolean))];
  const slip = (slipRef ?? '').trim();
  return ['ورود سابقه از اکسل', slip ? `(شماره اکسل: ${slip})` : '', texts.join('؛ ')].filter(Boolean).join(' ');
}

/**
 * The Excel invoice number a cell names: the cell holds «61», «۶۱» or «فاکتور 61»; one number in it is the invoice number,
 * anything else is kept as written. Shared by the sales rows, the returns and the treasury receipts that name an invoice.
 */
export function excelInvoiceNumber(cell: string | null | undefined): string {
  const text = String(cell ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  const numbers = text.match(/\d+/g) ?? [];
  return numbers.length === 1 ? String(Number(numbers[0])) : text;
}
