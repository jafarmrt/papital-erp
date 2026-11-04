import type { DiscountKind } from './storefrontDiscountRules.js';

/**
 * v11 phase 8.2c: the «کدهای تخفیف» section of the «فروشگاه سایت» tab, one contract for the server and the screen
 * (`AGENTS.md` §6.5). Amounts are whole rials as digit strings; times are ISO, or '' for none.
 */
export interface DiscountCodeInput {
  code: string;
  title: string;
  kind: DiscountKind;
  /** 1 to 90 for a percent code, 0 for an amount code */
  percent: number;
  /** the rial amount of an amount code ('0' for a percent code) */
  amount: string;
  /** a percent code's cap in rial ('0' = none) */
  maxDiscount: string;
  /** the minimum items amount in rial, at the buyer's prices ('0' = none; an amount code needs one above its amount) */
  minOrderAmount: string;
  /** the first day it works, a Tehran calendar day as ISO `YYYY-MM-DD`, or '' from now */
  startsOn: string;
  /** the last day it works (to the end of that Tehran day), or '' for no end */
  endsOn: string;
  /** uses in all (0 = no limit) */
  usageLimit: number;
  /** uses by one buyer: one phone, and one account when signed in (0 = no limit) */
  perBuyerLimit: number;
  /** guests and retail accounts may use it */
  forRetail: boolean;
  /** buyer groups whose buyers may use it too (each must accept discounts) */
  groupIds: number[];
  accountsOnly: boolean;
  firstOrderOnly: boolean;
  isActive: boolean;
}

export interface DiscountCodeRow extends DiscountCodeInput {
  id: number;
  /** orders that hold a use now (a cancelled order's use went back) */
  usedCount: number;
  version: number;
}

export interface DiscountCodesView {
  codes: DiscountCodeRow[];
  /** the buyer groups a code may be opened to; only a group that accepts discounts can be chosen */
  groups: Array<{ id: number; title: string; acceptsDiscounts: boolean }>;
}

/** What the buyer sees of a code that applied (a quote or an order) */
export interface AppliedDiscount {
  code: string;
  title: string;
  amount: string;
  amountToman: string;
}
