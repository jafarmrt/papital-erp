import { eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, historyImportRefs } from '../../db/schema.js';
import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { logActivity } from '../../lib/auditLogger.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount.js';
import { STOCK_OPENING_DAY } from '../../lib/historyImport/stockSheet.js';
import {
  STOCK_IMPORT_INCOMING_KINDS, excelInvoiceNumber, stockImportDocumentKey, stockImportDuplicateKey, stockImportNotes, stockImportOrder,
  type StockImportKind, type StockImportResult, type StockImportRow, type StockImportRowOutcome,
} from '../../lib/historyImport/stockHistoryImport.js';
import { isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { DocumentService } from '../document.service.js';
import { permissionToCreateDocument } from '../documents/documentRecordRule.js';
import { OPENING_STOCK_PERMISSION } from '../../lib/permissions/stockActionPermissions.js';
import type { DocumentAuditActor } from '../documents/documentAudit.js';
import { FiscalPeriodService } from '../accounting/fiscalPeriod.service.js';
import { ItemOpeningService, itemIdsWithOpeningVoucher } from '../inventory/itemOpening.service.js';
import { OPENING_KARDEX_ROW } from '../inventory/itemOpeningValue.js';
import { InventoryStockRepairService } from '../inventory/inventoryStockRepair.service.js';
import { LEDGER_ROW_FILTER } from '../inventory/stockMovementDate.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { ImportItemIndex } from '../items/itemImportIndex.js';
import { lockHistoryImport, runImportRows, type RowAttempt } from './importRunner.js';
import { listOldOpenings, withdrawOldOpenings } from '../inventory/itemOpeningReplay.js';
import { orm } from '../../db/drizzle.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';
import type { OldOpeningList, OldOpeningWithdrawResult } from '../../lib/historyImport/oldOpening.js';

/**
 * v11 history import, tool 2: the warehouse rows of 1405 from Excel (decision of the owner, 6 Aban 1405: all of 1405 is
 * entered again from 1 Farvardin, each movement on its own day). Each document goes through the service the warehouse
 * form calls (`createDocumentWithDetails` for a purchase receipt, production receipt, consumption remittance or waste, the
 * warehouse transfer), so the Kardex rows, vouchers (draft) and audit rows are the ones a hand entry makes, with the same
 * rules: stock never below zero, a movement never before the item's last movement, an incoming line never without cost.
 * Opening stock enters on its day as the opening rows of an item that has not moved yet (the item form's opening, Kardex
 * reference «ثبت موجودی افتتاحیه»), with one draft opening voucher per day (Dr inventory / Cr opening capital). Rows run
 * day by day (in, then between warehouses, then out); a row like one already in the file or the books waits for the user.
 * A preview runs everything and keeps nothing; a post keeps everything or nothing.
 */

export interface StockImportOptions {
  commit: boolean;
  userId?: number;
  username?: string;
  audit?: DocumentAuditActor & { req?: unknown };
  /**
   * the kinds the user may record by hand (computed in the route from the permission each form asks, never read from the
   * body): a row of another kind is refused, as the hand entry would be
   */
  allowedKinds: ReadonlySet<StockImportKind>;
}

/** The kind of `history_import_refs` row a past sales invoice is recorded under. */
export const SALES_INVOICE_REF_KIND = 'sales_invoice';

interface PreparedRow {
  row: StockImportRow;
  /** the item the row's code names, found in the import's transaction (0 until then) */
  itemId: number;
  isoDate: string;
  quantity: string;
  unitCost: string | null;
  unitPrice: string | null;
  outcome: StockImportRowOutcome;
}

export const OPENING_KARDEX_REF = 'ثبت موجودی افتتاحیه';
const OPENING_KARDEX_NOTES = 'موجودی اولیه از ورود سابقه اکسل';

const faDate = (iso: string) => toPersianDigits(isoToJalaliDate(iso));
/** opening stock is entered on the first day of 1405 only (owner's decision, 6 Aban 1405), as the window sends it */
const OPENING_DAY_ISO = requireStorageDate(STOCK_OPENING_DAY, 'روز موجودی اولیه');
const faRow = (n: number) => toPersianDigits(String(n));

/** The Kardex row a kind writes: its direction and document type, for the duplicate check against the books. */
const KARDEX_OF: Record<StockImportKind, { type: 'in' | 'out'; documentType: string }> = {
  opening: { type: 'in', documentType: 'audit' },
  purchase: { type: 'in', documentType: 'receipt' },
  production: { type: 'in', documentType: 'production_receipt' },
  transfer: { type: 'out', documentType: 'transfer' },
  consumption: { type: 'out', documentType: 'remittance' },
  waste: { type: 'out', documentType: 'waste' },
  sale: { type: 'out', documentType: 'invoice' },
  return: { type: 'in', documentType: 'return' },
};

const DOC_TYPE_OF: Partial<Record<StockImportKind, string>> = {
  purchase: 'receipt',
  production: 'production_receipt',
  consumption: 'remittance',
  waste: 'waste',
  sale: 'invoice',
  return: 'return',
};

const DOC_TITLE_OF: Partial<Record<StockImportKind, string>> = {
  purchase: 'رسید خرید',
  production: 'رسید تولید',
  consumption: 'حواله مصرف',
  waste: 'سند ضایعات',
  sale: 'فاکتور فروش',
  return: 'برگشت از فروش',
};

function prepare(rows: StockImportRow[]): PreparedRow[] {
  return rows.map(row => {
    const outcome: StockImportRowOutcome = { rowNo: row.rowNo, sheet: row.sheet, status: 'ok' };
    const fail = (message: string) => {
      outcome.status = 'error';
      outcome.message = message;
    };
    let isoDate = '';
    try {
      isoDate = requireStorageDate(row.date, `تاریخ ردیف ${faRow(row.rowNo)}`);
      if (!isoDate) fail('تاریخ ردیف خالی است؛ هر ردیف با تاریخ خودش ثبت می‌شود.');
    } catch (err) {
      fail(err instanceof ValidationError ? err.message : 'تاریخ ردیف خوانده نشد.');
    }
    const quantity = historyImportAmount(row.quantity) ?? '';
    const unitCost = historyImportAmount(row.unitCost);
    const unitPrice = historyImportAmount(row.unitPrice);
    const invoiceRef = excelInvoiceNumber(row.invoiceRef);
    row.invoiceRef = invoiceRef;
    if (outcome.status === 'ok') {
      if (!quantity) fail('تعداد ردیف خالی یا نادرست است؛ یک عدد بزرگ‌تر از صفر بنویسید.');
      else if (STOCK_IMPORT_INCOMING_KINDS.has(row.kind) && !unitCost) fail('قیمت واحد این ردیف خالی یا نادرست است؛ موجودی اولیه، خرید و تولید با بهای واحد (ریال) وارد انبار می‌شوند.');
      else if (row.kind === 'purchase' && !row.supplierId) fail('تأمین‌کنندهٔ این خرید مشخص نیست.');
      else if (row.kind === 'transfer' && !(row.toWarehouse ?? '').trim()) fail('انبار مقصد این انتقال مشخص نیست.');
      else if ((row.kind === 'sale' || row.kind === 'return') && !invoiceRef) fail('شمارهٔ فاکتور اکسل این ردیف خالی است.');
      else if (row.kind === 'sale' && !row.customerId) fail('مشتری این فاکتور مشخص نیست.');
      else if (row.kind === 'sale' && !unitPrice) fail('قیمت این ردیف فاکتور خالی یا نادرست است؛ یک عدد بزرگ‌تر از صفر (ریال) بنویسید.');
      else if (row.kind === 'opening' && isoDate !== OPENING_DAY_ISO) fail(`موجودی اولیه فقط با تاریخ ${faDate(OPENING_DAY_ISO)} ثبت می‌شود.`);
    }
    return { row, itemId: 0, isoDate, quantity, unitCost, unitPrice, outcome };
  });
}

/** Kardex rows already in the books that look like an imported row: same day, item, direction, document type and quantity. */
async function bookedKeys(tx: DbExecutor, prepared: PreparedRow[]): Promise<Set<string>> {
  const keys = new Set<string>();
  const itemIds = [...new Set(prepared.map(p => p.itemId))];
  const days = [...new Set(prepared.map(p => p.isoDate))];
  if (itemIds.length === 0 || days.length === 0) return keys;
  const res = await tx.execute(sql`
    SELECT t.item_id AS "itemId", t.type, t.document_type AS "documentType", t.quantity::text AS quantity,
           to_char(t.date, 'YYYY-MM-DD') AS day
      FROM transactions t
     WHERE t.item_id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})
       AND to_char(t.date, 'YYYY-MM-DD') IN (${sql.join(days.map(d => sql`${d}`), sql`, `)})
       AND ${LEDGER_ROW_FILTER}`);
  for (const r of (res.rows ?? []) as Array<{ itemId: number; type: string; documentType: string | null; quantity: string; day: string }>) {
    keys.add([r.day, Number(r.itemId), r.type, r.documentType ?? '', fin(r.quantity).round(4).toString()].join('|'));
  }
  return keys;
}

const bookedKeyOf = (p: PreparedRow) => {
  const k = KARDEX_OF[p.row.kind];
  return [p.isoDate, p.itemId, k.type, k.documentType, p.quantity].join('|');
};

/**
 * The opening of an item: only while the item has not moved (no live Kardex row but opening rows) and has no opening
 * voucher yet. Several opening rows of one item (one per warehouse) are fine; the day's voucher takes them all.
 */
async function postOpening(tx: DbExecutor, p: PreparedRow, options: StockImportOptions, defaultWarehouse: string): Promise<void> {
  await lockStockItems(tx, [p.itemId]);
  await FiscalPeriodService.assertOpen(p.isoDate, tx);
  const moved = await tx.execute(sql`
    SELECT to_char(MIN(t.date), 'YYYY-MM-DD') AS day FROM transactions t
     WHERE t.item_id = ${p.itemId} AND ${LEDGER_ROW_FILTER} AND NOT ${OPENING_KARDEX_ROW}`);
  const movedDay = (moved.rows?.[0] as { day?: string | null } | undefined)?.day;
  if (movedDay) {
    throw new ValidationError(`این کالا از ${faDate(movedDay)} در انبار گردش دارد؛ موجودی اولیه فقط برای کالایی ثبت می‌شود که هنوز گردشی ندارد. سندهای انبار پیشین این کالا را باطل کنید یا موجودی را با رسید وارد کنید.`);
  }
  // an old item can hold stock without Kardex rows (from before the Kardex backfill): an opening on top would part the
  // stock and its average cost from the Kardex
  // (the opening rows of other warehouses this import already wrote are on the Kardex)
  const held = await tx.execute(sql`
    SELECT (SELECT coalesce(sum(current_stock), 0) FROM item_warehouse_stocks WHERE item_id = ${p.itemId})
         - (SELECT coalesce(sum(CASE WHEN t.type = 'in' THEN t.quantity ELSE -t.quantity END), 0) FROM transactions t
             WHERE t.item_id = ${p.itemId} AND ${LEDGER_ROW_FILTER}) AS qty`);
  const heldQty = fin(String((held.rows?.[0] as { qty?: string | number } | undefined)?.qty ?? 0));
  if (!heldQty.isZero()) {
    throw new ValidationError(`این کالا ${toPersianDigits(heldQty.toString())} واحد موجودی دارد که در کاردکس نیست؛ موجودی اولیه از اکسل فقط برای کالایی با موجودی صفر ثبت می‌شود. موجودی ۱ فروردین این کالا را با دست ثبت کنید (انبارگردانی با تاریخ ۱۴۰۵/۰۱/۰۱) و ردیفش را از پرونده بردارید.`);
  }
  if ((await itemIdsWithOpeningVoucher(tx, [p.itemId])).size > 0) {
    throw new ValidationError('این کالا پیش‌تر سند افتتاحیهٔ موجودی دارد؛ موجودی اولیه دوباره ثبت نمی‌شود.');
  }
  await DocumentService.applyStockMovement(tx, {
    itemId: p.itemId,
    inOut: 'in',
    quantity: Number(p.quantity),
    price: p.unitCost ?? '0',
    date: p.isoDate,
    documentType: 'audit',
    documentRef: OPENING_KARDEX_REF,
    user: options.username || 'سیستم',
    targetLoc: (p.row.warehouse ?? '').trim() || defaultWarehouse,
    notes: OPENING_KARDEX_NOTES,
  });
}

async function refOf(tx: DbExecutor, docId: number): Promise<string> {
  const [doc] = await tx.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, docId));
  return doc?.refNumber ?? String(docId);
}

