/**
 * v11 history import (tool 2 of the 1405 replay): the contract between the warehouse Excel import window and the server.
 * The window reads the cleaned sheets «ورود به انبار» and «خروج دستی», the user maps each item code, warehouse and
 * supplier once, and the window sends one resolved row per Excel row. The server previews them (the real services in a
 * transaction that is rolled back) or posts them all in one transaction, day by day; one refused row posts nothing.
 */

/** one month at a time, so a post (a preview pass, then the real one) answers well within the proxy's two minutes */
export const STOCK_IMPORT_MAX_ROWS = 400;

/**
 * What one Excel row becomes: opening stock on the first day (Dr inventory / Cr opening capital), a purchase receipt with
 * its price and supplier, a production receipt with its cost, a consumption remittance, a waste document, or a transfer
 * between two warehouses. A sales return comes in with the past sales invoices (tool 3), which it refers to.
 */
export type StockImportKind = 'opening' | 'purchase' | 'production' | 'consumption' | 'waste' | 'transfer';

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

/** Within a day: stock comes in first (opening, purchases, production), then moves between warehouses, then leaves. */
const KIND_ORDER: Record<StockImportKind, number> = { opening: 0, purchase: 1, production: 2, transfer: 3, consumption: 4, waste: 5 };

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
 * rows and transfers have no shared document (each opening row is its own Kardex row; a transfer has one line).
 */
export function stockImportDocumentKey(isoDate: string, row: StockImportRow): string | null {
  const wh = (row.warehouse ?? '').trim();
  const slip = (row.slipRef ?? '').trim();
  switch (row.kind) {
    case 'purchase': return ['purchase', isoDate, row.supplierId ?? '', wh, slip].join('|');
    case 'production': return ['production', isoDate, wh, slip].join('|');
    case 'consumption': return ['consumption', isoDate, wh, slip, row.recipientPersonnelId ?? ''].join('|');
    case 'waste': return ['waste', isoDate, wh, slip].join('|');
    default: return null;
  }
}

/** Two rows are the same movement when they have the same day, kind, item, quantity and warehouses. */
export function stockImportDuplicateKey(isoDate: string, row: StockImportRow, itemId: number, quantity: string): string {
  return [isoDate, row.kind, itemId, quantity, (row.warehouse ?? '').trim(), (row.toWarehouse ?? '').trim()].join('|');
}

/** The notes a document is recorded with: the Excel slip number and the rows' texts. */
export function stockImportNotes(slipRef: string | undefined, descriptions: Array<string | undefined>): string {
  const texts = [...new Set(descriptions.map(d => (d ?? '').trim()).filter(Boolean))];
  const slip = (slipRef ?? '').trim();
  return ['ورود سابقه از اکسل', slip ? `(شماره اکسل: ${slip})` : '', texts.join('؛ ')].filter(Boolean).join(' ');
}
