/**
 * v9.0.336 (TD-778، تصمیم ت۶ الف بسته ۸): فرم فاکتور فروش و صفحه سند انبار طرف حساب انتخاب‌شده از انتخابگر را با شناسه
 * (`partyId`) می‌فرستند؛ سرور سند حسابداری، پرونده مشتری، پیوند خزانه و نگهبان حذف را با آن می‌سازد و نام خریدار فقط
 * نمایش است. بی انتخاب `undefined` فرستاده می‌شود (سرور طرف حساب یکتای هم‌نام را می‌یابد).
 */
export function selectedPartyId(value: string | number | null | undefined): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}
