/**
 * نسخه رکورد پروژه تولید برای قفل خوش‌بینانه ویرایش، مشترک میان سرور و مرورگر.
 *
 * v9.0.385 (TD-742، تصمیم ت۳ الف): `PUT /projects/:id` نسخه‌ای را که فرم یا زبانه از آن ساخته شده می‌فرستد (بی آن ۴۰۰) و
 * ناهمخوانی ۴۰۹ `OCC_CONFLICT` است، مثل طرف حساب (TD-403). پیش‌تر ستون `version` بود اما ویرایش پروژه نه آن را می‌سنجید و
 * نه بالا می‌برد: دو کاربر که یک پروژه را باز کرده بودند (یکی محصولات، دیگری برنامه کارگاه) ذخیره اولی را با ذخیره دومی بی‌صدا
 * از دست می‌دادند.
 */

export const PROJECT_VERSION_CONFLICT_MESSAGE = 'پروژه را کاربر دیگری تغییر داده؛ دوباره باز کنید.';
export const PROJECT_VERSION_REQUIRED_MESSAGE = 'نسخه رکورد پروژه ارسال نشده است؛ پروژه را دوباره باز کنید و ویرایش کنید.';

/** نسخه معتبر (عدد صحیح مثبت) یا `undefined` */
export function projectVersionOf(value: unknown): number | undefined {
  const version = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : undefined;
}

/** تازه‌ترین نسخه از میان نسخه‌های شناخته‌شده؛ نسخه پروژه فقط بالا می‌رود */
export function latestProjectVersion(...values: unknown[]): number | undefined {
  return values.map(projectVersionOf).reduce<number | undefined>(
    (latest, version) => version !== undefined && (latest === undefined || version > latest) ? version : latest,
    undefined
  );
}
