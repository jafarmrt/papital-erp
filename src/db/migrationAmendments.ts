/**
 * v8.0.89 (TD-368): مهاجرت‌هایی که پس از انتشار عوض شده‌اند. یک فایل مهاجرت فقط وقتی پس از انتشار عوض می‌شود که
 * ارتقای پایگاه‌داده‌ای را که هنوز اجرایش نکرده متوقف کند؛ پایگاه‌داده‌ای که متن قبلی را اجرا کرده نتیجه همان را
 * دارد و چیزی دوباره اجرا نمی‌شود. درهم‌سازی (sha256) متن‌های قبلی اینجا ثبت می‌شود تا برنامه‌ریز مهاجرت
 * (`planMigrations`) آن را «فایل اجراشده‌ای که بعداً عوض شده» گزارش نکند.
 */
/**
 * v11 (phase 4.1): the series-10 amendments (TD-368, TD-590, TD-610 and the others) went with their migrations into
 * `drizzle/0000_v11_baseline.sql`; their earlier hashes are kept in `src/db/v10MigrationHistory.ts`, so a database that
 * ran an earlier text gets no warning. A migration amended from now on is listed here.
 */
export const AMENDED_MIGRATIONS: Readonly<Record<string, { previousHashes: readonly string[]; reason: string }>> = {};

export function previousMigrationHashes(): Map<string, readonly string[]> {
  return new Map(Object.entries(AMENDED_MIGRATIONS).map(([tag, a]) => [tag, a.previousHashes]));
}
