import Decimal from "decimal.js";
import { formatCurrencyLabel } from "./formatters.js";
import { normalizeDecimalString } from "../lib/numericInput.js";

export function toPersianDigits(val: string | number | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || typeof val === 'object') return '';
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  try {
    let s = String(val).trim();
    // اگر رشته دارای صفر پیشین غیر اعشاری باشد (مانند تلفن "021..." یا کد ملی "001..."), نباید به عدد تبدیل شود چون صفرهای پیشین حذف می‌شوند
    const hasLeadingZero = (s.startsWith('0') || s.startsWith('-0')) && !s.startsWith('0.') && !s.startsWith('-0.') && s !== '0';
    // If it's a numeric or decimal string (e.g. "12.3456", "100.0000", 95.833333) and not a code with leading zeros
    if (/^-?\d+(\.\d+)?$/.test(s) && !hasLeadingZero && (typeof val === 'number' || s.includes('.'))) {
      const num = Number(s);
      if (!isNaN(num)) {
        s = num.toLocaleString('en-US', {
          maximumFractionDigits: maxDecimals,
          minimumFractionDigits: 0,
          useGrouping: false
        });
      }
    }
    return s.replace(/[0-9]/g, (w) => farsiDigits[parseInt(w, 10)]);
  } catch {
    return '';
  }
}

export function toEnglishDigits(str: string | number | null | undefined): string {
  if (str === null || str === undefined || typeof str === 'object') return '';
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  try {
    const s = String(str);
    return s
      .replace(/[۰-۹]/g, (w) => String(faDigits.indexOf(w)))
      .replace(/[٠-٩]/g, (w) => String(arDigits.indexOf(w)));
  } catch {
    return '';
  }
}

export function cleanDecimalString(val: number | string | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const num = typeof val === 'number' ? val : Number(normalizeDecimalString(String(val)));
    if (isNaN(num)) return '';
    if (num === 0) return '0';
    return num.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: 0,
      useGrouping: false
    });
  } catch {
    return '';
  }
}

export function formatPersianPrice(num: number | string | null | undefined, currency?: string, maxDecimals: number = 0): string {
  if (num === null || num === undefined || num === '' || typeof num === 'object') {
    const zero = '۰';
    return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
  }
  try {
    const n = typeof num === 'number' ? num : Number(normalizeDecimalString(String(num)));
    if (isNaN(n)) {
      const zero = '۰';
      return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
    }
    // If currency is non-IRR (e.g. USD, EUR) or user didn't specify maxDecimals and fraction exists, allow up to 2 decimals
    const effDecimals = maxDecimals > 0 ? maxDecimals : (currency && currency !== 'IRR' && n % 1 !== 0 ? 2 : 0);
    // Standard format with thousands separator and minimum 0 fraction digits (no redundant .0000)
    const formatted = n.toLocaleString('en-US', {
      maximumFractionDigits: effDecimals,
      minimumFractionDigits: 0
    });
    const persianVal = toPersianDigits(formatted);
    return currency ? `${persianVal} ${formatCurrencyLabel(currency)}` : persianVal;
  } catch {
    const zero = '۰';
    return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
  }
}

export function formatPersianNumber(val: number | string | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  
  if (typeof val === 'number') {
    if (isNaN(val)) return '';
    const formatted = val.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: 0
    });
    return toPersianDigits(formatted);
  }
  
  try {
    const rawStr = String(val).trim();
    if (!rawStr) return '';

    // If it's a date or code with slashes, colons, or mixed letters, keep verbatim with Persian digits
    if (rawStr.includes('/') || rawStr.includes(':') || (rawStr.includes('-') && !/^-?\d+(\.\d+)?$/.test(rawStr)) || /[a-zA-Z]/.test(rawStr)) {
      return toPersianDigits(rawStr);
    }

    const englishStr = normalizeDecimalString(rawStr);
    const num = Number(englishStr);
    if (!isNaN(num)) {
      const formatted = num.toLocaleString('en-US', {
        maximumFractionDigits: maxDecimals,
        minimumFractionDigits: 0
      });
      return toPersianDigits(formatted);
    }

    return toPersianDigits(rawStr);
  } catch {
    return '';
  }
}

