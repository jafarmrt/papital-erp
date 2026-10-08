/**
 * v9.0.350 (TD-820، یافته B07-04): ضریب تبدیل واحد ردیف کنترل موجودی پروژه وقتی کاربر مقدار تبدیل‌شده را مستقیم وارد می‌کند.
 * ضریب (هر واحد کالا چند واحد ردیف) گرد نمی‌شود، چون سرور نیاز را با همین ضریب به واحد کالا می‌برد: ۲ کیلوگرم = ۲٬۰۰۰ گرم
 * ضریب ۰٫۰۰۱ است و گرد کردن به یک رقم اعشار آن را صفر می‌کرد.
 */
export function directConversionRate(originalQty: number, convertedQty: number): number {
  const original = Number(originalQty);
  const converted = Number(convertedQty);
  return Number.isFinite(original) && Number.isFinite(converted) && original > 0 && converted > 0 ? original / converted : 1;
}
