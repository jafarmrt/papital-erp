import { ForbiddenError } from '../../errors/customErrors.js';
import { can } from '../../middleware/authorize.js';

/**
 * v9.0.123 (TD-890، تصمیم ت۱۰ الف مدل مجوز): فهرست و پرونده اسناد با مجوز بخش اسناد باز است؛ صفحه انبارگردانی
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
