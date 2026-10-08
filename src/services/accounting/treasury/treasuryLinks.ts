import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { customers, documents, personnel } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';

/**
 * v9.0.83 (TD-501، B04-05): پیوند دریافت و پرداخت خزانه به طرف حساب و سند پیش از ثبت سنجیده می‌شود. پیش‌تر `partyId` و
 * `documentId` بی هیچ بررسی ذخیره می‌شدند: دریافت از مشتری الف فاکتور مشتری ب را «تسویه کامل» می‌کرد، پرداخت به
 * تأمین‌کننده با شناسه فاکتور فروش پرداخت آن فاکتور را منفی می‌کرد و شناسه‌ای که وجود نداشت سند با `detailed_id` بی‌صاحب
 * می‌ساخت.
 */

/** دریافت فقط برای سند فروش و پرداخت فقط برای سند خرید ثبت می‌شود */
export const RECEIPT_DOCUMENT_TYPES = ['invoice', 'proforma'] as const;
export const PAYMENT_DOCUMENT_TYPES = ['purchase', 'receipt'] as const;

const PARTY_LABELS: Record<string, string> = { customer: 'مشتری', supplier: 'تأمین‌کننده', personnel: 'پرسنل' };

function invalidParty(message: string): ValidationError {
  return new ValidationError(message, undefined, 'TREASURY_PARTY_INVALID');
}

/**
 * شناسه طرف حساب در جدول همان نوع: مشتری و تأمین‌کننده در `customers` با نوع خودش (یا «هر دو»)، پرسنل در `personnel`؛
 * حذف‌شده پذیرفته نیست. «متفرقه» شناسه ندارد. خروجی نام کنونی طرف حساب است (بی شناسه، `null`).
 */
export async function resolveTreasuryPartyName(
  tx: DbExecutor,
  partyType: string,
  partyId: number | null | undefined,
): Promise<string | null> {
  if (!partyId) return null;
  if (partyType === 'other') {
    throw invalidParty('طرف حساب «متفرقه» شناسه ندارد؛ برای مشتری، تأمین‌کننده یا پرسنل نوع طرف حساب را درست انتخاب کنید.');
  }
  if (partyType === 'personnel') {
    const [row] = await tx.select({ name: personnel.fullName }).from(personnel)
      .where(and(eq(personnel.id, partyId), eq(personnel.isDeleted, 0)));
    if (!row) throw invalidParty(`پرسنل شماره ${partyId} یافت نشد یا حذف شده است.`);
    return row.name;
  }
  const [row] = await tx.select({ name: customers.name, partyType: customers.partyType }).from(customers)
    .where(and(eq(customers.id, partyId), eq(customers.isDeleted, 0)));
  const kind = row ? (row.partyType || 'customer') : null;
  if (!row || (kind !== partyType && kind !== 'both')) {
    throw invalidParty(`${PARTY_LABELS[partyType] ?? 'طرف حساب'} شماره ${partyId} یافت نشد یا از این نوع نیست.`);
  }
  return row.name;
}

/**
 * v9.0.451 (TD-907، یافته P5-S-01 / P5-P06، قاعده TD-778 و TD-416): دریافت یا پرداختی که به سند وصل است و شناسه طرف حساب
 * ندارد (فرم تسویه فاکتور فقط نام خریدار سند را می‌فرستاد) شناسه طرف حساب سند و نام کنونی او را می‌گیرد. پیش‌تر ردیف ۱۲۰۱
 * یا ۳۰۰۱ سند حسابداری آن با `detailed_id` تهی و فقط نام ثبت می‌شد و پس از تغییر نام طرف حساب از کارت حساب و نگهبان حذف
 * او بیرون می‌افتاد. فقط وقتی طرف حساب ردیف همان سوی سند است (مشتری برای دریافت، تأمین‌کننده برای پرداخت)، نام فرستاده‌شده
 * نام خریدار سند یا نام کنونی طرف حساب آن است (نام بی فاصله دو سر؛ نام طرف حساب دیگر مانند پیش با
 * `TREASURY_DOCUMENT_PARTY_MISMATCH` رد می‌شود، نه آنکه به طرف سند نوشته شود) و رکورد طرف حساب سند حذف نشده و از همان نوع
 * (یا «هر دو») است؛ وگرنه `null` و همان قاعده نام پیشین (سند بی طرف حساب، TD-417). سند `FOR SHARE` خوانده می‌شود، مانند
 * `assertTreasuryDocumentLink`؛ فراخواننده پیش‌تر حساب بانکی را قفل کرده است.
 */
export async function documentPartyOfTreasuryLink(tx: DbExecutor, link: {
  type: 'receipt' | 'payment';
  documentId: number;
  partyType: string;
  partyName: string;
}): Promise<{ id: number; name: string } | null> {
  const expectedParty = link.type === 'receipt' ? 'customer' : 'supplier';
  if (link.partyType !== expectedParty) return null;
  const [doc] = await tx.select({ partyId: documents.partyId, buyerName: documents.buyerName }).from(documents)
    .where(and(eq(documents.id, link.documentId), eq(documents.isDeleted, 0)))
    .for('share');
  if (!doc?.partyId) return null;
  const [party] = await tx.select({ id: customers.id, name: customers.name, partyType: customers.partyType }).from(customers)
    .where(and(eq(customers.id, doc.partyId), eq(customers.isDeleted, 0)));
  const kind = party ? (party.partyType || 'customer') : null;
  if (!party || (kind !== link.partyType && kind !== 'both')) return null;
  const sentName = (link.partyName ?? '').trim();
  if (sentName !== (doc.buyerName ?? '').trim() && sentName !== party.name.trim()) return null;
  return { id: party.id, name: party.name };
}

