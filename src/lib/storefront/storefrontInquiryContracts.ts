/**
 * v11 phase 8.2c (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §7): the «هدیهٔ سازمانی» form of the new site, one contract
 * for the Storefront API and the storefront app. The form makes a sales lead in the ERP's CRM; nothing else is answered.
 */
export const GIFT_ORGANIZATION_MAX = 160;
export const GIFT_CONTACT_MAX = 120;
export const GIFT_NOTE_MAX = 1000;
export const GIFT_QUANTITY_MAX = 1_000_000;

export interface CorporateGiftRequest {
  organization: string;
  contactName: string;
  /** a mobile or an office number, Persian digits allowed */
  phone: string;
  /** about how many gifts (0 = not said) */
  quantity?: number;
  /** about how much in all, whole rials as a digit string ('' or '0' = not said) */
  budget?: string;
  /** the day the gifts are needed, Jalali (۱۴۰۵/۱۰/۱۵) or ISO, or '' */
  neededBy?: string;
  note?: string;
}

export interface CorporateGiftAnswer {
  /** the lead's number, to name it on the phone */
  reference: string;
}
