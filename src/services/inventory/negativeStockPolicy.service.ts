/**
 * v7.0.22 (TD-180 / audit P0-3): سیاست موجودی منفی به تصمیم مالک محصول فقط «ممنوع» است.
 * قید دیتابیسی chk_iws_current_stock_non_negative (مهاجرت 0014) آخرین خط دفاع است و
 * گزینه‌های قدیمی «هشدار» و «مجاز» با آن در تضاد بودند (خطای ۵۰۰ هنگام خروج کالا).
 * v10.0.25 (OBS-R1-83): سرویس خواندن و نوشتن تنظیم، route و زبانه تنظیمات برای این سیاست ثابت برداشته شد؛
 * مقدار کهنه `negative_stock_policy` در app_settings خوانده نمی‌شود و اثری ندارد.
 */
export const NEGATIVE_STOCK_POLICY = 'forbidden' as const;
export type NegativeStockPolicyType = typeof NEGATIVE_STOCK_POLICY;
