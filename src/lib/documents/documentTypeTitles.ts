/** نام فارسی هر نوع سند در پیام‌ها و گزارش ممیزی (پیش‌تر فقط در documents.routes.ts) */
export const DOCUMENT_TYPE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  receipt: 'رسید خرید مواد و کالا',
  production_receipt: 'رسید تولید و تحویل محصول',
  invoice: 'فاکتور فروش',
  proforma: 'پیش‌فاکتور',
  return: 'سند مرجوعی',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات',
});

export function documentTypeTitle(docType: string | null | undefined, fallback = 'سند'): string {
  return DOCUMENT_TYPE_TITLES[String(docType ?? '')] ?? fallback;
}

/**
 * v10.0.246 (TD-1208، یافته B-08): متن ثبت‌شده ردیف‌های تخصیص و آزادسازی مواد پروژه («BOM» دارد) نام فارسی می‌گیرد؛
 * متن ذخیره‌شده عوض نمی‌شود، چون سرور و آزمون‌ها ردیف‌ها را با آن پیدا می‌کنند.
 */
const KARDEX_STORED_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'تخصیص مواد BOM': 'تخصیص مواد به پروژه',
  'آزادسازی تخصیص BOM': 'آزادسازی تخصیص مواد پروژه',
});

/**
 * مرجع ردیف‌های موجودی اولیه کالا که نوع `audit` دارند: فرم ساخت کالا، فرم ویرایش کالای بی‌گردش و ثبت موجودی اولیه
 * کاردکس (`KARDEX_BACKFILL_REF`، که با «موجودی اولیه» آغاز می‌شود)
 */
const KARDEX_OPENING_REFS: ReadonlySet<string> = new Set(['ثبت اولیه کالا', 'ثبت موجودی افتتاحیه']);

export function isKardexOpeningRef(docRef: string | null | undefined): boolean {
  const ref = String(docRef ?? '').trim();
  return KARDEX_OPENING_REFS.has(ref) || ref.startsWith('موجودی اولیه');
}

export const KARDEX_OPENING_LABEL = 'موجودی افتتاحیه';

/**
 * v10.0.61 (TD-1131): نوع سند یک ردیف کاردکس برای نمایش؛ کد نوع (`remittance`، `audit`) نام فارسی‌اش را می‌گیرد،
 * متن فارسی ثبت‌شده ردیف‌های قدیمی همان‌طور می‌ماند، و کد لاتین ناشناخته «سند» خوانده می‌شود، هرگز خود کد.
 * v10.0.246 (TD-1208): ردیف موجودی اولیه کالا (`audit` با مرجع موجودی اولیه) «موجودی افتتاحیه» است، نه «سند انبارگردانی».
 */
export function kardexDocumentTypeLabel(docType: string | null | undefined, docRef?: string | null): string {
  const raw = String(docType ?? '').trim();
  if (!raw) return '';
  if (raw === 'audit' && isKardexOpeningRef(docRef)) return KARDEX_OPENING_LABEL;
  if (DOCUMENT_TYPE_TITLES[raw]) return DOCUMENT_TYPE_TITLES[raw];
  if (KARDEX_STORED_TYPE_LABELS[raw]) return KARDEX_STORED_TYPE_LABELS[raw];
  return /^[A-Za-z0-9_-]+$/.test(raw) ? 'سند' : raw;
}
