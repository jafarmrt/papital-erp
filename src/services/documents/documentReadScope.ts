import { ForbiddenError } from '../../errors/customErrors.js';
import { can } from '../../middleware/authorize.js';
import { READ_PERMISSIONS } from '../../lib/recordReadPermissions.js';

/**
 * v9.0.140 (TD-890، تصمیم ت۱۰ الف مدل مجوز): فهرست و پرونده اسناد با مجوز بخش اسناد باز است؛ صفحه انبارگردانی
 * (`audit.view`، `READ_PERMISSIONS.stockCountDocuments`) فقط سندهای شمارش و انتقال خودش را می‌خواند، نه فاکتور و رسید و
 * حواله. پیش‌تر مجوز انبارگردانی، انبار و ارتباط با مشتری کل فهرست اسناد را با مبالغ باز می‌کرد.
 */
export const STOCK_COUNT_PAGE_DOCUMENT_TYPES: readonly string[] = ['audit', 'transfer'];

/** null یعنی همه نوع‌ها؛ وگرنه فقط نوع‌های صفحه انبارگردانی */
export async function readableDocumentTypes(
  user: { role?: string } | undefined,
  sectionKeys: readonly string[],
): Promise<readonly string[] | null> {
  return await can(user, ...sectionKeys) ? null : STOCK_COUNT_PAGE_DOCUMENT_TYPES;
}

export function assertDocumentTypeReadable(types: readonly string[] | null, type: string | null | undefined): void {
  if (types === null || (type && types.includes(type))) return;
  throw new ForbiddenError(
    'دیدن این سند مجوز بخش اسناد را می‌خواهد؛ مجوز انبارگردانی فقط سندهای شمارش و انتقال را نشان می‌دهد.',
    undefined,
    'DOCUMENT_TYPE_NOT_READABLE',
  );
}

/**
 * v9.0.335 (TD-781، تصمیم ت۸ الف بسته ۸): ردیف‌های خزانهٔ سند (شماره تراکنش، روش، شماره پیگیری، حساب بانکی، شرح) فقط به
 * خوانندگان خزانه (`READ_PERMISSIONS.treasuryTransactions`) داده می‌شود؛ دیگر خوانندگان سند فقط مبلغ پرداخت‌شده، مانده و
 * وضعیت تسویه را می‌گیرند. پیش‌تر انباردار و هر خواننده دیگر سند جزئیات دریافت‌ها را می‌دید.
 */
export async function documentForReader<T extends { settlements?: unknown }>(user: { role?: string } | undefined, doc: T): Promise<T> {
  return await can(user, ...READ_PERMISSIONS.treasuryTransactions) ? doc : { ...doc, settlements: undefined };
}
