import { checkLineDiscountWithinAmount } from './frontendServerScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه L (تطابق فرانت‌اند و سرور) در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const FRONTEND_SERVER_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_380_line_discount_within_amount', 'v8.0.81: تخفیف هر ردیف سند از مبلغ همان ردیف بیشتر نمی‌شود؛ ثبت و ویرایش با تخفیف بیشتر رد و تخفیف برابر مبلغ پذیرفته می‌شود (TD-380)',
    checkLineDiscountWithinAmount, 'فاکتور، پیش‌فاکتور و ویرایش با تخفیف بیشتر رد شد؛ تخفیف برابر مبلغ ردیف پذیرفته شد'],
];
