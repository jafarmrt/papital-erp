/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی ت۲ و ت۳): کلیدهای زبانه‌های «گزارش‌های مدیریتی»، مشترک API و صفحه.
 */
/** زبانه «فروش» و `GET /reports/sales` */
export const SALES_REPORT_PERMISSION = 'reports.sales';
/** سطر هم‌خوانی گزارش فروش با دفتر کل: همان کلیدهای گزارش‌های دفتر (TD-547) */
export const LEDGER_CHECK_PERMISSIONS = ['accounting.reports', 'accounting.view'] as const;
/** زبانه «سن مطالبات و بدهی‌ها» و `GET /reports/aging` (v10.1.10، ت۲): همان کلید گزارش‌های حسابداری */
export const AGING_REPORT_PERMISSION = 'accounting.reports';
