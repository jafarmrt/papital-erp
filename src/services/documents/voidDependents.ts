import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';

/**
 * v9.0.244 (TD-773، تصمیم ت۴ «الف» بسته ۸): سندی که وابسته زنده دارد باطل نمی‌شود و پاسخ ۴۰۹ وابسته‌ها را نام می‌برد.
 * کاربر اول برگشت را باطل می‌کند. `deleteDocument` این را پس از قفل سند و پیش از هر نوشتن صدا می‌زند؛ برگشت قطعی تازه
 * همان فاکتور را در `assertReturnWithinSold` قفل می‌کند، پس هم‌زمانش یا این‌جا دیده می‌شود یا پس از ابطال رد می‌شود، و
 * برگشت پیش‌نویسی که هم‌زمان ساخته شود با فاکتور باطل نهایی نمی‌شود (`assertReturnableInvoice`).
 *
 * پیش‌تر ابطال فاکتوری که برگشت فعال داشت پذیرفته می‌شد: برگشت به فاکتور باطل اشاره می‌کرد، کالای برگشتی دو بار به انبار
 * برمی‌گشت (رسید ۱۰، فروش ۵، برگشت ۲، ابطال: موجودی ۱۲) و مشتری بابت خریدی که دیگر نبود بستانکار می‌ماند.
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