/**
 * فرمتر شناسه‌ها (کد پرسنلی، کد ملی، تلفن، شماره سند و...) — فقط ارقام فارسی
 * بدون هیچ جداکننده سه‌رقمی، چون این فیلدها مقدار عددی/ریالی نیستند.
 */
export function formatPersianCode(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const rawStr = String(val).trim();
    if (!rawStr) return '';
    return toPersianDigits(toEnglishDigits(rawStr));
  } catch {
    return '';
  }
}

/**
 * Safely parse any number or string (including Persian/Arabic digits, thousand separators, or whitespace)
 * into a pure JavaScript number. Backed by Decimal to eliminate floating-point drift.
 * v9.0.226 (TD-666): همان یکسان‌سازی سرور (`normalizeDecimalString`): ممیز «٫»، جداکننده‌های «٬» «،» «,»، فاصله و نیم‌فاصله؛
 * پیش‌تر «۱۲٫۵» و «۱٬۲۵۰٬۰۰۰» بی‌صدا صفر می‌شدند.
 */
export function parseCleanNumber(val: unknown, defaultValue: number = 0): number {
  if (val === null || val === undefined || typeof val === 'object') return defaultValue;
  if (typeof val === 'number') return isNaN(val) || !isFinite(val) ? defaultValue : val;
  const str = normalizeDecimalString(String(val));
  if (str === '' || str === '-') return defaultValue;
  try {
    const d = new Decimal(str);
    return d.isFinite() ? d.toNumber() : defaultValue;
  } catch {
    const num = Number(str);
    return isNaN(num) || !isFinite(num) ? defaultValue : num;
  }
}

export function parseQuantityOrTime(val: string | number | null | undefined): number {
  if (val === null || val === undefined || typeof val === 'object') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  try {
    const str = toEnglishDigits(String(val)).trim();
    if (str.includes(':')) {
      const parts = str.split(':');
      const hours = parseCleanNumber(parts[0], 0);
      const minutes = parseCleanNumber(parts[1], 0);
      return hours + (minutes / 60);
    }
    return parseCleanNumber(str, 0);
  } catch {
    return 0;
  }
}

export function formatQuantityOrTime(val: number | string | null | undefined, unit?: string, maxDecimals: number = 4): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '۰';
  try {
    const parsed = typeof val === 'number' ? val : parseQuantityOrTime(val);
    if (isNaN(parsed) || parsed <= 0) return '۰';
    if (unit === 'ساعت') {
      const totalMinutes = Math.round(parsed * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (m === 0) return `${toPersianDigits(h)} ساعت`;
      return `${toPersianDigits(h)}:${String(m).padStart(2, '0').replace(/[0-9]/g, w => ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'][parseInt(w, 10)])} (${toPersianDigits(h)} ساعت و ${toPersianDigits(m)} دقیقه)`;
    }
    return formatPersianNumber(parsed, maxDecimals);
  } catch {
    return '۰';
  }
}

/**
 * تبدیل دسته‌های ۳ رقمی عدد به حروف فارسی
 */
function chunk3ToPersianWords(num: number): string {
  if (num === 0) return '';
  const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];

  const parts: string[] = [];
  const h = Math.floor(num / 100);
  const rem = num % 100;
  if (h > 0) parts.push(hundreds[h]);
  if (rem >= 10 && rem < 20) {
    parts.push(teens[rem - 10]);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (t > 0) parts.push(tens[t]);
    if (o > 0) parts.push(ones[o]);
  }
  return parts.join(' و ');
}

/**
 * تبدیل عدد صحیح به حروف سلیس فارسی (پشتیبانی تا کوادریلیون بدون محدودیت اعشاری)
 * مثال: 1234567 => یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت
 */
