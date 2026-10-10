import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customers, documents } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { DOCUMENT_PARTY_SIDE_LABELS, documentPartySide, partyFitsDocument } from '../../lib/documents/documentPartyKind.js';

/**
 * v9.0.336 (TD-778، یافته B08-09، تصمیم ت۶ الف بسته ۸): سند فروش و خرید طرف حسابش را با شناسه (`documents.party_id`) نگه
 * می‌دارد و نام خریدار فقط برای نمایش است. پیش‌تر سند حسابداری، پرونده مشتری، پیوند خزانه و نگهبان حذف طرف حساب نام متنی
 * سند را با برابری دقیق می‌سنجیدند: «علي رضايي» (ی عربی) یا «ROSE GALLERY» ردیف بی تفصیلی می‌ساخت، کارت حساب و پرونده
 * خالی می‌ماندند و طرف حساب با همان طلب حذف می‌شد. سند پیشین بی شناسه (مهاجرت 0080 فقط نام یکتای برابر را پر کرد) همان
 * قاعده نام پیشین را نگه می‌دارد و در بررسی سلامت فهرست می‌شود.
 */

/** نوع‌هایی که طرف حساب دارند: فروش (فاکتور، پیش‌فاکتور، برگشت از فروش) و خرید (رسید، خرید) */
export const PARTY_DOCUMENT_TYPES = ['invoice', 'proforma', 'return', 'receipt', 'purchase'] as const;

export function documentHasParty(docType: string | null | undefined): boolean {
  return (PARTY_DOCUMENT_TYPES as readonly string[]).includes(String(docType ?? ''));
}

/** شناسه ورودی: `undefined` فرستاده نشده، `null` بی طرف حساب، عدد مثبت شناسه */
export function parseDocumentPartyId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`شناسه طرف حساب سند نامعتبر است: ${String(raw)}`, undefined, 'DOCUMENT_PARTY_INVALID');
  }
  return id;
}

/**
 * طرف حساب سندی که ثبت یا ویرایش می‌شود. شناسه داده‌شده باید طرف حساب حذف‌نشده باشد (۴۲۲ `DOCUMENT_PARTY_INVALID`) و ردیفش
 * `FOR KEY SHARE` قفل می‌شود تا حذف هم‌زمان طرف حساب (که آن را `FOR UPDATE` قفل می‌کند) این سند را ببیند؛ نام خالی نام
 * طرف حساب را می‌گیرد. نوع بی طرف حساب (حواله، ضایعات، انبارگردانی، رسید تولید) شناسه نمی‌گیرد (۴۲۲
 * `DOCUMENT_PARTY_NOT_ALLOWED`). بی شناسه، طرف حساب یکتای هم‌نام (نام بی فاصله دو سر) پیدا می‌شود، همان قاعده پیشین برای
 * فراخواننده‌ای که شناسه نمی‌فرستد؛ نام بی تطبیق یا با چند تطبیق بی طرف حساب می‌ماند.
 */
export async function resolveDocumentParty(tx: DbExecutor, input: {
  docType: string;
  partyId: number | null | undefined;
  buyerName: string;
}): Promise<{ partyId: number | null; buyerName: string }> {
  const buyerName = input.buyerName ?? '';
  if (!documentHasParty(input.docType)) {
    if (input.partyId) {
      throw new ValidationError('این نوع سند طرف حساب نمی‌گیرد؛ طرف حساب فقط برای سند فروش و خرید ثبت می‌شود.', undefined, 'DOCUMENT_PARTY_NOT_ALLOWED');
    }
    return { partyId: null, buyerName };
  }
  if (input.partyId === null) return { partyId: null, buyerName };
  if (input.partyId !== undefined) {
    const [row] = await tx.select({ id: customers.id, name: customers.name, partyType: customers.partyType }).from(customers)
      .where(and(eq(customers.id, input.partyId), eq(customers.isDeleted, 0)))
      .for('key share');
    if (!row) {
      throw new ValidationError(`طرف حساب شماره ${input.partyId} یافت نشد یا حذف شده است.`, undefined, 'DOCUMENT_PARTY_INVALID');
    }
    // v10.0.44 (TD-939): سند خرید فقط تأمین‌کننده و سند فروش فقط مشتری (یا «هر دو») می‌گیرد
    if (!partyFitsDocument(input.docType, row.partyType)) throw partyKindMismatch(input.docType, row.name);
    return { partyId: row.id, buyerName: buyerName.trim() ? buyerName : row.name };
  }
  const name = buyerName.trim();
  if (!name) return { partyId: null, buyerName };
  // v10.0.44 (TD-939): تطبیق نام فقط میان طرف حساب‌های هم‌نوع سند
  const side = documentPartySide(input.docType) ?? 'customer';
  const matches = await tx.select({ id: customers.id }).from(customers)
    .where(and(
      eq(customers.isDeleted, 0),
      sql`btrim(${customers.name}) = ${name}::text`,
      sql`coalesce(nullif(btrim(${customers.partyType}), ''), 'customer') IN (${side}::text, 'both')`,
    ))
    .orderBy(asc(customers.id))
    .limit(2)
    .for('key share');
  if (matches.length === 0) await assertNameNotOtherKind(tx, input.docType, name);
  return { partyId: matches.length === 1 ? matches[0].id : null, buyerName };
}

