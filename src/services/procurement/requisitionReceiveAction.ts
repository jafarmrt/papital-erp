import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';
import { DocumentService } from '../document.service.js';
import { documentAuditDetails } from '../documents/documentAudit.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import { can } from '../../middleware/authorize.js';
import { permissionDefinition } from '../../lib/permissions/permissionCatalog.js';
import { PROCUREMENT_RECEIVE_PERMISSION } from '../../lib/permissions/procurementPermissions.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { applyDeliveredLines, isClosedRequisitionRow, isSettledRequisitionRow, type RequisitionItemWithReceipt } from './requisitionReceipt.js';

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

/**
 * v9.0.455 (TD-904، یافته P5-P01، تصمیم ت۳ الف): تحویل سفارش تدارکات به انبار، افزون بر مجوز تدارکات، همان مجوز ثبت قطعی
 * سند رسید را می‌خواهد. پیش‌تر `procurement.manage` یا `procurement.order` به‌تنهایی سفارش را قطعی و کالا را وارد انبار
 * می‌کرد، در حالی که همان کاربر `PUT /documents/:id/finalize` را ۴۰۳ می‌گرفت. بیرون از تراکنش سنجیده می‌شود (TD-324).
 */
export async function assertMayReceiveIntoStock(user: { role?: string } | undefined, orderLabel: string): Promise<void> {
  if (await can(user, PROCUREMENT_RECEIVE_PERMISSION)) return;
  const title = permissionDefinition(PROCUREMENT_RECEIVE_PERMISSION)?.title ?? PROCUREMENT_RECEIVE_PERMISSION;
  throw new ForbiddenError(
    `تحویل سفارش خرید «${orderLabel}» به انبار مجوز «${title}» را هم می‌خواهد؛ کالا فقط با همان مجوز سند رسید وارد انبار می‌شود.`,
    { permission: PROCUREMENT_RECEIVE_PERMISSION }, 'PROCUREMENT_RECEIVE_PERMISSION_REQUIRED',
  );
}

interface ReceivedRequisition {
  id: number;
  code: string;
  projectName?: string | null;
  items?: RequisitionItemWithReceipt[] | null;
}

interface ReceiveOptions {
  username: string;
  /** v9.0.458 (TD-917): کاربر انجام‌دهنده اقدام، برای ردیف ممیزی نهایی‌سازی هر سفارش */
  userId?: number;
  allowBackdate: boolean;
  assertIncoming: (doc: { id: number; type: string | null; refNumber: string | null }) => void;
}

/** برچسب یادداشت سفارش‌هایی که «تبدیل به سفارش» برای درخواست می‌سازد (فقط برای خواندن کاربر؛ پیوند در ستون است) */
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
 * سندهای زنده سفارش یک درخواست خرید: سندهایی که ستون پیوند `documents.procurement_requisition_id` آن‌ها همین درخواست
 * است، و سندهایی که ردیف‌های درخواست به آن‌ها پیوند دارند (`linkedDocumentIds`). v9.0.347 (TD-691، ت۲): پیوند از ستون
 * خوانده می‌شود؛ پیش‌تر هر سند ورودی که برچسب درخواست را در یادداشت داشت سفارش آن شمرده می‌شد (O28).
 */
export async function requisitionOrderDocuments(
  tx: DbExecutor,
  req: { id: number; items?: RequisitionItemWithReceipt[] | null },
): Promise<RequisitionOrderDocument[]> {
  const linkedIds = new Set<number>();
  for (const row of Array.isArray(req.items) ? req.items : []) {
    for (const id of Array.isArray(row.linkedDocumentIds) ? row.linkedDocumentIds : []) {
      if (Number(id) > 0) linkedIds.add(Number(id));
    }
  }
  const byLink = eq(documents.procurementRequisitionId, req.id);
  return tx.select({ id: documents.id, type: documents.type, refNumber: documents.refNumber, status: documents.status })
    .from(documents)
    .where(and(
      linkedIds.size === 0 ? byLink : or(byLink, inArray(documents.id, [...linkedIds])),
      eq(documents.isDeleted, 0)
    ))
    .orderBy(asc(documents.id));
}

