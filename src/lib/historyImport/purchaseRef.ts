import { toEnglishDigits } from '../../utils/persianNumber.js';

/**
 * v11 history import, tool 6: the supplier's invoice number as a past purchase receipt («شماره فاکتور مرجع» of the warehouse
 * sheet) and a past supplier payment («شماره مرجع-فاکتور» of the «هزینه‌ها» sheet) both name it, compared without spaces,
 * ZWNJ, letter case or the Arabic forms of «ی» and «ک», and with Latin digits. Empty when the cell is empty.
 */
export function purchaseRefKey(value: unknown): string {
  return toEnglishDigits(String(value ?? ''))
    .replace(/[‌\s]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase().trim();
}

/**
 * The numbers of a purchase receipt's «شماره فاکتور مرجع» cell: one purchase paid in several «هزینه‌ها» rows (a deposit and
 * the rest, or two accounts) names each row, separated by «،», «,», «;», «+» or a line break. Each in its key form, once.
 */
export function purchaseRefKeys(value: unknown): string[] {
  return [...new Set(String(value ?? '').split(/[،,;+\n]/).map(purchaseRefKey).filter(Boolean))];
}
