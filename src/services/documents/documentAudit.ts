import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';
import { computeAuditDiff } from '../../lib/auditLogger.js';
import { fin } from '../../lib/financialDecimal.js';

/**
 * v9.0.337 (TD-785، یافته B08-16): ردیف ممیزی سند از خود پایگاه‌داده و درون همان تراکنش تغییر. پیش‌تر ثبت بدنه درخواست را
 * «پس از» می‌نوشت (نه نوع، وضعیت و شماره ذخیره‌شده)، ویرایش «پیش از» نداشت، تغییر یادداشت سند قطعی ردیفی نمی‌نوشت، ابطال
 * دو ردیف `DELETE` داشت و همه پس از commit نوشته می‌شدند.
 */

export interface DocumentAuditLine {
  itemId: number;
  quantity: string;
  unitPrice: string;
  discount: string;
  location: string;
}

export interface DocumentAuditSnapshot {
  id: number;
  docType: string;
  refNumber: string;
  refFiscalYear: number | null;
  status: string;
  date: string;
  partyId: number | null;
  buyerName: string;
  buyerPhone: string;
  buyerCity: string;
  buyerAddress: string;
  currency: string;
  exchangeRate: string | null;
  vatPercent: string;
  vatAmount: string;
  serviceChargeAmount: string;
  notes: string;
  projectId: number | null;
  crmLeadId: number | null;
  returnOfDocumentId: number | null;
  attachments: Array<{ id: string; name: string }>;
  version: number;
  items: DocumentAuditLine[];
}

/** پیش و پس از یک تغییر سند (`null`: سند نبود یا تغییری رخ نداد) */
export interface DocumentAuditChange {
  before: DocumentAuditSnapshot | null;
  after: DocumentAuditSnapshot | null;
}

/** کاربر و نشانی IP درخواست، برای ردیف ممیزی‌ای که سرویس درون تراکنش خود می‌نویسد */
export interface DocumentAuditActor {
  userId?: number;
  username?: string;
  userFullName?: string;
  ipAddress?: string;
}

/** ابطال از مسیر کاربر: همان یک ردیف `DELETE` سرویس، با کاربر درخواست و شرح افزوده (مانند آزاد شدن پرونده فروش) */
export interface DocumentVoidAudit {
  actor?: DocumentAuditActor;
  note?: string;
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const optionalText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const optionalId = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** سند و ردیف‌های فعالش همان‌گونه که در پایگاه‌داده است (مبلغ‌ها متن دقیق، بی گرد کردن) */
export async function documentAuditSnapshot(db: DbExecutor, docId: number): Promise<DocumentAuditSnapshot | null> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
  if (!doc) return null;
  const lines = await db.select({
    itemId: documentItems.itemId, quantity: documentItems.quantity, unitPrice: documentItems.unitPrice,
    discount: documentItems.discount, location: documentItems.location,
  }).from(documentItems)
    .where(and(eq(documentItems.documentId, docId), eq(documentItems.isDeleted, 0)))
    .orderBy(asc(documentItems.id));
  return {
    id: doc.id,
    docType: doc.type,
    refNumber: text(doc.refNumber),
    refFiscalYear: optionalId(doc.refFiscalYear),
    status: text(doc.status),
    date: text(doc.date),
    partyId: optionalId(doc.partyId),
    buyerName: text(doc.buyerName),
    buyerPhone: text(doc.buyerPhone),
    buyerCity: text(doc.buyerCity),
    buyerAddress: text(doc.buyerAddress),
    currency: text(doc.currency || 'IRR'),
    exchangeRate: optionalText(doc.exchangeRate),
    vatPercent: text(doc.vatPercent ?? 0),
    vatAmount: text(doc.vatAmount ?? 0),
    serviceChargeAmount: text(doc.serviceChargeAmount ?? 0),
    notes: text(doc.notes),
    projectId: optionalId(doc.projectId),
    crmLeadId: optionalId(doc.crmLeadId),
    returnOfDocumentId: optionalId(doc.returnOfDocumentId),
    attachments: (Array.isArray(doc.attachments) ? doc.attachments : []).map(a => ({ id: text(a?.id), name: text(a?.name ?? a?.fileName) })),
    version: Number(doc.version),
    items: lines.map(line => ({
      itemId: line.itemId,
      quantity: text(line.quantity),
      unitPrice: text(line.unitPrice ?? 0),
      discount: text(line.discount ?? 0),
      location: text(line.location),
    })),
  };
}

/** جزئیات ممیزی یک تغییر: پیش، پس و فقط فیلدهای تغییرکرده (نسخه که با هر نوشتن جلو می‌رود تغییر شمرده نمی‌شود) */
export function documentAuditDetails(
  before: DocumentAuditSnapshot | null,
  after: DocumentAuditSnapshot | null,
): { before: DocumentAuditSnapshot | null; after: DocumentAuditSnapshot | null; changes: Record<string, { before: unknown; after: unknown }> } {
  const { diff } = computeAuditDiff(
    (before ?? {}) as unknown as Record<string, unknown>,
    (after ?? {}) as unknown as Record<string, unknown>,
    ['version'],
  );
  return { before, after, changes: diff };
}

/** خلاصه ردیف‌های ذخیره‌شده برای شرح ردیف ممیزی ثبت */
export function documentLineSummary(snapshot: DocumentAuditSnapshot | null): { totalLines: number; totalQty: string; hasDiscounts: boolean } {
  const lines = snapshot?.items ?? [];
  return {
    totalLines: lines.length,
    totalQty: lines.reduce((sum, line) => sum.add(line.quantity), fin(0)).toString(),
    hasDiscounts: lines.some(line => fin(line.discount).isPositive()),
  };
}