/** The live document an Excel invoice number was recorded as, if any (locked, so two imports never both take a number). */
async function documentOfExcelRef(tx: DbExecutor, excelRef: string): Promise<{ id: number; refNumber: string } | null> {
  const res = await tx.execute(sql`
    SELECT d.id, d.ref_number AS "refNumber"
      FROM history_import_refs r
      JOIN documents d ON d.id = r.document_id
     WHERE r.kind = ${SALES_INVOICE_REF_KIND} AND r.excel_ref = ${excelRef}
       AND d.is_deleted = 0 AND d.type = 'invoice' AND d.status = 'final'
       FOR UPDATE OF r`);
  const row = res.rows?.[0] as { id: number; refNumber: string } | undefined;
  return row ? { id: Number(row.id), refNumber: String(row.refNumber) } : null;
}

/** Records the Excel number of a past sales invoice; the row of a voided invoice with that number is taken over. */
async function recordExcelRef(tx: DbExecutor, excelRef: string, documentId: number): Promise<void> {
  await tx.insert(historyImportRefs).values({ kind: SALES_INVOICE_REF_KIND, excelRef, documentId })
    .onConflictDoUpdate({ target: [historyImportRefs.kind, historyImportRefs.excelRef], set: { documentId, createdAt: sql`now()` } });
}

