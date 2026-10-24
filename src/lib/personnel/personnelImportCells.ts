/**
 * v9.0.25 (TD-436، تصمیم مالک محصول D3 الف): خانه‌های جنسیت، وضعیت همکاری و ملیت ورود اکسل پرسنل، مشترک سرور و
 * پیش‌نمایش. خانه خالی undefined است: پرسنل موجود مقدار خود را نگه می‌دارد و پرسنل تازه پیش‌فرض («مرد»، «فعال»،
 * «ایرانی») را می‌گیرد. پیش‌تر خانه خالی پیش از ارسال و در سرور به پیش‌فرض می‌رفت و روی پرسنل موجود نوشته می‌شد.
 */
export type PersonnelGender = 'مرد' | 'زن';
export type EmploymentStatus = 'فعال' | 'قطع همکاری' | 'مرخصی' | 'تعلیق';

export const PERSONNEL_IMPORT_DEFAULTS = { gender: 'مرد', employmentStatus: 'فعال', nationality: 'ایرانی' } as const;

const cellText = (raw: unknown) => String(raw ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();

export function parseGenderCell(raw: unknown): PersonnelGender | undefined {
  const text = cellText(raw).toLowerCase();
  if (!text) return undefined;
  return text === 'زن' || text === 'female' || text === 'f' ? 'زن' : 'مرد';
}

export function parseEmploymentStatusCell(raw: unknown): EmploymentStatus | undefined {
  const text = cellText(raw);
  if (!text) return undefined;
  if (text.includes('قطع') || text.includes('اخراج') || text.includes('استعفا')) return 'قطع همکاری';
  if (text.includes('مرخص')) return 'مرخصی';
  if (text.includes('تعلیق')) return 'تعلیق';
  return 'فعال';
}

export function parseNationalityCell(raw: unknown): string | undefined {
  return cellText(raw) || undefined;
}

/** برچسب پیش‌نمایش: خانه خالی روی پرسنل موجود «بدون تغییر» است و روی پرسنل تازه همان پیش‌فرض */
export function personnelCellLabel(value: string | undefined, isExistingMatch: boolean, fallback: string): string {
  if (value) return value;
  return isExistingMatch ? 'بدون تغییر' : fallback;
}

/**
 * 10.3 package 6 (TD-1386): the columns of the personnel export (OBS-R2-57) that the import does not read: the end of
 * service, the salary and the insurance, payroll tax and eidi flags. They change only in each person's file, so a
 * re-imported export (or a sheet edited by hand) changes none of them; the preview names the ones the file holds.
 */
export const PERSONNEL_UNREAD_IMPORT_COLUMNS = [
  'تاریخ پایان همکاری', 'علت قطع همکاری', 'نوع حقوق', 'حقوق ماهانه', 'مشمول بیمه', 'مشمول مالیات حقوق', 'مشمول عیدی',
] as const;

const headerKey = (header: unknown) => cellText(header).replace(/[\s‌_\-–—:()[\]]/g, '');

/** The unread columns (`PERSONNEL_UNREAD_IMPORT_COLUMNS`) among a sheet's headers, in the export's order */
export function unreadPersonnelColumns(headers: readonly unknown[]): string[] {
  const held = new Set(headers.map(headerKey));
  return PERSONNEL_UNREAD_IMPORT_COLUMNS.filter(column => held.has(headerKey(column)));
}

/** The preview's notice for the unread columns of a file, or null when it holds none */
export function unreadPersonnelColumnsNotice(columns: readonly string[]): string | null {
  if (columns.length === 0) return null;
  return `ستون‌های ${columns.map(c => `«${c}»`).join('، ')} در ورود اکسل خوانده نمی‌شوند و با این فایل چیزی در آن‌ها تغییر نمی‌کند؛ این موارد را در پرونده هر نفر ویرایش کنید.`;
}