function partyKindMismatch(docType: string, name: string): ValidationError {
  const side = DOCUMENT_PARTY_SIDE_LABELS[documentPartySide(docType) ?? 'customer'];
  return new ValidationError(
    `طرف حساب «${name}» ${side} نیست؛ این سند فقط طرف حساب از نوع «${side}» یا «هر دو» می‌گیرد. نوع طرف حساب را در پرونده‌اش اصلاح کنید یا طرف حساب دیگری برگزینید.`,
    undefined,
    'DOCUMENT_PARTY_KIND_MISMATCH',
  );
}

/**
 * v10.0.92 (TD-1194): سند بی شناسه طرف حساب با نام طرف حسابی از نوع دیگر (رسید خرید یا سفارش تدارکات با نام یک مشتری) رد
 * می‌شود. پیش‌تر چنین سندی بی شناسه ثبت می‌شد و سند حسابداری خرید با تطبیق نام، بستانکاری تفصیلی «تأمین‌کننده» را با شناسه
 * همان مشتری می‌ساخت. ثبت، ویرایش و نهایی‌سازی (تحویل سفارش، رسید قطعی) همین را می‌خوانند؛ نام بی طرف حساب آزاد است.
 */
export async function assertNameNotOtherKind(tx: DbExecutor, docType: string, buyerName: string | null | undefined): Promise<void> {
  const name = String(buyerName ?? '').trim();
  if (!name || !documentHasParty(docType)) return;
  const rows = await tx.select({ name: customers.name, partyType: customers.partyType }).from(customers)
    .where(and(eq(customers.isDeleted, 0), sql`btrim(${customers.name}) = ${name}::text`))
    .limit(2);
  if (rows.length > 0 && !rows.some(r => partyFitsDocument(docType, r.partyType))) throw partyKindMismatch(docType, name);
}

/** طرف حساب فاکتور مرجع برگشت (بی شناسه: `undefined`، تا برگشت با قاعده نام پیدا شود) */
export async function returnInvoicePartyId(tx: DbExecutor, invoiceId: number): Promise<number | undefined> {
  const [row] = await tx.select({ partyId: documents.partyId }).from(documents).where(eq(documents.id, invoiceId));
  return row?.partyId ?? undefined;
}

/** برگشت با فاکتور مرجعِ دارای طرف حساب به طرف حساب دیگری ثبت نمی‌شود (۴۲۲ `RETURN_PARTY_MISMATCH`) */
export async function assertReturnPartyOfInvoice(tx: DbExecutor, invoiceId: number, partyId: number | null): Promise<void> {
  const invoiceParty = await returnInvoicePartyId(tx, invoiceId);
  if (invoiceParty !== undefined && invoiceParty !== partyId) {
    throw new ValidationError('طرف حساب برگشت از فروش باید همان طرف حساب فاکتور مرجع باشد.', undefined, 'RETURN_PARTY_MISMATCH');
  }
}

