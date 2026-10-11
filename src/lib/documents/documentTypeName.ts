/**
 * TD-1241 (roles-c Rc17): the Persian name of each document type for text a user reads, such as the reason a voided
 * document's reversal voucher carries. Before, that reason printed the type code («(invoice)»). Same rule as TD-1129:
 * a code never reaches the user; an unknown type is «سند».
 *
 * This file depends on nothing from the server or the browser.
 */
export const DOCUMENT_TYPE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  invoice: 'فاکتور فروش',
  proforma: 'پیش‌فاکتور فروش',
  return: 'برگشت از فروش',
  receipt: 'رسید خرید',
  purchase: 'فاکتور خرید',
  production_receipt: 'رسید تولید',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال',
});

export function documentTypeName(docType: string | null | undefined): string {
  const key = (docType ?? '').trim();
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPE_NAMES, key) ? DOCUMENT_TYPE_NAMES[key] : 'سند';
}

/** The reason a voided document's voucher carries into its reversal description */
export function documentVoidVoucherReason(docType: string | null | undefined, refNumber: string): string {
  return `ابطال ${documentTypeName(docType)} شماره ${refNumber}`;
}
