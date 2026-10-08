/**
 * v8.0.89 (TD-368): مهاجرت‌هایی که پس از انتشار عوض شده‌اند. یک فایل مهاجرت فقط وقتی پس از انتشار عوض می‌شود که
 * ارتقای پایگاه‌داده‌ای را که هنوز اجرایش نکرده متوقف کند؛ پایگاه‌داده‌ای که متن قبلی را اجرا کرده نتیجه همان را
 * دارد و چیزی دوباره اجرا نمی‌شود. درهم‌سازی (sha256) متن‌های قبلی اینجا ثبت می‌شود تا برنامه‌ریز مهاجرت
 * (`planMigrations`) آن را «فایل اجراشده‌ای که بعداً عوض شده» گزارش نکند.
 */
/**
 * v9.0.394 (TD-590): a migration that drops a schema object by an unqualified name with IF EXISTS looked it up along the
 * search path; inside an isolated test schema (search path test schema, public) a name missing there dropped the object
 * of the same name in `public`. These files now name the current schema; on a database whose only ERP schema is `public`
 * the result is the same.
 */
const TD_590_REASON = 'v9.0.394 (TD-590): DROP ... IF EXISTS names the current schema; the unqualified name reached public through the search path when an isolated test schema was built';

export const AMENDED_MIGRATIONS: Readonly<Record<string, { previousHashes: readonly string[]; reason: string }>> = {
  '0047_journal_voucher_source_cheque': {
    previousHashes: ['c42fe3c94d363257ccb0be77cea30837ff3caf9a1d7b543fea943bb639ef4a60'],
    reason: 'v8.0.89 (TD-368): backfill of vouchers refused by 0044 failed on their NOT VALID date constraint and blocked the upgrade from v7.0.137',
  },
  '0007_idempotency_triple_key': {
    previousHashes: ['fd670f13a12ae631b485ca8de2a5f76a5de22faee7e9e669f527da4834754316'],
    reason: TD_590_REASON,
  },
  '0008_drop_changelogs': {
    previousHashes: ['e5be767ff379e3b0614e8f3ca5f0a64e62dd62ca4eaba8821042fd675c613f97'],
    reason: TD_590_REASON,
  },
  '0011_repair_jalali_timestamps': {
    previousHashes: ['701fad564b116c1cd2ce506e4b4603dbb6980644ec6491983387b69accd771ec'],
    reason: TD_590_REASON,
  },
  '0015_documents_ref_fiscal_year_unique': {
    previousHashes: ['260e3e8a442698bddd5608820ba2ea5cd0d3986ae806d183b3a1e4aba2c4b72d'],
    reason: TD_590_REASON,
  },
  '0021_drop_items_stocks_jsonb': {
    previousHashes: ['13c40e67da0e5462188db16cee2802059442af453c3414e2ea39fc59a05ae128'],
    reason: TD_590_REASON,
  },
  '0081_document_check_constraints': {
    previousHashes: ['5044f7e6b7cab66c31f41ee067ddbf1d71f1756337a4d37c9f08eaaf0653a5a5'],
    reason: TD_590_REASON,
  },
};

export function previousMigrationHashes(): Map<string, readonly string[]> {
  return new Map(Object.entries(AMENDED_MIGRATIONS).map(([tag, a]) => [tag, a.previousHashes]));
}
