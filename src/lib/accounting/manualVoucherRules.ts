/**
 * v9.0.144 (TD-559، یافته B03-17): قاعده‌های سند دستی، مشترک سرور و فرم سند.
 *
 * سند اختتامیه را فقط بستن سال مالی صادر می‌کند و به سال بسته پیوند دارد (`source_fiscal_year`، TD-545). پیش‌تر فرم سند
 * گزینه «افتتاحیه / اختتامیه» را با نوع `closing` ذخیره می‌کرد و هر شماره مرجعی از بدنه پذیرفته می‌شد: مانده‌های افتتاحیه
 * دستی دیگر نه معکوس می‌شدند نه اصلاح، و مرجع دستی «CLOSING-1400» بستن سال ۱۴۰۰ را با پیام «قبلاً بسته شده است» می‌بست.
 * اکنون سند دستی نوع اختتامیه ندارد (مانده‌های اول دوره نوع «افتتاحیه» را می‌گیرند) و مرجع‌های رزروشده سامانه را نمی‌پذیرد.
 */

/** پیشوند مرجع‌هایی که سامانه خودش می‌سازد: بستن سال، افتتاحیه، سند برگشت، اصلاح و بازثبت */
export const RESERVED_VOUCHER_REFERENCE_PREFIXES = [
  'CLOSE-TEMP-', 'CLOSE-PROFIT-', 'CLOSING-', 'OPENING-',
  'REV-V', 'RE-REV-V', 'VOID-REPOST-V', 'CORR-V', 'REPOST-V',
] as const;

/** مرجع رزروشده سامانه، بی توجه به بزرگی و کوچکی حروف و فاصله آغاز */
export function isReservedVoucherReference(reference: string | null | undefined): boolean {
  const ref = String(reference ?? '').trim().toUpperCase();
  return ref !== '' && RESERVED_VOUCHER_REFERENCE_PREFIXES.some(prefix => ref.startsWith(prefix));
}

export const MANUAL_CLOSING_TYPE_MESSAGE =
  'سند اختتامیه فقط با «بستن سال مالی» صادر می‌شود؛ برای مانده‌های اول دوره نوع «افتتاحیه» را برگزینید.';

export const RESERVED_REFERENCE_MESSAGE =
  'شماره مرجع سند با پیشوندهای رزروشده سامانه (بستن سال، افتتاحیه، برگشت، اصلاح و بازثبت) آغاز می‌شود؛ مرجع دیگری بنویسید.';

/** نوع سندی که فرم سند دستی نشان می‌دهد؛ سند دستی قدیمی از نوع اختتامیه در ویرایش «افتتاحیه» نشان داده می‌شود */
export function manualVoucherFormType(voucherType: string | null | undefined): string {
  if (!voucherType) return 'general';
  return voucherType === 'closing' ? 'opening' : voucherType;
}
