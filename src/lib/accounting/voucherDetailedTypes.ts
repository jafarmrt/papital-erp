/**
 * v9.0.172 (TD-569، B03-27): نوع تفصیلی ردیف سند حسابداری، مشترک طرح Zod سرور و فرم‌های سند دستی و اصلاحی.
 * پیش‌تر فرم‌ها «متفرقه» و «سایر» را با مقدار `custom` می‌فرستادند که سرور ۴۰۰ می‌داد، پروژه و حساب بانکی پیشنهاد نمی‌شد و
 * فرم سند اصلاحی تأمین‌کننده نداشت.
 */

export const VOUCHER_DETAILED_TYPES = ['none', 'customer', 'supplier', 'personnel', 'project', 'bank_account', 'other'] as const;
export type VoucherDetailedType = typeof VOUCHER_DETAILED_TYPES[number];

export const VOUCHER_DETAILED_TYPE_LABELS: Record<VoucherDetailedType, string> = {
  none: 'بدون تفصیلی',
  customer: 'مشتری',
  supplier: 'تأمین‌کننده',
  personnel: 'پرسنل',
  project: 'پروژه',
  bank_account: 'حساب بانکی و صندوق',
  other: 'متفرقه',
};

export function isVoucherDetailedType(value: unknown): value is VoucherDetailedType {
  return typeof value === 'string' && (VOUCHER_DETAILED_TYPES as readonly string[]).includes(value);
}

/** نوع تفصیلی ذخیره‌شده یا پیش‌نویس در فرم: `custom` قدیمی و نوع ناشناخته «متفرقه» است، خالی «بدون تفصیلی» */
export function voucherDetailedTypeFromStored(value: unknown): VoucherDetailedType {
  if (value === null || value === undefined || value === '') return 'none';
  return isVoucherDetailedType(value) ? value : 'other';
}

/** برچسب پروژه در ردیف سند (همان برچسب سند تخصیص مواد اولیه) */
export function voucherProjectLabel(project: { title?: string | null; projectCode?: string | null; project_code?: string | null }): string {
  const code = project.projectCode || project.project_code || '';
  const title = project.title || '';
  return code ? `${title} (${code})`.trim() : title;
}

/** نام پرسنل در ردیف سند */
export function voucherPersonnelName(person: { fullName?: string | null; firstName?: string | null; lastName?: string | null; username?: string | null }): string {
  return person.fullName || `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.username || '';
}
