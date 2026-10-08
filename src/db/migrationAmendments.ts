/**
 * v8.0.89 (TD-368): مهاجرت‌هایی که پس از انتشار عوض شده‌اند. یک فایل مهاجرت فقط وقتی پس از انتشار عوض می‌شود که
 * ارتقای پایگاه‌داده‌ای را که هنوز اجرایش نکرده متوقف کند؛ پایگاه‌داده‌ای که متن قبلی را اجرا کرده نتیجه همان را
 * دارد و چیزی دوباره اجرا نمی‌شود. درهم‌سازی (sha256) متن‌های قبلی اینجا ثبت می‌شود تا برنامه‌ریز مهاجرت
 * (`planMigrations`) آن را «فایل اجراشده‌ای که بعداً عوض شده» گزارش نکند.
 */
/**
 * v9.0.425 (TD-590): a migration that drops a schema object by an unqualified name with IF EXISTS looked it up along the
 * search path; inside an isolated test schema (search path test schema, public) a name missing there dropped the object
 * of the same name in `public`. These files now name the current schema; on a database whose only ERP schema is `public`
 * the result is the same.
 */
const TD_590_REASON = 'v9.0.425 (TD-590): DROP ... IF EXISTS names the current schema; the unqualified name reached public through the search path when an isolated test schema was built';

/**
 * v9.0.426 (TD-610, B01-30): an existence check on a catalog (`pg_constraint`, `pg_indexes`, `pg_trigger`, ...) without
 * its schema, or `to_regclass('<bare name>')`, found the object of the same name in `public` or in another test schema
 * and skipped it, so a test schema built beside a migrated one lacked 30 constraints and indexes. These files now check
 * their own schema; on a database whose only ERP schema is `public` the result is the same.
 */