export function numberToPersianWords(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '';
  const clean = normalizeDecimalString(String(input));
  if (clean === '0') return 'صفر';
  const isNegative = clean.startsWith('-');
  const rawNum = isNegative ? clean.slice(1) : clean;
  if (!/^\d+$/.test(rawNum)) return '';

  const scales = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون'];
  const chunks: number[] = [];
  for (let i = rawNum.length; i > 0; i -= 3) {
    chunks.push(parseInt(rawNum.substring(Math.max(0, i - 3), i), 10));
  }

  const wordsParts: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk > 0) {
      const chunkWords = chunk3ToPersianWords(chunk);
      const scale = scales[i];
      if (i === 1 && chunk === 1) {
        wordsParts.push('یک هزار');
      } else {
        wordsParts.push(scale ? `${chunkWords} ${scale}` : chunkWords);
      }
    }
  }

  const result = wordsParts.join(' و ');
  return (isNegative ? 'منفی ' : '') + result;
}

export interface FinancialWordsResult {
  words: string;
  tomanEquivalent: string;
  fullDescription: string;
}

/**
 * تبدیل مبالغ مالی به حروف فارسی به همراه معادل روان تومان برای مبالغ ریالی
 * مثال برای 45000000:
 * {
 *   words: 'چهل و پنج میلیون ریال',
 *   tomanEquivalent: 'چهار میلیون و پانصد هزار تومان',
 *   fullDescription: 'چهل و پنج میلیون ریال (معادل چهار میلیون و پانصد هزار تومان)'
 * }
 */
export function financialAmountToPersianWords(
  amount: number | string | null | undefined,
  currency: string = 'IRR'
): FinancialWordsResult {
  if (amount === null || amount === undefined || amount === '') {
    return { words: '', tomanEquivalent: '', fullDescription: '' };
  }
  const cleanStr = normalizeDecimalString(String(amount));
  const num = Number(cleanStr);
  if (isNaN(num)) {
    return { words: '', tomanEquivalent: '', fullDescription: '' };
  }

  const cur = currency?.toUpperCase() || 'IRR';
  const isRial = cur === 'IRR' || cur === 'ریال';
  const isToman = cur === 'TOMAN' || cur === 'تومان';

  if (num === 0) {
    const label = isRial ? 'ریال' : isToman ? 'تومان' : formatCurrencyLabel(cur);
    const zeroDesc = `صفر ${label}`;
    return { words: zeroDesc, tomanEquivalent: '', fullDescription: zeroDesc };
  }

  const prefix = num < 0 ? 'منفی ' : '';
  const absNum = Math.abs(num);
  const intPart = Math.floor(absNum);

  if (isRial) {
    const rialWords = numberToPersianWords(intPart);
    const rialText = `${prefix}${rialWords} ریال`;
    const tomanValue = Math.floor(intPart / 10);
    const tomanRemainder = intPart % 10;

    let tomanText = '';
    if (tomanValue > 0) {
      const tomanWords = numberToPersianWords(tomanValue);
      tomanText = `${prefix}${tomanWords} تومان`;
      if (tomanRemainder > 0) {
        tomanText += ` و ${numberToPersianWords(tomanRemainder)} ریال`;
      }
    }

    return {
      words: rialText,
      tomanEquivalent: tomanText,
      fullDescription: tomanText ? `${rialText} (معادل ${tomanText})` : rialText
    };
  }

  if (isToman) {
    const tomanWords = numberToPersianWords(intPart);
    const tomanText = `${prefix}${tomanWords} تومان`;
    const rialValue = intPart * 10;
    const rialWords = numberToPersianWords(rialValue);
    const rialText = `${prefix}${rialWords} ریال`;

    return {
      words: tomanText,
      tomanEquivalent: rialText,
      fullDescription: `${tomanText} (معادل ${rialText})`
    };
  }

  // سایر ارزها (USD, EUR, AED, GBP)
  const currLabel = formatCurrencyLabel(cur);
  const foreignWords = numberToPersianWords(intPart);
  const fullText = `${prefix}${foreignWords} ${currLabel}`;

  return {
    words: fullText,
    tomanEquivalent: '',
    fullDescription: fullText
  };
}