/**
 * The lines of one Excel invoice must be one invoice as a hand entry makes it: one day and one customer. Lines of another
 * day would otherwise be posted out of the day order.
 */
function assertOneInvoice(group: PreparedRow[]): void {
  const days = new Set(group.map(p => p.isoDate));
  const customers = new Set(group.map(p => p.row.customerId ?? 0));
  if (days.size > 1) throw new ValidationError(`ردیف‌های فاکتور ${toPersianDigits(String(group[0].row.invoiceRef))} اکسل تاریخ‌های مختلف دارند (${[...days].map(faDate).join('، ')})؛ یک فاکتور یک تاریخ دارد.`);
  if (customers.size > 1) throw new ValidationError(`ردیف‌های فاکتور ${toPersianDigits(String(group[0].row.invoiceRef))} اکسل مشتری‌های مختلف دارند؛ یک فاکتور یک مشتری دارد.`);
}

/** One document of the warehouse form (or a sales invoice or return) from the rows that share it. */
async function postDocument(tx: DbExecutor, group: PreparedRow[], options: StockImportOptions): Promise<string> {
  const first = group[0];
  const kind = first.row.kind;
  const docType = DOC_TYPE_OF[kind] as string;
  const warehouse = (first.row.warehouse ?? '').trim();
  const excelRef = (first.row.invoiceRef ?? '').trim();
  let returnOfDocumentId: number | undefined;
  if (kind === 'sale') {
    assertOneInvoice(group);
    const recorded = await documentOfExcelRef(tx, excelRef);
    if (recorded) throw new ValidationError(`فاکتور ${toPersianDigits(excelRef)} اکسل پیش‌تر با شمارهٔ ${toPersianDigits(recorded.refNumber)} در برنامه ثبت شده است.`, undefined, 'HISTORY_IMPORT_INVOICE_RECORDED');
  }
  if (kind === 'return') {
    const invoice = await documentOfExcelRef(tx, excelRef);
    if (!invoice) throw new ValidationError(`فاکتور ${toPersianDigits(excelRef)} اکسل در برنامه نیست؛ برگشت پس از ثبت فاکتورش وارد می‌شود.`, undefined, 'HISTORY_IMPORT_INVOICE_MISSING');
    returnOfDocumentId = invoice.id;
  }
  const notes = stockImportNotes(kind === 'sale' || kind === 'return' ? `فاکتور ${excelRef}` : first.row.slipRef, group.map(p => p.row.description));
  const { docId } = await DocumentService.createDocumentWithDetails({
    docType,
    status: 'final',
    date: first.isoDate,
    currency: 'IRR',
    notes,
    location: warehouse || undefined,
    partyId: kind === 'purchase' ? first.row.supplierId ?? null : kind === 'sale' ? first.row.customerId ?? null : undefined,
    recipientPersonnelId: kind === 'consumption' ? first.row.recipientPersonnelId ?? null : undefined,
    returnOfDocumentId,
    items: group.map(p => ({
      itemId: p.itemId,
      quantity: p.quantity,
      ...(p.unitCost ? { unit_price: p.unitCost } : {}),
      ...(kind === 'sale' && p.unitPrice ? { unit_price: p.unitPrice } : {}),
      ...(warehouse ? { location: warehouse } : {}),
    })),
    user: options.username || 'سیستم',
    externalTx: tx,
  }, {
    userId: options.userId,
    allowBackdate: false,
    createdAudit: options.audit ? { actor: options.audit, note: `${DOC_TITLE_OF[kind]} از ورود سابقه اکسل` } : undefined,
  });
  if (kind === 'sale') await recordExcelRef(tx, excelRef, docId);
  return refOf(tx, docId);
}

