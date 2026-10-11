/**
 * v10.0.239 (TD-1205، یافته B-04): برچسب‌های صفحه «ورود و خروج انبار» برای سند ورودی از روی نوع آن. برگشت از فروش
 * مشتری و قیمت فروش دارد، نه تأمین‌کننده و قیمت خرید؛ رسید و خرید همان برچسب‌های رسید خرید را نگه می‌دارند.
 */
export interface StockInLabels {
  party: string;
  unitPrice: string;
  summaryTitle: string;
  totalLabel: string;
  submit: string;
  attachmentsTitle: string;
  emptyHint: string;
}

const PURCHASE_LABELS: StockInLabels = Object.freeze({
  party: 'تامین‌کننده / فروشنده کالا',
  unitPrice: 'قیمت خرید واحد (فی)',
  summaryTitle: 'خلاصه رسید خرید مواد اولیه و کالا',
  totalLabel: 'مجموع کل ارزش فاکتور خرید:',
  submit: 'ثبت نهایی و صدور سند رسید خرید',
  attachmentsTitle: 'الصاق تصویر فاکتور خرید، پیش‌فاکتور و بارنامه',
  emptyHint: 'کالاهای مورد نظر را از کادر بالا جستجو کرده، تعداد و قیمت خرید را وارد نموده و دکمه افزودن را فشار دهید.',
});

const RETURN_LABELS: StockInLabels = Object.freeze({
  party: 'مشتری برگشت‌دهنده کالا',
  unitPrice: 'قیمت فروش واحد (فی)',
  summaryTitle: 'خلاصه برگشت از فروش',
  totalLabel: 'مجموع کل ارزش کالای برگشتی:',
  submit: 'ثبت نهایی و صدور سند برگشت از فروش',
  attachmentsTitle: 'الصاق تصویر فاکتور فروش، نامه یا رسید تحویل کالای برگشتی',
  emptyHint: 'کالاهای برگشتی را از کادر بالا جستجو کرده، تعداد آن را وارد نموده و دکمه افزودن را فشار دهید.',
});

/** برچسب‌های سند ورودی؛ هر نوع جز برگشت از فروش (`return`) برچسب رسید خرید می‌گیرد */
export function stockInLabels(docType: string | null | undefined): StockInLabels {
  return docType === 'return' ? RETURN_LABELS : PURCHASE_LABELS;
}

/**
 * v10.0.240 (TD-1206، یافته B-06): سند حسابداری سند انبار پیش‌نویس است تا دارنده مجوز «تأیید و قطعی کردن سند حسابداری»
 * (`accounting.vouchers_approve`) آن را تأیید کند؛ نام نقش نمی‌آید، چون نقش‌ها ویرایش‌پذیرند.
 */
export const STOCK_VOUCHER_DRAFT_NOTE = 'سند حسابداری پیش‌نویس می‌ماند تا دارنده مجوز «تأیید و قطعی کردن سند حسابداری» آن را تأیید کند.';