/**
 * سند پیوسته فعال است (باطل‌نشده)، دریافت به سند فروش و پرداخت به سند خرید است، طرف حساب مشتری یا تأمین‌کننده همان سوی
 * سند است، ارز سند همان ارز ردیف است (v9.0.452، TD-908: پیش‌تر فقط «وصل دوباره» آن را می‌سنجید و ثبت، ردیف ریالی را به سند
 * ارزی وصل می‌کرد و جمع تسویه دو ارز را خام جمع می‌زد) و طرف حساب سند همان است: شناسه طرف حساب سند (v9.0.336، TD-778)، و در سند پیشین بی شناسه نام خریدار برابر نام طرف
 * حساب (قاعده TD-417: نام بی فاصله دو سر). سند `FOR SHARE` قفل می‌شود تا تا
 * پایان ثبت باطل نشود؛ فراخواننده پیش‌تر حساب بانکی را قفل کرده است (سطح ۱۰ پیش از سطح ۶۰).
 */
export async function assertTreasuryDocumentLink(tx: DbExecutor, link: {
  type: 'receipt' | 'payment';
  documentId: number;
  partyType: string;
  /** v9.0.336 (TD-778): شناسه طرف حساب دریافت یا پرداخت؛ سند دارای طرف حساب فقط با همان شناسه وصل می‌شود */
  partyId?: number | null;
  partyName: string;
  /** v9.0.452 (TD-908): ارز ردیف خزانه؛ جمع تسویه سند فقط ردیف‌های ارز خودش را معنادار می‌شمارد */
  currency: string | null | undefined;
}): Promise<void> {
  const [doc] = await tx.select({
    refNumber: documents.refNumber, type: documents.type, buyerName: documents.buyerName, partyId: documents.partyId, currency: documents.currency,
  })
    .from(documents)
    .where(and(eq(documents.id, link.documentId), eq(documents.isDeleted, 0)))
    .for('share');
  if (!doc) {
    throw new ValidationError(`سند شماره ${link.documentId} یافت نشد یا باطل شده است؛ دریافت و پرداخت فقط به سند فعال وصل می‌شود.`, undefined, 'TREASURY_DOCUMENT_INVALID');
  }
  const isReceipt = link.type === 'receipt';
  const allowed: readonly string[] = isReceipt ? RECEIPT_DOCUMENT_TYPES : PAYMENT_DOCUMENT_TYPES;
  if (!allowed.includes(doc.type)) {
    throw new ValidationError(
      isReceipt
        ? `سند «${doc.refNumber}» فاکتور یا پیش‌فاکتور فروش نیست؛ دریافت فقط به سند فروش وصل می‌شود.`
        : `سند «${doc.refNumber}» سند خرید نیست؛ پرداخت فقط به سند خرید وصل می‌شود.`,
      undefined,
      'TREASURY_DOCUMENT_INVALID',
    );
  }
  const expectedParty = isReceipt ? 'customer' : 'supplier';
  if (link.partyType !== expectedParty) {
    throw new ValidationError(
      `طرف حساب ${isReceipt ? 'دریافت فاکتور فروش باید مشتری' : 'پرداخت سند خرید باید تأمین‌کننده'} باشد.`,
      undefined,
      'TREASURY_DOCUMENT_PARTY_MISMATCH',
    );
  }
  const documentCurrency = (doc.currency || 'IRR').toUpperCase();
  const rowCurrency = (link.currency || 'IRR').toUpperCase();
  if (documentCurrency !== rowCurrency) {
    throw new ValidationError(
      `ارز سند «${doc.refNumber}» (${documentCurrency}) با ارز تراکنش (${rowCurrency}) یکی نیست.`,
      undefined,
      'TREASURY_DOCUMENT_CURRENCY_MISMATCH',
    );
  }
  // v9.0.336 (TD-778، تصمیم ت۶ الف): دریافت یا پرداخت با شناسه طرف حساب به سند دارای شناسه فقط با همان شناسه وصل می‌شود و
  // نام سند فقط نمایش است. سند پیشین بی شناسه، یا ثبت بی شناسه طرف حساب (فرم تسویه فاکتور نام خود سند را می‌فرستد)، با قاعده
  // نام (TD-417)
  if (doc.partyId !== null && doc.partyId !== undefined && link.partyId) {
    if (Number(link.partyId) !== Number(doc.partyId)) {
      throw new ValidationError(
        `طرف حساب «${link.partyName.trim()}» با طرف سند «${doc.refNumber}» («${(doc.buyerName ?? '').trim()}») یکی نیست.`,
        undefined,
        'TREASURY_DOCUMENT_PARTY_MISMATCH',
      );
    }
    return;
  }
  if ((doc.buyerName ?? '').trim() !== link.partyName.trim()) {
    throw new ValidationError(
      `طرف حساب «${link.partyName.trim()}» با طرف سند «${doc.refNumber}» («${(doc.buyerName ?? '').trim()}») یکی نیست.`,
      undefined,
      'TREASURY_DOCUMENT_PARTY_MISMATCH',
    );
  }
}