const TD_610_REASON = 'v9.0.426 (TD-610): catalog existence checks restrict the current schema; a bare check found the object in another schema and skipped it';

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
    reason: `${TD_590_REASON}; ${TD_610_REASON}`,
  },
  '0015_documents_ref_fiscal_year_unique': {
    previousHashes: ['260e3e8a442698bddd5608820ba2ea5cd0d3986ae806d183b3a1e4aba2c4b72d'],
    reason: `${TD_590_REASON}; ${TD_610_REASON}`,
  },
  '0021_drop_items_stocks_jsonb': {
    previousHashes: ['13c40e67da0e5462188db16cee2802059442af453c3414e2ea39fc59a05ae128'],
    reason: TD_590_REASON,
  },
  '0081_document_check_constraints': {
    previousHashes: ['5044f7e6b7cab66c31f41ee067ddbf1d71f1756337a4d37c9f08eaaf0653a5a5'],
    reason: TD_590_REASON,
  },
  '0000_v3_baseline': {
    previousHashes: ['7edb6f850570599887f6a6eccea817b284364ca686cedaa11d71d36e1f0c92d8'],
    reason: TD_610_REASON,
  },
  '0001_integrity_constraints': {
    previousHashes: ['74703ea0ab3e87f03b3580bf677dba74cf8db6056a002398b3980a3cb81f80f3'],
    reason: TD_610_REASON,
  },
  '0005_fk_and_cycle_resolution': {
    previousHashes: ['093567291aa1ba4854990f1a3c9772a77bb259387020a0e267022b364f7e3d42'],
    reason: TD_610_REASON,
  },
  '0012_system_integrity_constraints': {
    previousHashes: ['61647cc213693733f14e774ed330cd5f73976fdc6f0cb073e6b40c23eb45383f'],
    reason: TD_610_REASON,
  },
  '0013_integrity_remediation': {
    previousHashes: ['1c97ffc8a2d82f9b432ac423e1a439f2675ad50174e23951540f6425c488eea0'],
    reason: TD_610_REASON,
  },
  '0014_item_warehouse_stocks': {
    previousHashes: ['d1bb02418c9c8a0978d8a8c90aa03e2073bf9dbbfff5b47e05b4391d11e0c146'],
    reason: TD_610_REASON,
  },
  '0018_documents_structured_vat': {
    previousHashes: ['4f4e9e4c7ac7e53cda7f2e79b63d750b424d0ed551a7475ade00b01dafa9fe36'],
    reason: TD_610_REASON,
  },
  '0025_documents_exchange_rate': {
    previousHashes: ['69ed65dc3b5f3a34af8b1fb6b60905f27f4a111ac42c37ef252375b7df9badaf'],
    reason: TD_610_REASON,
  },
  '0031_journal_voucher_number_unique': {
    previousHashes: ['99e40497fbc7e00639135437e65d0476a5ea2f18eb9eb4bfdcb3cc0deb071c21'],
    reason: TD_610_REASON,
  },
  '0037_piecework_task_code_unique': {
    previousHashes: ['9fff5c3fdd01560cf7aecb91df4e6d5f6086f88d54f9d930e8803c2483a2ccd2'],
    reason: TD_610_REASON,
  },
  '0052_customers_unique_active_name': {
    previousHashes: ['a447630247fac8c44cea0283d6bc889034b8887668afd7e65321882e104dbbe0'],
    reason: TD_610_REASON,
  },
  '0053_personnel_unique_active_user': {
    previousHashes: ['96c83f47e92b1fddc6f7074fbd8c4e9082e910b34e1c14b7b1082957b8919f56'],
    reason: TD_610_REASON,
  },
  '0054_personnel_unique_active_code': {
    previousHashes: ['c7c08cff664e2ca6283f173986bf4a93cf98f321a98fb6f31b109a262f23c4d1'],
    reason: TD_610_REASON,
  },
  '0056_workflow_instance_open_unique': {
    previousHashes: ['59ca92ac64021b0ff6e9bf79277dbe78a7620e9f2085b423d79341479388e0c7'],
    reason: TD_610_REASON,
  },
  '0059_workflow_foreign_keys': {
    previousHashes: ['73432aea295a58350e317321213b8036347ad75d0963ace0ede082f98b6f5d8c'],
    reason: TD_610_REASON,
  },
  '0060_treasury_party_purpose': {
    previousHashes: ['86b42d76eda250b2d9b437ea7a7fb77c879377d0195eb1c1ebd30327a83ffbcd'],
    reason: TD_610_REASON,
  },
  '0061_cheque_party_account': {
    previousHashes: ['bca779371043ede85c5fa67aca01ecfef753a9f49acfa97a67a0fc57ef2e5bfa'],
    reason: TD_610_REASON,
  },
  '0070_item_code_name_unique': {
    previousHashes: ['401e2c9c62a097ddc1d14dd60afeaea453381762c2fac88db06f57014ca1ba27'],
    reason: TD_610_REASON,
  },
  '0073_category_name_unique': {
    previousHashes: ['d98f30d8981f849def25e246cf917db8a72f73cd651cac374a519abcd107b43f'],
    reason: TD_610_REASON,
  },
  '0076_piecework_personnel_rate_unique': {
    previousHashes: ['6b80f500dab614ed7c54525465bbfd74d730da5069a42a25d6c197f7dbb0fad9'],
    reason: TD_610_REASON,
  },
  '0080_document_party_id': {
    previousHashes: ['a30607f8f6373d51ad4f1a61db3f12f2cb5be29bfe534e1323eb494ee01f247f'],
    reason: TD_610_REASON,
  },
  '0084_project_stage_integrity': {
    previousHashes: ['f9446471fb45b7fb55d49fd1c129b22b4c87ad51863a1393c6e7cc77fd5ae673'],
    reason: TD_610_REASON,
  },
  '0087_pending_material_queue': {
    previousHashes: ['fb6198f59be6f205320ce8c9f963fe0ab876595e3d2ed3e1fce98ebae3da703b'],
    reason: TD_610_REASON,
  },
};

export function previousMigrationHashes(): Map<string, readonly string[]> {
  return new Map(Object.entries(AMENDED_MIGRATIONS).map(([tag, a]) => [tag, a.previousHashes]));
}
