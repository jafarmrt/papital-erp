import { and, eq, ilike, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { DocumentService } from '../document.service.js';
import { ValidationError } from '../../errors/customErrors.js';
import { applyDeliveredLines, isClosedRequisitionRow, type RequisitionItemWithReceipt } from './requisitionReceipt.js';

/** v8.0.10 (TD-267): انواع سندی که مسیر تحویل تدارکات به انبار نهایی می‌کند (فقط ورود کالا) */
export const PROCUREMENT_INCOMING_TYPES = ['receipt', 'purchase'];
const PROCUREMENT_INCOMING_TYPE_SET = new Set(PROCUREMENT_INCOMING_TYPES);
/** v8.0.71 (TD-326): درخواستی که کالایش دریافت شده دوباره دریافت یا سفارش داده نمی‌شود */
export const RECEIVED_REQUISITION_STATUSES = new Set(['received', 'completed']);

/**
 * v8.0.10 (TD-267): تحویل تدارکات فقط سند ورودی خرید را نهایی می‌کند. پیش‌تر هر سند غیرنهایی (از جمله پیش‌فاکتور فروش)
 * از این مسیر نهایی می‌شد و نهایی‌سازی پیش‌فاکتور آن را فاکتور فروش با خروج کالا می‌کرد.
 */
export function assertProcurementIncomingDocument(doc: { id: number; type: string | null; refNumber: string | null }): void {
  if (!PROCUREMENT_INCOMING_TYPE_SET.has(String(doc.type))) {
    throw new ValidationError(`سند «${doc.refNumber ?? doc.id}» (نوع ${doc.type ?? '-'}) سند خرید نیست و از مسیر تحویل تدارکات به انبار نهایی نمی‌شود.`);
  }
}

interface ReceivedRequisition {
  code: string;
  projectName?: string | null;
  items?: RequisitionItemWithReceipt[] | null;
}

interface ReceiveOptions {
  username: string;
  allowBackdate: boolean;
  assertIncoming: (doc: { id: number; type: string | null; refNumber: string | null }) => void;
}

/** برچسب یادداشت سفارش‌هایی که «تبدیل به سفارش» برای درخواست می‌سازد */
export function requisitionOrderTag(code: string): string {
  return `[تدارکات: درخواست ${code}]`;
}

export interface RequisitionOrderDocument {
  id: number;
  type: string | null;
  refNumber: string | null;
  status: string | null;
}

/**
 * سندهای زنده سفارش یک درخواست خرید: سندهایی که ردیف‌های درخواست به آن‌ها پیوند دارند، و سند ورودی خریدی که برچسب
 * `[تدارکات: درخواست <کد>]` را در یادداشت دارد. v9.0.316 (TD-690): برچسب کامل جست‌وجو می‌شود، نه هر یادداشتی که کد
 * درخواست را دارد.
 */
export async function requisitionOrderDocuments(
  tx: DbExecutor,
  req: { code: string; items?: RequisitionItemWithReceipt[] | null },
): Promise<RequisitionOrderDocument[]> {
  const linkedIds = new Set<number>();
  for (const row of Array.isArray(req.items) ? req.items : []) {
    for (const id of Array.isArray(row.linkedDocumentIds) ? row.linkedDocumentIds : []) {
      if (Number(id) > 0) linkedIds.add(Number(id));
    }
  }
  const columns = { id: documents.id, type: documents.type, refNumber: documents.refNumber, status: documents.status };
  const linkedDocs = linkedIds.size === 0 ? [] : await tx.select(columns).from(documents)
    .where(and(inArray(documents.id, [...linkedIds]), eq(documents.isDeleted, 0)));
  // سفارش‌هایی که برچسب درخواست را در یادداشت دارند ولی به ردیفی پیوند نخورده‌اند (فقط سند ورودی خرید)
  const notedDocs = await tx.select(columns).from(documents)
    .where(and(
      ilike(documents.notes, containsLikePattern(requisitionOrderTag(req.code))),
      inArray(documents.type, PROCUREMENT_INCOMING_TYPES),
      eq(documents.isDeleted, 0)
    ));
  const byId = new Map<number, RequisitionOrderDocument>();
  for (const doc of [...linkedDocs, ...notedDocs]) byId.set(doc.id, doc);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * v8.0.71 (TD-326): «دریافت کالا»ی درخواست خرید (اقدام گردش‌کار receive_items)، درون تراکنش فراخواننده و زیر قفل ردیف
 * درخواست. سفارش‌های پیش‌نویس یا پیش‌فاکتورِ درخواست نهایی می‌شوند و کالایی که هرگز سفارش نشده با یک رسید قطعی وارد
 * انبار می‌شود؛ خطای هر کدام کل اقدام را برمی‌گرداند. مقدار دریافتی هر ردیف دوباره از سطرهای فعال اسناد قطعی درخواست
 * ساخته می‌شود (applyDeliveredLines)، نه برابر مقدار درخواست.
 *
 * پیش‌تر این شاخه بی‌تراکنش و بی‌قفل بود: هم‌زمان با «تبدیل به سفارش»، یا پیش از تبدیل و تحویل، کالا دو بار وارد انبار
 * می‌شد؛ خطای نهایی‌سازی فقط در لاگ می‌آمد؛ و مقدار دریافتی برابر مقدار درخواست گذاشته می‌شد حتی وقتی فقط بخشی سفارش و
 * وارد انبار شده بود.
 */
export async function receiveRequisitionItems(
  tx: DbExecutor,
  req: ReceivedRequisition,
  opts: ReceiveOptions
): Promise<RequisitionItemWithReceipt[]> {
  let rows = (Array.isArray(req.items) ? req.items : []).map(row => ({ ...row }));

  const orderDocs = await requisitionOrderDocuments(tx, { code: req.code, items: rows });
  for (const doc of orderDocs) {
    if (doc.status === 'final') continue;
    opts.assertIncoming(doc);
    await DocumentService.finalizeDocument(doc.id, opts.username, tx, { allowBackdate: opts.allowBackdate });
  }
  const requisitionDocIds = new Set(orderDocs.map(doc => doc.id));

  // v9.0.316 (TD-690): ردیفی که هنگام صدور سفارش بسته شد بی سفارش وارد انبار نمی‌شود. v9.0.317 (TD-692): ردیفی هم که
  // سفارش ردیف دیگری از همان کالا پرش کرده است (applyDeliveredLines) دوباره دریافت نمی‌شود؛ تحویل اکنون همین اقدام را
  // در تراکنش خود اجرا می‌کند
  const neverOrdered = rows.filter(row =>
    !(Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.length > 0) && row.itemId && Number(row.requestedQty || 0) > 0
    && !isClosedRequisitionRow(row) && Number(row.receivedQty || 0) < Number(row.requestedQty));
  if (neverOrdered.length > 0) {
    const receiptId = await DocumentService.createDocument({
      docType: 'receipt',
      date: await businessTodayIsoDate(),
      status: 'final',
      buyer_name: 'تامین‌کننده تدارکات',
      notes: `[تدارکات: تحویل مستقیم به انبار] درخواست ${req.code} ${req.projectName ? `[پروژه: ${req.projectName}]` : ''}`.trim(),
      location: '',
      inOut: 'in',
      currency: 'IRR',
      user: opts.username,
      items: neverOrdered.map(row => ({
        itemId: Number(row.itemId) || 0,
        quantity: Number(row.requestedQty),
        unit_price: Number(row.unitPriceEstimate || 0),
        discount: 0,
        location: '',
      })),
      externalTx: tx,
    });
    requisitionDocIds.add(receiptId);
    const neverOrderedIds = new Set(neverOrdered.map(row => row.id));
    rows = rows.map(row => neverOrderedIds.has(row.id)
      ? { ...row, linkedDocumentIds: [...(Array.isArray(row.linkedDocumentIds) ? row.linkedDocumentIds : []), receiptId] }
      : row);
  }

  // مقدار دریافتی از نو: جمع سطرهای فعال همه اسناد قطعی درخواست، میان ردیف‌های هر کالا به ترتیب
  const lines = requisitionDocIds.size === 0 ? [] : await tx
    .select({ itemId: documentItems.itemId, quantity: documentItems.quantity })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      inArray(documentItems.documentId, [...requisitionDocIds]),
      eq(documentItems.isDeleted, 0),
      eq(documents.isDeleted, 0),
      eq(documents.status, 'final')
    ));
  const stockRows = rows.map(row => row.itemId ? { ...row, receivedQty: 0 } : row);
  return applyDeliveredLines(stockRows, lines).map(row => row.itemId ? row : {
    // ردیف بی‌کالا (خدمت یا کالای سفارشی) وارد انبار نمی‌شود و با همین اقدام دریافت‌شده است
    ...row, receivedQty: row.requestedQty, remainingQty: 0, status: 'received' as const,
  });
}