/**
 * v8.0.71 (TD-326): «دریافت کالا»ی درخواست خرید (اقدام گردش‌کار receive_items)، درون تراکنش فراخواننده و زیر قفل ردیف
 * درخواست. سفارش‌های پیش‌نویس یا پیش‌فاکتورِ درخواست نهایی می‌شوند؛ کالایی که هرگز سفارش نشده اقدام را رد می‌کند
 * (v9.0.350، TD-699، ت۴) و خطای هر کدام کل اقدام را برمی‌گرداند. مقدار دریافتی هر ردیف دوباره از سطرهای فعال اسناد قطعی درخواست
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
  const rows = (Array.isArray(req.items) ? req.items : []).map(row => ({ ...row }));

  const orderDocs = await requisitionOrderDocuments(tx, { id: req.id, items: rows });
  for (const doc of orderDocs) {
    if (doc.status === 'final') continue;
    opts.assertIncoming(doc);
    // v10.0.38 (TD-914): سفارش تاریخ روز دریافت را می‌گیرد
    const change = await DocumentService.finalizeDocument(doc.id, opts.username, tx, { allowBackdate: opts.allowBackdate, atFinalizeDay: true });
    // v9.0.458 (TD-917، یافته P5-P10): ردیف ممیزی نهایی‌سازی هر سفارش با شناسه سند و سند پیش و پس از آن، با همین تراکنش،
    // همان ردیف `PUT /documents/:id/finalize` (TD-785). پیش‌تر «دریافت کالا» هیچ ردیفی نمی‌نوشت و خط زمانی سند آن را نمی‌دید.
    if (change) {
      await logActivity({
        tx,
        userId: opts.userId,
        username: opts.username,
        action: 'UPDATE',
        entity: 'اسناد انبار',
        entityId: doc.id,
        description: `نهایی‌سازی سفارش خرید ${change.after?.refNumber || doc.refNumber || doc.id} با «دریافت کالا»ی درخواست خرید ${req.code}`,
        details: { ...documentAuditDetails(change.before, change.after), operation: 'RECEIVE_REQUISITION_ITEMS', documentId: doc.id, requisitionCode: req.code },
      });
    }
  }
  const requisitionDocIds = new Set(orderDocs.map(doc => doc.id));

  // v9.0.350 (TD-699، B10-12، تصمیم ت۴ الف): کالای ردیفی که هرگز سفارش نشده وارد انبار نمی‌شود؛ ورود کالا فقط از راه سفارش
  // با تأمین‌کننده و قیمت و تحویل آن است. پیش‌تر این ردیف‌ها با یک رسید قطعی به نام «تامین‌کننده تدارکات» و به برآورد قیمت
  // (پیش‌فرض ۰) وارد انبار می‌شدند: کالای بی میانگین موزون بی سند حسابداری، و با میانگین موزون به‌صورت «درآمد کالای
  // اهدایی» (TD-268) بی بدهی به تأمین‌کننده. ردیفی که بسته شده (TD-690) یا سفارش ردیف دیگری از همان کالا پرش کرده
  // (TD-692) سفارش‌نشده شمرده نمی‌شود.
  const neverOrdered = rows.filter(row =>
    !(Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.length > 0) && row.itemId && Number(row.requestedQty || 0) > 0
    && !isClosedRequisitionRow(row) && Number(row.receivedQty || 0) < Number(row.requestedQty));
  if (neverOrdered.length > 0) {
    throw new ConflictError(
      `کالای ${neverOrdered.map(row => `«${row.itemName || row.itemCode || row.itemId}»`).join('، ')} در درخواست خرید ${req.code} هنوز سفارش داده نشده است. ابتدا سفارش خرید با تأمین‌کننده و قیمت صادر کنید.`,
      { rowIds: neverOrdered.map(row => row.id) }, 'REQUISITION_ROWS_NOT_ORDERED',
    );
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
  const received = applyDeliveredLines(stockRows, lines).map(row => row.itemId ? row : {
    // ردیف بی‌کالا (خدمت یا کالای سفارشی) وارد انبار نمی‌شود و با همین اقدام دریافت‌شده است
    ...row, receivedQty: row.requestedQty, remainingQty: 0, status: 'received' as const,
  });
  assertRequisitionSettled(req.code, received);
  return received;
}

/**
 * v9.0.457 (TD-911، یافته P5-P02): درخواست فقط وقتی «دریافت‌شده» می‌شود که هر ردیفش به اندازه درخواست دریافت یا بسته شده
 * باشد (`isSettledRequisitionRow`، همان قاعده تحویل سفارش در TD-690). پیش‌تر «دریافت کالا» پس از سفارش ۶ از ۱۰ درخواست را
 * «دریافت‌شده» می‌کرد و ۴ عدد مانده دیگر سفارش داده نمی‌شد (۴۰۹)، در حالی که تحویل همان سفارش درخواست را باز نگه می‌داشت.
 * خطا کل انتقال را برمی‌گرداند: سفارشی قطعی و کالایی وارد انبار نمی‌شود.
 */
function assertRequisitionSettled(code: string, rows: RequisitionItemWithReceipt[]): void {
  const open = rows.filter(row => !isSettledRequisitionRow(row));
  if (open.length === 0) return;
  const quantity = (value: unknown) => formatPersianNumber(Number(value || 0), 4) || '۰';
  const names = open.map(row => `«${row.itemName || row.itemCode || row.itemId}» (${quantity(row.receivedQty)} از ${quantity(row.requestedQty)} دریافت می‌شود)`);
  throw new ConflictError(
    `درخواست خرید ${code} با این اقدام کامل دریافت نمی‌شود: ${names.join('، ')}. ${REQUISITION_UNSETTLED_HINT}`,
    { rowIds: open.map(row => row.id) }, 'REQUISITION_ROWS_NOT_SETTLED',
  );
}

/** v9.0.457 (TD-911): راهنمای پیام رد «دریافت کالا»ی درخواستی که ردیف باز دارد */
export const REQUISITION_UNSETTLED_HINT = 'مانده را سفارش دهید، یا هنگام صدور سفارش «تکمیل و بستن پرونده درخواست خرید» را بزنید؛ برای ورود کالای سفارش‌های صادرشده و باز ماندن درخواست، سفارش را از فهرست سفارش‌ها تحویل دهید.';
