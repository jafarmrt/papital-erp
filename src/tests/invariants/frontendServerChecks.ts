import { checkForeignVatRoundedToCents, checkLineDiscountWithinAmount, checkVatAmountMatchesPercent } from './frontendServerScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه L (تطابق فرانت‌اند و سرور) در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const FRONTEND_SERVER_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_380_line_discount_within_amount', 'v8.0.81: تخفیف هر ردیف سند از مبلغ همان ردیف بیشتر نمی‌شود؛ ثبت و ویرایش با تخفیف بیشتر رد و تخفیف برابر مبلغ پذیرفته می‌شود (TD-380)',
    checkLineDiscountWithinAmount, 'فاکتور، پیش‌فاکتور و ویرایش با تخفیف بیشتر رد شد؛ تخفیف برابر مبلغ ردیف پذیرفته شد'],
  ['inv_td_381_vat_amount_matches_percent', 'v8.0.82: مبلغ مالیات ارسالی همراه درصد مثبت در ثبت، ویرایش و نهایی‌سازی همان مبلغ درصدی سرور است و ناهم‌خوان رد می‌شود؛ مبلغ صریح بی درصد پذیرفته است (TD-381)',
    checkVatAmountMatchesPercent, 'مالیات ۱ ریالی با درصد ۱۰ در ثبت، ویرایش و نهایی‌سازی رد شد؛ درصد تنها از جمع اقلام حساب شد؛ مالیات صریح بی درصد ذخیره شد'],
  ['inv_td_382_foreign_vat_rounded_to_cents', 'v8.0.83: مالیات درصدی فاکتور ارزی در ثبت و ویرایش به سِنت گرد می‌شود و فاکتور ریالی بی‌اعشار می‌ماند (TD-382)',
    checkForeignVatRoundedToCents, 'مالیات ۹٪ از ۱۵٫۵۵ دلار ۱٫۴۰ و پس از ویرایش ۲٫۸۰؛ ریالی ۲'],
];
