/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی ت۲ و ت۳): کلیدهای زبانه‌های «گزارش‌های مدیریتی»، مشترک API و صفحه.
 */
/** زبانه «فروش» و `GET /reports/sales` */
export const SALES_REPORT_PERMISSION = 'reports.sales';
/** سطر هم‌خوانی گزارش فروش با دفتر کل: همان کلیدهای گزارش‌های دفتر (TD-547) */
export const LEDGER_CHECK_PERMISSIONS = ['accounting.reports', 'accounting.view'] as const;
/** زبانه «سن مطالبات و بدهی‌ها» و `GET /reports/aging` (v10.1.10، ت۲): همان کلید گزارش‌های حسابداری */
export const AGING_REPORT_PERMISSION = 'accounting.reports';
/** زبانه «مالیات بر ارزش افزوده» و `GET /reports/vat` (v10.1.14، ت۲): همان کلید گزارش‌های حسابداری */
export const VAT_REPORT_PERMISSION = 'accounting.reports';
/** زبانه «خرید» و `GET /reports/purchases` (v10.1.15، ت۱۵): کلید تازه، چون بهای خرید هر کالا را نشان می‌دهد */
export const PURCHASE_REPORT_PERMISSION = 'reports.purchases';
/**
 * ابزارک فروش پیشخوان و `GET /reports/dashboard-summary` (v10.1.15، ت۱۴): بخش فروش با کلید گزارش فروش و بخش مطالبات با
 * کلید گزارش سن؛ ابزارک برای دارنده هر یک از این دو دیده می‌شود و فقط بخش خودش را می‌گیرد.
 */
export const DASHBOARD_SALES_WIDGET_PERMISSIONS = [SALES_REPORT_PERMISSION, AGING_REPORT_PERMISSION] as const;
