/**
 * v8.0.89 (TD-368): مهاجرت‌هایی که پس از انتشار عوض شده‌اند. یک فایل مهاجرت فقط وقتی پس از انتشار عوض می‌شود که
 * ارتقای پایگاه‌داده‌ای را که هنوز اجرایش نکرده متوقف کند؛ پایگاه‌داده‌ای که متن قبلی را اجرا کرده نتیجه همان را
 * دارد و چیزی دوباره اجرا نمی‌شود. درهم‌سازی (sha256) متن‌های قبلی اینجا ثبت می‌شود تا برنامه‌ریز مهاجرت
 * (`planMigrations`) آن را «فایل اجراشده‌ای که بعداً عوض شده» گزارش نکند.
 */
export const AMENDED_MIGRATIONS: Readonly<Record<string, { previousHashes: readonly string[]; reason: string }>> = {
  '0047_journal_voucher_source_cheque': {
    previousHashes: ['c42fe3c94d363257ccb0be77cea30837ff3caf9a1d7b543fea943bb639ef4a60'],
    reason: 'v8.0.89 (TD-368): backfill of vouchers refused by 0044 failed on their NOT VALID date constraint and blocked the upgrade from v7.0.137',
  },
};

export function previousMigrationHashes(): Map<string, readonly string[]> {
  return new Map(Object.entries(AMENDED_MIGRATIONS).map(([tag, a]) => [tag, a.previousHashes]));
}
