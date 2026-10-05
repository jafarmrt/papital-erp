import { and, eq, ilike, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { DocumentService } from '../document.service.js';
import { applyDeliveredLines, type RequisitionItemWithReceipt } from './requisitionReceipt.js';

/** v8.0.10 (TD-267): انواع سندی که مسیر تحویل تدارکات به انبار نهایی می‌کند (فقط ورود کالا) */
export const PROCUREMENT_INCOMING_TYPES = ['receipt', 'purchase'];

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

/**
 * v8.0.51 (TD-326): «دریافت کالا»ی درخواست خرید (اقدام گردش‌کار receive_items)، درون تراکنش فراخواننده و زیر قفل ردیف
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

  const linkedIds = new Set<number>();
  for (const row of rows) {
    for (const id of Array.isArray(row.linkedDocumentIds) ? row.linkedDocumentIds : []) {
      if (Number(id) > 0) linkedIds.add(Number(id));
    }
  }
  const linkedDocs = linkedIds.size === 0 ? [] : await tx
    .select({ id: documents.id, type: documents.type, refNumber: documents.refNumber, status: documents.status })
    .from(documents)
    .where(and(inArray(documents.id, [...linkedIds]), eq(documents.isDeleted, 0)));
  // سفارش‌هایی که کد درخواست را در یادداشت دارند ولی به ردیفی پیوند نخورده‌اند (فقط سند ورودی خرید)
  const notedDocs = await tx
    .select({ id: documents.id, type: documents.type, refNumber: documents.refNumber, status: documents.status })
    .from(documents)
    .where(and(
      ilike(documents.notes, containsLikePattern(req.code)),
      inArray(documents.type, PROCUREMENT_INCOMING_TYPES),
      eq(documents.isDeleted, 0)
    ));

  const orderDocs = new Map<number, (typeof linkedDocs)[number]>();
  for (const doc of [...linkedDocs, ...notedDocs]) orderDocs.set(doc.id, doc);
  for (const doc of [...orderDocs.values()].sort((a, b) => a.id - b.id)) {
    if (doc.status === 'final') continue;
    opts.assertIncoming(doc);
    await DocumentService.finalizeDocument(doc.id, opts.username, tx, { allowBackdate: opts.allowBackdate });
  }
  const requisitionDocIds = new Set(orderDocs.keys());

  const neverOrdered = rows.filter(row =>
    !(Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.length > 0) && row.itemId && Number(row.requestedQty || 0) > 0);
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