/** اسناد یک طرف حساب: شناسه ستون، و سند پیشین بی شناسه با نام برابر (نام بی فاصله دو سر، قاعده TD-417) */
export function documentPartyCondition(party: { id: number; legacyName: string | null | undefined }): SQL {
  const name = (party.legacyName ?? '').trim();
  if (!name) return eq(documents.partyId, party.id);
  return or(eq(documents.partyId, party.id), and(isNull(documents.partyId), sql`btrim(${documents.buyerName}) = ${name}::text`))!;
}

/** شناسه تفصیلی طرف حساب در سند حسابداری سند: ستون؛ سند پیشین بی شناسه با برابری دقیق نام (رفتار پیش از v9.0.336) */
export async function documentVoucherPartyId(
  db: DbExecutor,
  doc: { partyId?: number | null; buyerName?: string | null },
): Promise<number | null> {
  if (doc.partyId) return Number(doc.partyId);
  const name = (doc.buyerName ?? '').trim();
  if (!name) return null;
  const [row] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.name, name), eq(customers.isDeleted, 0)));
  return row?.id ?? null;
}

export interface UnlinkedPartyDocument {
  id: number;
  type: string;
  refNumber: string;
  status: string;
  buyerName: string;
  date: string;
}

/** سند فعال فروش یا خرید با نام خریدار و بی شناسه طرف حساب (مهاجرت 0080 نامش را با یک طرف حساب یکتا نیافت) */
export async function findUnlinkedPartyDocuments(executor: DbExecutor = orm): Promise<UnlinkedPartyDocument[]> {
  const rows = await executor.select({
    id: documents.id, type: documents.type, refNumber: documents.refNumber, status: documents.status,
    buyerName: documents.buyerName, date: documents.date,
  })
    .from(documents)
    .where(and(
      eq(documents.isDeleted, 0), isNull(documents.partyId), inArray(documents.type, [...PARTY_DOCUMENT_TYPES]),
      sql`btrim(COALESCE(${documents.buyerName}, '')) <> ''`,
    ))
    .orderBy(asc(documents.date), asc(documents.id));
  return rows.map(r => ({
    id: r.id, type: r.type, refNumber: String(r.refNumber ?? ''), status: String(r.status ?? ''),
    buyerName: String(r.buyerName ?? ''), date: String(r.date ?? '').slice(0, 10),
  }));
}

const TYPE_LABEL: Record<string, string> = {
  invoice: 'فاکتور فروش', proforma: 'پیش‌فاکتور', return: 'برگشت از فروش', receipt: 'رسید خرید', purchase: 'فاکتور خرید',
};

export function buildUnlinkedPartyDocumentHealthTest(entries: UnlinkedPartyDocument[]): HealthCheckTestResult {
  return {
    id: 'document_party_unlinked',
    category: 'documents',
    title: 'اسناد فروش و خرید بی طرف حساب',
    description: 'از نسخه ۹.۰.۲۸۷ سند فروش و خرید طرف حسابش را با شناسه نگه می‌دارد و سند حسابداری، پرونده مشتری و نگهبان حذف طرف حساب با آن کار می‌کنند. سندهای پیشین فقط وقتی شناسه گرفتند که نام خریدارشان دقیقاً نام یک طرف حساب فعال بود؛ این اسناد بازنویسی نمی‌شوند و با همان قاعده نام پیشین خوانده می‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه اسناد فروش و خرید دارای نام خریدار به طرف حساب وصل‌اند.'
      : `${entries.length} سند فروش یا خرید نام خریدار دارد ولی به طرف حسابی وصل نیست؛ نام آن با هیچ طرف حساب فعالی یکی نیست یا چند طرف حساب هم‌نام‌اند.`,
    items: entries.map(e => ({
      id: `document-${e.id}`,
      code: `${TYPE_LABEL[e.type] ?? e.type} ${e.refNumber}`,
      title: e.buyerName,
      subtitle: `تاریخ: ${isoToJalaliDate(e.date) || e.date}`,
      date: e.date,
      linkType: 'document' as const,
      linkId: e.id,
      details: 'سند به طرف حسابی با شناسه وصل نیست (TD-778).',
    })),
    metrics: { unlinkedPartyDocuments: entries.length },
  };
}
