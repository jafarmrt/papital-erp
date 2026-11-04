import { toLatinDigits } from '../numericInput.js';

/**
 * v11 phase 8.2c (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6, decision 6): the rules of a site discount code shared
 * by the server, the ERP «کدهای تخفیف» section and the storefront app. Nothing here reads the database. Amounts are whole
 * rials as BigInt, so a discount is never rounded through a JS number.
 */
export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export type DiscountKind = typeof DISCOUNT_KINDS[number];
export const DISCOUNT_KIND_TITLES: Readonly<Record<DiscountKind, string>> = { percent: 'درصدی', amount: 'مبلغی' };
export const isDiscountKind = (value: unknown): value is DiscountKind => DISCOUNT_KINDS.includes(value as DiscountKind);

export const DISCOUNT_PERCENT_MAX = 90;
export const DISCOUNT_TITLE_MAX = 120;
export const DISCOUNT_LIMIT_MAX = 1_000_000;
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

/** A code as a buyer or a colleague typed it: Persian digits, spaces and lower case allowed; '' when it cannot be one */
export function normalizeDiscountCode(raw: unknown): string {
  const code = toLatinDigits(String(raw ?? '')).trim().replace(/\s+/g, '').toUpperCase();
  return DISCOUNT_CODE_PATTERN.test(code) ? code : '';
}

export const DISCOUNT_CODE_HINT = 'کد ۳ تا ۳۰ نویسه است: حرف لاتین، رقم و «-»، و با حرف یا رقم آغاز می‌شود.';

/** A discount is taken in whole tomans (10 rial), like the site's prices */
const TOMAN = 10n;

/**
 * The discount a code gives on an items amount (rial): a percent rounded down to whole tomans and held to the code's
 * cap, or the code's amount. Always below the items amount, so an order is never free.
 */
export function discountAmountOf(code: { kind: DiscountKind; percent: number; amount: string; maxDiscount: string }, itemsAmount: string): bigint {
  const items = BigInt(itemsAmount);
  if (items <= 0n) return 0n;
  let discount = code.kind === 'percent'
    ? (items * BigInt(code.percent)) / 100n / TOMAN * TOMAN
    : BigInt(code.amount);
  const cap = BigInt(code.maxDiscount || '0');
  if (code.kind === 'percent' && cap > 0n && discount > cap) discount = cap;
  if (discount >= items) discount = items - 1n;
  return discount > 0n ? discount : 0n;
}

/**
 * A discount spread over the lines in proportion to each line's amount, as line discounts (the WooCommerce coupon rule of
 * the ERP): each share rounded down, and what is left goes one rial at a time to the largest lines, never past a line's
 * own amount. The shares add up to exactly the discount.
 */
export function spreadDiscount(lineAmounts: readonly bigint[], discount: bigint): bigint[] {
  const total = lineAmounts.reduce((sum, a) => sum + a, 0n);
  if (discount <= 0n || total <= 0n) return lineAmounts.map(() => 0n);
  if (discount > total) throw new Error('discount above the lines');
  const shares = lineAmounts.map(a => (discount * a) / total);
  let left = discount - shares.reduce((sum, s) => sum + s, 0n);
  const byAmount = lineAmounts.map((a, i) => ({ a, i })).sort((x, y) => (y.a > x.a ? 1 : y.a < x.a ? -1 : x.i - y.i));
  while (left > 0n) {
    for (const { a, i } of byAmount) {
      if (left === 0n) break;
      if (shares[i] < a) {
        shares[i] += 1n;
        left -= 1n;
      }
    }
  }
  return shares;
}
