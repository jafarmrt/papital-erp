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
