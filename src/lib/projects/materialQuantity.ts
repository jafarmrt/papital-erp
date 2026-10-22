import { fin } from '../financialDecimal.js';

/**
 * TD-1343 (بستهٔ ۱۲ بند ۲، گزینهٔ الف کارت ت۴۲): ردیف مادهٔ بخش «کد به کد» مقدار را برای یک عدد محصول نگه می‌دارد
 * (`qtyPerUnit`) و نیاز کل آن (مقدار × تعداد سفارش محصول) هر بار از تعداد سفارش امروز حساب می‌شود، پس با تغییر تعداد سفارش
 * خودش عوض می‌شود. ردیفی که `qtyPerUnit` ندارد (پروژه‌های پیشین) عدد کل خود را در `requiredQty` نگه می‌دارد و با نشان «کل» دیده
 * می‌شود؛ هیچ دادهٔ قدیمی خودبه‌خود عوض نمی‌شود. بخش «کلی سفارش» همان عدد کل است. مشترک میان کارساز (ثبت نهایی و تکمیل رزرو)
 * و زبانهٔ مواد، تا هر دو یک نیاز ببینند.
 */

/** رقم‌های اعشار مقدار «برای هر عدد» و نیاز کلی که از آن ساخته می‌شود؛ همان دقت مقدارهای انبار */
export const MATERIAL_QTY_PLACES = 4;

/** مقدار «برای هر عدد» ردیف تازه */
export const NEW_ROW_QTY_PER_UNIT = 1;

type QtyRow = { qtyPerUnit?: unknown; requiredQty?: unknown } | null | undefined;

/** ردیف «برای هر عدد» است: `qtyPerUnit` عددی نامنفی دارد */
export function isPerUnitRow(row: QtyRow): boolean {
  const v = row?.qtyPerUnit;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** تعداد سفارش یک محصول پروژه، همان که زبانهٔ مواد نشان می‌دهد؛ مقدار نامعتبر یا صفر یک است */
export function productOrderQuantity(product: { quantity?: unknown } | null | undefined): number {
  const q = Number(product?.quantity);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

/** نیاز کل یک ردیف کد به کد: «برای هر عدد» × تعداد سفارش، وگرنه عدد کل ذخیره‌شده (خالی یک، مانند پیش) */
export function perItemRowRequiredQty(row: QtyRow, orderQty: number): number {
  if (isPerUnitRow(row)) return fin(row?.qtyPerUnit as number).multiply(orderQty).round(MATERIAL_QTY_PLACES).toNumber();
  return Number(row?.requiredQty !== undefined ? row.requiredQty : 1);
}

/** فیلدهای ردیف «برای هر عدد»: مقدار یک عدد و نیاز کل امروز (`requiredQty` فقط برای خوانندهٔ قدیمی نوشته می‌شود) */
export function perUnitRowFields(qtyPerUnit: number, orderQty: number): { qtyPerUnit: number; requiredQty: number } {
  const perUnit = Number.isFinite(qtyPerUnit) && qtyPerUnit >= 0 ? qtyPerUnit : 0;
  return { qtyPerUnit: perUnit, requiredQty: perItemRowRequiredQty({ qtyPerUnit: perUnit }, orderQty) };
}

/** مقدار «برای هر عدد» پیشنهادی وقتی ردیف «کل» برگردانده می‌شود: عدد کل ÷ تعداد سفارش، با چهار رقم اعشار */
export function perUnitQtyFromTotal(total: unknown, orderQty: number): number {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return fin(t).divide(orderQty > 0 ? orderQty : 1, MATERIAL_QTY_PLACES).toNumber();
}

/**
 * مقدار تبدیل‌شدهٔ نمایشی ردیف «برای هر عدد» از نیاز کل امروز و ضریب تبدیل (نیاز ÷ ضریب، یک رقم اعشار، همان قاعدهٔ فرم تبدیل)؛
 * ردیف «کل» همان مقدار ذخیره‌شده را نگه می‌دارد
 */
export function rowConvertedQty(row: QtyRow & { conversionRate?: unknown; convertedQty?: unknown }, total: number): number | undefined {
  const stored = Number(row?.convertedQty);
  const storedQty = Number.isFinite(stored) && stored > 0 ? stored : undefined;
  if (!isPerUnitRow(row)) return storedQty;
  const rate = Number(row?.conversionRate);
  if (!(Number.isFinite(rate) && rate > 0) || storedQty === undefined) return storedQty;
  return Math.round((total / rate + Number.EPSILON) * 10) / 10;
}
