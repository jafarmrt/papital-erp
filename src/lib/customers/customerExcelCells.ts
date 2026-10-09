import { toLatinDigits } from '../numericInput';

/**
 * v10.0.22 (TD-974): reading the phone and bank number cells of the party Excel import (preview and upload).
 *
 * Excel stores a typed number as a number: «09121234567» becomes 9121234567 and a 16-digit card number keeps only 15
 * significant digits (6037991234567891 is stored as 6037991234567890). Before, the modal read every cell with
 * `String(value)`, so the phone lost its leading zero and the card number its last digit, silently.
 *
 * - A text cell is read as written (Persian and Arabic digits become Latin).
 * - A numeric phone cell of ten digits is an Iranian number without its leading zero, which comes back.
 * - A numeric card, account or Sheba cell longer than 15 digits has already lost digits inside Excel and is a row error
 *   asking for a text column; a shorter numeric cell is read as its digits.
 */
export const EXCEL_EXACT_DIGITS = 15;

export interface CellRead {
  text: string;
  issue?: string;
}

const digitsOfNumber = (value: number): string => (Number.isInteger(value) ? BigInt(value).toString() : String(value));

export function phoneCellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const digits = digitsOfNumber(value);
    return /^\d{10}$/.test(digits) ? `0${digits}` : digits;
  }
  return toLatinDigits(String(value)).trim();
}

export function bankNumberCell(value: unknown, label: string): CellRead {
  if (value === undefined || value === null) return { text: '' };
  if (typeof value === 'number' && Number.isFinite(value)) {
    const digits = digitsOfNumber(Math.abs(value));
    if (!Number.isInteger(value) || digits.length > EXCEL_EXACT_DIGITS) {
      return {
        text: digits,
        issue: `«${label}» در اکسل عدد ذخیره شده و رقم‌های آخرش از دست رفته است؛ قالب این ستون را «متن» کنید، شماره را دوباره بنویسید و فایل را دوباره بارگذاری کنید.`,
      };
    }
    return { text: digits };
  }
  return { text: toLatinDigits(String(value)).trim() };
}
