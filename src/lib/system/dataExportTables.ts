/**
 * v9.0.357 (TD-624، تصمیم ت۷ الف): فهرست یگانه جدول‌های خروجی داده‌ها، مشترک سرور (`dataExport.service.ts`) و کارت
 * تنظیمات (`DataExportCard`). هر جدول طرح Drizzle یا در خروجی است، یا جدول اختیاری سجل ممیزی، یا با دلیل کنار گذاشته
 * شده؛ Vitest `dataExportTables.test.ts` جدول ردبندی‌نشده را رد می‌کند، پس جدول تازه در همان تغییر ردبندی می‌شود.
 * متن کارت از برچسب گروه‌های همین فهرست ساخته می‌شود تا همان را بگوید که در فایل هست.
 */

export type DataExportGroup =
  | 'people' | 'inventory' | 'documents' | 'customers' | 'dailyLogs' | 'projects' | 'procurement'
  | 'accounting' | 'payroll' | 'workflow' | 'attachments' | 'settings';

export const DATA_EXPORT_GROUP_LABELS: Readonly<Record<DataExportGroup, string>> = {
  people: 'کاربران، نقش‌ها و پرسنل',
  inventory: 'کالاها، قیمت‌ها، انبارها، موجودی و کاردکس',
  documents: 'اسناد فروش و انبار',
  customers: 'طرف حساب‌ها، پرونده‌های فروش و پیگیری‌ها',
  dailyLogs: 'گزارش‌های روزانه کار',
  projects: 'پروژه‌ها، مراحل، تخصیص و رزرو مواد',
  procurement: 'درخواست‌های خرید',
  accounting: 'دفاتر حسابداری، دوره‌های مالی، خزانه و چک',
  payroll: 'کارمزدی: کارها، نرخ‌ها، کارکردها و فیش‌ها',
  workflow: 'گردش کار و قاعده‌های رویداد',
  attachments: 'فهرست پیوست‌ها (بی خود فایل‌ها)',
  settings: 'تنظیمات (بی کلیدهای محرمانه)',
};

/** Exported tables in file order (database names) */
export const DATA_EXPORT_TABLES: ReadonlyArray<{ table: string; group: DataExportGroup }> = [
  { table: 'users', group: 'people' },
  { table: 'roles', group: 'people' },
  { table: 'personnel', group: 'people' },
  { table: 'categories', group: 'inventory' },
  { table: 'warehouses', group: 'inventory' },
  { table: 'items', group: 'inventory' },
  { table: 'item_prices', group: 'inventory' },
  { table: 'item_warehouse_stocks', group: 'inventory' },
  { table: 'transactions', group: 'inventory' },
  { table: 'transfers', group: 'inventory' },
  { table: 'documents', group: 'documents' },
  { table: 'document_items', group: 'documents' },
  { table: 'customers', group: 'customers' },
  { table: 'crm_leads', group: 'customers' },
  { table: 'crm_activities', group: 'customers' },
  { table: 'daily_work_logs', group: 'dailyLogs' },
  { table: 'production_projects', group: 'projects' },
  { table: 'project_stages', group: 'projects' },
  { table: 'project_product_stage_progress', group: 'projects' },
  { table: 'project_bom_allocations', group: 'projects' },
  { table: 'project_reservation_releases', group: 'projects' },
  { table: 'pending_materials', group: 'projects' },
  { table: 'purchase_requisitions', group: 'procurement' },
  { table: 'accounts', group: 'accounting' },
  { table: 'fiscal_periods', group: 'accounting' },
  { table: 'journal_vouchers', group: 'accounting' },
  { table: 'journal_voucher_items', group: 'accounting' },
  { table: 'item_opening_voucher_items', group: 'accounting' },
  { table: 'bank_accounts', group: 'accounting' },
  { table: 'cheques', group: 'accounting' },
  { table: 'treasury_transactions', group: 'accounting' },
  { table: 'accounting_settings', group: 'accounting' },
  { table: 'task_categories', group: 'payroll' },
  { table: 'piecework_tasks', group: 'payroll' },
  { table: 'piecework_personnel_rates', group: 'payroll' },
  { table: 'piecework_task_rate_history', group: 'payroll' },
  { table: 'piecework_logs', group: 'payroll' },
  { table: 'piecework_payrolls', group: 'payroll' },
  { table: 'workflow_definitions', group: 'workflow' },
  { table: 'workflow_definition_versions', group: 'workflow' },
  { table: 'workflow_states', group: 'workflow' },
  { table: 'workflow_transitions', group: 'workflow' },
  { table: 'workflow_instances', group: 'workflow' },
  { table: 'workflow_history_logs', group: 'workflow' },
  { table: 'workflow_tasks', group: 'workflow' },
  { table: 'workflow_pending_approvals', group: 'workflow' },
  { table: 'workflow_delegations', group: 'workflow' },
  { table: 'event_action_rules', group: 'workflow' },
  { table: 'file_attachments', group: 'attachments' },
  { table: 'app_settings', group: 'settings' },
];

/** Exported only on request, for a business-day range */
export const DATA_EXPORT_ACTIVITY_LOG_TABLE = 'activity_logs';

/** Tables left out of the export, each with its reason (written to the manifest) */
export const DATA_EXPORT_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  migrations_log: 'سابقه فنی مهاجرت‌های پایگاه‌داده',
  idempotency_keys: 'کلیدهای موقت جلوگیری از ثبت دوباره درخواست',
  form_drafts: 'پیش‌نویس‌های موقت فرم‌ها',
  notifications: 'اعلان‌های موقت هر کاربر',
  document_ref_counters: 'شمارنده فنی شماره‌گذاری اسناد',
  item_code_counters: 'شمارنده فنی کدگذاری کالا',
  outbox_events: 'صف فنی ارسال رویدادها',
  dead_letter_events: 'صف فنی رویدادهای ناموفق',
  event_action_logs: 'سابقه فنی اجرای قاعده‌های رویداد',
  webhook_subscriptions: 'کلید امضای وبهوک دارد',
  webhook_deliveries: 'سابقه فنی ارسال وبهوک‌ها',
  woocommerce_order_logs: 'سابقه فنی همگام‌سازی سفارش‌های ووکامرس',
  legacy_date_repairs: 'سابقه اصلاح یک‌باره تاریخ‌ها',
  ref_fiscal_year_corrections: 'سابقه اصلاح یک‌باره سال شماره اسناد',
  daily_log_visibility_repairs: 'سابقه اصلاح یک‌باره دید گزارش‌های روزانه',
  inventory_reconciliation_anomalies: 'سابقه فنی تطبیق موجودی',
  item_price_title_cleanup: 'سابقه پاک‌سازی یک‌باره عنوان قیمت‌ها',
  workflow_task_reopen_log: 'سابقه بازگشایی یک‌باره کارهای گردش کار',
};

/** Labels of the groups the export holds, in order (the card's content line) */
export function dataExportGroupLabels(): string[] {
  const groups: DataExportGroup[] = [];
  for (const { group } of DATA_EXPORT_TABLES) if (!groups.includes(group)) groups.push(group);
  return groups.map(g => DATA_EXPORT_GROUP_LABELS[g]);
}
