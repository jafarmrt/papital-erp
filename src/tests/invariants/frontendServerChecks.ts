import { checkForeignVatRoundedToCents, checkLineDiscountWithinAmount, checkVatAmountMatchesPercent } from './frontendServerScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه L (تطابق فرانت‌اند و سرور) در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const FRONTEND_SERVER_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_380_line_discount_within_amount', 'v8.0.103: a document line discount never exceeds the line amount; create and edit with a larger discount are refused and a discount equal to the amount is accepted (TD-380)',
    checkLineDiscountWithinAmount, 'Invoice, proforma and edit with a larger discount were refused; a discount equal to the line amount was accepted'],
  ['inv_td_381_vat_amount_matches_percent', 'v8.0.104: a VAT amount sent with a positive percent on create, edit and finalize must equal the server percent amount, and a mismatch is refused; an explicit amount without a percent is accepted (TD-381)',
    checkVatAmountMatchesPercent, 'VAT of 1 rial with 10 percent was refused on create, edit and finalize; the percent alone was computed from the line total; explicit VAT without a percent was stored'],
  ['inv_td_382_foreign_vat_rounded_to_cents', 'v8.0.105: percent VAT of a foreign-currency invoice is rounded to cents on create and edit, and a rial invoice stays without decimals (TD-382)',
    checkForeignVatRoundedToCents, '9% VAT of 15.55 dollars is 1.40, and 2.80 after the edit; rial 2'],
];
