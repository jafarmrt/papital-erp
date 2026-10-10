import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.0.82 (TD-1139): what the item Excel import tells the user after the server answers. A row error is never reported as
 * a plain success: some rows saved and some refused is a warning with the refused count, and nothing saved is an error.
 */
export interface ItemImportCounts {
  createdCount: number;
  updatedCount: number;
  pricesCount: number;
  errors: ReadonlyArray<unknown>;
}

export type ItemImportTone = 'success' | 'warning' | 'error';

export function itemImportOutcome(result: ItemImportCounts): { tone: ItemImportTone; message: string } {
  const refused = Array.isArray(result.errors) ? result.errors.length : 0;
  if (refused === 0) return { tone: 'success', message: 'ورود داده‌های اکسل با موفقیت انجام شد.' };
  const saved = (result.createdCount || 0) + (result.updatedCount || 0) + (result.pricesCount || 0);
  const rows = formatPersianNumber(refused);
  if (saved === 0) return { tone: 'error', message: `هیچ تغییری ثبت نشد؛ ${rows} ردیف خطا داشت. فهرست خطاها را ببینید و فایل را اصلاح کنید.` };
  return { tone: 'warning', message: `ورود اکسل انجام شد، اما ${rows} ردیف خطا داشت و ثبت نشد. فهرست خطاها را ببینید.` };
}
