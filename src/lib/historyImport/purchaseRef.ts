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
