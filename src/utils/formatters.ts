import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Decimal from "decimal.js";
import { toEnglishDigits, toPersianDigits } from "./persianNumber.js";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizePersianText(str: string | null | undefined): string {
  if (!str || typeof str === 'object') return '';
  try {
    return String(str)
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ة/g, 'ه')
      .replace(/ۀ/g, 'ه')
      .replace(/[\u200c\u200b\u200e\u200f\s\-_]+/g, ' ')
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeStrategyTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle || typeof rawTitle === 'object') return '';
  try {
    let clean = String(rawTitle).trim();
    if (!clean) return '';
    while (
      clean.startsWith('قیمت - ') ||
      clean.startsWith('قیمت-') ||
      clean.startsWith('قیمت: ') ||
      clean.startsWith('قیمت ') ||
      clean.startsWith('Price - ') ||
      clean.startsWith('Price-') ||
      clean.startsWith('Price: ') ||
      clean.startsWith('Price ')
    ) {
      if (clean.startsWith('قیمت - ')) clean = clean.substring(7).trim();
      else if (clean.startsWith('قیمت-')) clean = clean.substring(5).trim();
      else if (clean.startsWith('قیمت: ')) clean = clean.substring(6).trim();
      else if (clean.startsWith('قیمت ')) clean = clean.substring(5).trim();
      else if (clean.startsWith('Price - ')) clean = clean.substring(8).trim();
      else if (clean.startsWith('Price-')) clean = clean.substring(6).trim();
      else if (clean.startsWith('Price: ')) clean = clean.substring(7).trim();
      else if (clean.startsWith('Price ')) clean = clean.substring(6).trim();
    }
    return clean || String(rawTitle).trim();
  } catch {
    return '';
  }
}

export function getStrategyCanonicalKey(rawTitle: string | null | undefined): string {
  const title = normalizeStrategyTitle(rawTitle);
  return normalizePersianText(title);
}

export function formatStrategyDisplayTitle(rawTitle: string | null | undefined): string {
  const clean = normalizeStrategyTitle(rawTitle);
  return clean || 'عمومی';
}

export function formatCurrencyLabel(c?: string): string {
  if (!c || c === 'IRR' || c === 'ریال') return 'ریال';
  if (c === 'USD') return 'دلار';
  if (c === 'EUR') return 'یورو';
  if (c === 'AED') return 'درهم';
  if (c === 'GBP') return 'پوند';
  return c;
}

/**
 * Financial rounding utility to eliminate IEEE 754 floating-point drift
 */
export function roundFinancial(num: number | string | null | undefined, decimals: number = 4): number {
  if (num === null || num === undefined || typeof num === 'object') return 0;
  const str = toEnglishDigits(String(num)).replace(/,/g, '').trim();
  if (str === '' || str === '-') return 0;
  try {
    const d = new Decimal(str);
    return d.isFinite() ? d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber() : 0;
  } catch {
    const n = Number(str);
    if (isNaN(n) || !isFinite(n)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((n + Number.EPSILON) * factor) / factor;
  }
}

/**
 * Safely extracts error message from an unknown error object
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'خطای ناشناخته رخ داده است';
}

/**
 * v7.0.79 (audit P3-3, `strict: true`): متن خطای یک catch با نوع unknown، یا رشته خالی اگر پیامی ندارد؛
 * جایگزین `err.message` تا الگوی `errorMessageOf(err) || 'پیام پیش‌فرض'` همان رفتار قبلی را داشته باشد.
 */
export function errorMessageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

/**
 * Safely extracts an array from API responses (paginated { data: [...] } or direct array [...])
 */
export function safeExtractArray<T = unknown>(res: unknown): T[] {
  if (res && typeof res === 'object' && 'data' in res && Array.isArray((res as { data: unknown }).data)) {
    return (res as { data: T[] }).data;
  }
  if (Array.isArray(res)) return res as T[];
  return [];
}

/**
 * Standard multi-value parser supporting both English and Persian commas (, and ،)
 */
export function parseMultiValue(val?: string | null): string[] {
  if (!val) return [];
  return String(val).split(/[,،]\s*/).map(s => s.trim()).filter(Boolean);
}

/**
 * Standard multi-value formatter joining non-empty items with Persian comma
 */
export function formatMultiValue(arr?: string[] | null): string {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).join('، ');
}

/**
 * فرمت‌بندی اندازه فایل به صورت فارسی (بایت، کیلوبایت، مگابایت)
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '۰ بایت';
  if (bytes < 1024) {
    const formatted = bytes.toLocaleString('en-US');
    return `${toPersianDigits(formatted)} بایت`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    const formatted = Math.round(kb).toLocaleString('en-US');
    return `${toPersianDigits(formatted)} کیلوبایت`;
  }
  const mb = (kb / 1024).toFixed(1);
  return `${toPersianDigits(mb)} مگابایت`;
}