async function postTransfer(tx: DbExecutor, p: PreparedRow, options: StockImportOptions, defaultWarehouse: string): Promise<string> {
  const result = await InventoryStockRepairService.executeWarehouseTransfer({
    itemId: p.itemId,
    fromLocation: (p.row.warehouse ?? '').trim() || defaultWarehouse,
    toLocation: (p.row.toWarehouse ?? '').trim(),
    quantity: Number(p.quantity),
    date: p.isoDate,
    notes: stockImportNotes(p.row.slipRef, [p.row.description]),
    user: options.username || 'سیستم',
    allowBackdate: false,
  }, tx);
  await logActivity({
    tx,
    req: options.audit?.req,
    userId: options.audit?.userId ?? options.userId,
    username: options.audit?.username ?? options.username,
    userFullName: options.audit?.userFullName,
    action: 'CREATE',
    entity: 'حواله انتقال انبار',
    entityId: String(result.transferDocId),
    description: `ثبت حواله انتقال داخلی کالا از ورود سابقه اکسل (${result.quantity} واحد از انبار ${result.fromLocation} به انبار ${result.toLocation})`,
    details: result,
  });
  return result.refNumber;
}

/** The day's opening voucher, for every item that got opening rows on that day. */
async function issueOpeningVoucher(tx: DbExecutor, isoDate: string, itemIds: number[], options: StockImportOptions): Promise<string | null> {
  const voucher = await ItemOpeningService.issueImportOpeningVoucher(tx, itemIds, {
    userId: options.userId,
    username: options.username,
    date: isoToJalaliDate(isoDate).replace(/\//g, '-'),
    description: `سند افتتاحیه موجودی اولیه ${toPersianDigits(String(itemIds.length))} کالا از ورود سابقه اکسل`,
    referenceNumber: 'ورود سابقه اکسل',
  });
  return voucher ? String(voucher.voucherNumber ?? voucher.id) : null;
}

function markError(rows: PreparedRow[], message: string): void {
  for (const p of rows) {
    p.outcome.status = 'error';
    p.outcome.message = message;
  }
}

/** Each row's item by its code, with the rule of the item Excel import (exact code, else the one code equal but for letter
 * case, else the item that held this code before a code change). A code that names no item, or several, refuses its row. */
async function resolveItems(tx: DbExecutor, rows: PreparedRow[]): Promise<PreparedRow[]> {
  const index = await ImportItemIndex.load(tx, rows.map(p => p.row.itemCode.trim()), []);
  return rows.filter(p => {
    const code = p.row.itemCode.trim();
    const found = index.findByCode(code);
    if (found.item) {
      p.itemId = found.item.id;
      return true;
    }
    p.outcome.status = 'error';
    if (found.ambiguous.length > 0) {
      p.outcome.message = `کد «${code}» به چند کالا می‌خورد (${found.ambiguous.join('، ')})؛ آن را به کد دقیق وصل کنید.`;
      p.outcome.unknownCode = code;
    } else {
      p.outcome.message = `کد «${code}» در برنامه نیست؛ آن را به کد کالای درست وصل کنید.`;
      p.outcome.unknownCode = code;
    }
    return false;
  });
}

/**
 * The permission each kind of row needs: what its hand form asks to record it final (the document's create permission, the
 * transfer form's `warehouse.transfer`, the item form's opening-stock permission).
 */
export const STOCK_IMPORT_KIND_PERMISSIONS: ReadonlyArray<readonly [StockImportKind, string | null]> = [
  ['opening', OPENING_STOCK_PERMISSION],
  ['purchase', permissionToCreateDocument({ docType: 'receipt', status: 'final' })],
  ['production', permissionToCreateDocument({ docType: 'production_receipt', status: 'final' })],
  ['consumption', permissionToCreateDocument({ docType: 'remittance', status: 'final' })],
  ['waste', permissionToCreateDocument({ docType: 'waste', status: 'final' })],
  ['transfer', 'warehouse.transfer'],
  ['sale', permissionToCreateDocument({ docType: 'invoice', status: 'final' })],
  ['return', permissionToCreateDocument({ docType: 'return', status: 'final' })],
];

const KIND_TITLE: Record<StockImportKind, string> = {
  opening: 'موجودی اولیه', purchase: 'رسید خرید', production: 'رسید تولید', consumption: 'حواله مصرف', waste: 'سند ضایعات', transfer: 'انتقال بین انبارها',
  sale: 'فاکتور فروش قطعی', return: 'برگشت از فروش قطعی',
};

async function postInOrder(tx: DbExecutor, attempt: RowAttempt, prepared: PreparedRow[], options: StockImportOptions): Promise<void> {
  const ordered = await resolveItems(tx, prepared);
  const defaultWarehouse = (await getDefaultWarehouseCode(tx)) ?? '';
  const booked = await bookedKeys(tx, ordered);
  const inFile = new Map<string, number>();
  const ready: PreparedRow[] = [];
  for (const p of ordered) {
    const key = stockImportDuplicateKey(p.isoDate, p.row, p.itemId, p.quantity);
    const seen = inFile.get(key);
    inFile.set(key, p.row.rowNo);
    if (!p.row.duplicateAccepted && (seen !== undefined || booked.has(bookedKeyOf(p)))) {
      p.outcome.status = 'duplicate';
      p.outcome.message = seen !== undefined
        ? `این ردیف با ردیف ${faRow(seen)} همین پرونده یکی است (همان روز، نوع، کالا، تعداد و انبار).`
        : 'گردشی با همین روز، کالا، نوع و تعداد پیش‌تر در انبار ثبت شده است.';
      continue;
    }
    ready.push(p);
  }

  const done = new Set<PreparedRow>();
  const openingsByDay = new Map<string, PreparedRow[]>();
  for (const p of ready) {
    if (done.has(p)) continue;
    const docKey = stockImportDocumentKey(p.isoDate, p.row);
    const group = docKey ? ready.filter(q => !done.has(q) && stockImportDocumentKey(q.isoDate, q.row) === docKey) : [p];
    for (const q of group) done.add(q);

    if (!options.allowedKinds.has(p.row.kind)) {
      const err = new ForbiddenError(`ثبت ${KIND_TITLE[p.row.kind]} مجوز همان فرم را می‌خواهد که شما ندارید.`, { kind: p.row.kind }, 'HISTORY_IMPORT_KIND_FORBIDDEN');
      markError(group, err.message);
      continue;
    }
    if (p.row.kind === 'opening') {
      const result = await attempt(sp => postOpening(sp, p, options, defaultWarehouse));
      if (!result.ok) markError([p], result.message);
      else openingsByDay.set(p.isoDate, [...(openingsByDay.get(p.isoDate) ?? []), p]);
      continue;
    }
    const result = await attempt(sp => (p.row.kind === 'transfer' ? postTransfer(sp, p, options, defaultWarehouse) : postDocument(sp, group, options)));
    if (!result.ok) {
      const rowsText = group.length > 1 ? ` (ردیف‌های ${group.map(q => faRow(q.row.rowNo)).join('، ')} در یک سند)` : '';
      markError(group, `${result.message}${rowsText}`);
    } else if (options.commit) {
      for (const q of group) q.outcome.created = [result.value];
    }
  }

  for (const [isoDate, rows] of openingsByDay) {
    const result = await attempt(sp => issueOpeningVoucher(sp, isoDate, [...new Set(rows.map(p => p.itemId))], options));
    if (!result.ok) markError(rows, `سند افتتاحیهٔ موجودی ${faDate(isoDate)} صادر نشد: ${result.message}`);
    else if (options.commit && result.value) for (const p of rows) p.outcome.created = [result.value];
  }
}

export async function importStockHistory(rows: StockImportRow[], options: StockImportOptions): Promise<StockImportResult> {
  const prepared = prepare(rows);
  const ordered = stockImportOrder(prepared.filter(p => p.outcome.status === 'ok'));

  await runImportRows({ commit: options.commit }, async (tx, attempt) => {
    await postInOrder(tx, attempt, ordered, options);
    return prepared.every(p => p.outcome.status === 'ok');
  });

  const outcomes = prepared.map(p => p.outcome).sort((a, b) => (a.sheet === b.sheet ? a.rowNo - b.rowNo : a.sheet < b.sheet ? -1 : 1));
  const count = (s: string) => outcomes.filter(o => o.status === s).length;
  const okCount = count('ok');
  const committed = options.commit && okCount === outcomes.length;
  if (!committed) for (const o of outcomes) delete o.created;
  return { committed, rows: outcomes, okCount, errorCount: count('error'), duplicateCount: count('duplicate') };
}

/** Tool 8, the first step of the stock import: the openings entered before the replay, and whether each can be taken back. */
export async function oldOpeningsBeforeReplay(): Promise<OldOpeningList> {
  return orm.transaction(async (tx) => {
    await lockHistoryImport(tx);
    return listOldOpenings(tx);
  });
}

/** Tool 8: takes back the chosen items' old openings and deletes their draft opening vouchers, all or nothing. */
export async function withdrawOpeningsBeforeReplay(
  itemIds: number[],
  actor: { userId?: number; username?: string; userFullName?: string; req?: unknown },
): Promise<OldOpeningWithdrawResult> {
  return idempotentTransaction(async (tx) => {
    await lockHistoryImport(tx);
    return withdrawOldOpenings(tx, itemIds, actor);
  });
}
