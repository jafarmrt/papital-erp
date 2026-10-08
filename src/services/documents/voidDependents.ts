import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, treasuryTransactions } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';

/**
 * v9.0.271 (TD-773، تصمیم ت۴ «الف» بسته ۸): سندی که وابسته زنده دارد باطل نمی‌شود و پاسخ ۴۰۹ وابسته‌ها را نام می‌برد.
 * کاربر اول برگشت را باطل می‌کند. `deleteDocument` این را پس از قفل سند و پیش از هر نوشتن صدا می‌زند؛ برگشت قطعی تازه
 * همان فاکتور را در `assertReturnWithinSold` قفل می‌کند، پس هم‌زمانش یا این‌جا دیده می‌شود یا پس از ابطال رد می‌شود، و
 * برگشت پیش‌نویسی که هم‌زمان ساخته شود با فاکتور باطل نهایی نمی‌شود (`assertReturnableInvoice`).
 *
 * پیش‌تر ابطال فاکتوری که برگشت فعال داشت پذیرفته می‌شد: برگشت به فاکتور باطل اشاره می‌کرد، کالای برگشتی دو بار به انبار
 * برمی‌گشت (رسید ۱۰، فروش ۵، برگشت ۲، ابطال: موجودی ۱۲) و مشتری بابت خریدی که دیگر نبود بستانکار می‌ماند.
 *
 * v9.0.272 (TD-779، همان تصمیم): دریافت یا پرداخت زنده خزانه که به سند وصل است هم ابطال را رد می‌کند؛ کاربر آن را در خزانه
 * «علی‌الحساب» می‌کند یا به سند دیگری وصل می‌کند (`relinkTreasuryDocument`) یا باطل می‌کند. پیش‌تر فاکتور تسویه‌شده بی
 * هشدار باطل می‌شد، دریافت به سند باطل وصل می‌ماند و فاکتور جایگزین همان مبلغ را «پرداخت‌نشده» نشان می‌داد. ثبت دریافت
 * تازه و انتقال دریافت هر دو سند را `FOR SHARE` قفل می‌کنند (`assertTreasuryDocumentLink`)، پس پس از ابطال رد می‌شوند.
 */

const STATUS_TITLES: Record<string, string> = { draft: 'پیش‌نویس', proforma: 'پیش‌فاکتور', final: 'قطعی' };

export interface VoidDependentReturn {
  id: number;
  refNumber: string | null;
  status: string | null;
}

/** برگشت‌های از فروش ابطال‌نشده این سند (هر وضعیتی)، به ترتیب ثبت */
export async function activeReturnsOf(tx: DbExecutor, documentId: number): Promise<VoidDependentReturn[]> {
  return tx
    .select({ id: documents.id, refNumber: documents.refNumber, status: documents.status })
    .from(documents)
    .where(and(eq(documents.returnOfDocumentId, documentId), eq(documents.isDeleted, 0)))
    .orderBy(asc(documents.id));
}

export async function assertVoidHasNoReturns(tx: DbExecutor, doc: { id: number; refNumber: string | null }): Promise<void> {
  const returns = await activeReturnsOf(tx, doc.id);
  if (returns.length === 0) return;
  const listed = returns
    .map(r => `«${r.refNumber || r.id}» (${STATUS_TITLES[r.status ?? ''] ?? r.status ?? '-'})`)
    .join('، ');
  throw new ConflictError(
    `سند «${doc.refNumber || doc.id}» برگشت از فروش ابطال‌نشده دارد و باطل نمی‌شود: ${listed}. اول این برگشت‌ها را باطل کنید.`,
    { returns },
    'DOCUMENT_HAS_ACTIVE_RETURNS',
  );
}

export interface VoidDependentTreasuryRow {
  id: number;
  transactionNumber: string;
  type: string;
  amount: unknown;
  currency: string | null;
}

/** دریافت‌ها و پرداخت‌های زنده خزانه که به این سند وصل‌اند: کامل، حذف‌نشده و خودشان معکوس ابطال نیستند */
export async function liveTreasuryRowsOf(tx: DbExecutor, documentId: number): Promise<VoidDependentTreasuryRow[]> {
  return tx
    .select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      type: treasuryTransactions.type,
      amount: treasuryTransactions.amount,
      currency: treasuryTransactions.currency,
    })
    .from(treasuryTransactions)
    .where(and(
      eq(treasuryTransactions.documentId, documentId),
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.status, 'completed'),
      isNull(treasuryTransactions.reversalOfId),
    ))
    .orderBy(asc(treasuryTransactions.id));
}

export async function assertVoidHasNoTreasuryRows(tx: DbExecutor, doc: { id: number; refNumber: string | null }): Promise<void> {
  const rows = await liveTreasuryRowsOf(tx, doc.id);
  if (rows.length === 0) return;
  const listed = rows
    .map(r => `«${r.transactionNumber}» (${r.type === 'payment' ? 'پرداخت' : 'دریافت'} ${formatPersianNumber(Number(r.amount) || 0, 4)} ${r.currency || 'IRR'})`)
    .join('، ');
  throw new ConflictError(
    `سند «${doc.refNumber || doc.id}» دریافت یا پرداخت خزانه دارد و باطل نمی‌شود: ${listed}. اول هر کدام را در خزانه «علی‌الحساب» کنید، به سند دیگری وصل کنید یا باطل کنید.`,
    { treasuryRows: rows.map(r => ({ ...r, amount: Number(r.amount) || 0 })) },
    'DOCUMENT_HAS_TREASURY_ROWS',
  );
}
