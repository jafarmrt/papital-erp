import toast from 'react-hot-toast';
import { fetchJson } from '../../../api';
import { compressTo300KB } from '../../../utils/imageCompression';
import { toEnglishDigits, parseMultiValue, formatMultiValue } from '../../../utils';

export function parseItemStocks(rawStocks: any): Record<string, number> {
  if (!rawStocks) return {};
  if (typeof rawStocks === 'string') {
    try {
      return JSON.parse(rawStocks);
    } catch {
      return {};
    }
  }
  if (typeof rawStocks === 'object') {
    return rawStocks;
  }
  return {};
}

export { parseMultiValue, formatMultiValue };

// V10-2.1: اتصال به endpoint واحد اتمیک /items/next-code
// GET (peek) = پیشنهاد بدون مصرف شمارنده؛ POST (reserve) = تخصیص اتمیک شماره سری
export interface ProductCodeParts {
  year: string;
  catPrefix: string;
  transferCode: string;
  serial: string;
  code: string;
}

export interface RawCodeParts {
  prefix: string;
  serial: string;
  code: string;
}

async function nextCodeRequest(
  type: 'product' | 'raw_material',
  params: { year?: string; prefix?: string; transfer?: string },
  method: 'GET' | 'POST'
): Promise<any | null> {
  try {
    if (method === 'GET') {
      const qs = new URLSearchParams();
      qs.set('type', type);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v));
      }
      return await fetchJson(`/items/next-code?${qs.toString()}`);
    }
    return await fetchJson('/items/next-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...params })
    });
  } catch (e) {
    console.error('next-code request failed:', e);
    return null;
  }
}

export async function peekNextProductCode(year: string, catPrefix: string, transferCode: string): Promise<ProductCodeParts | null> {
  const r = await nextCodeRequest('product', { year, prefix: catPrefix, transfer: transferCode }, 'GET');
  if (!r?.code) return null;
  return {
    code: r.code,
    year: r.year || toEnglishDigits(String(year)),
    catPrefix: r.catPrefix || String(catPrefix),
    transferCode: r.transfer || String(transferCode),
    serial: r.serial || ''
  };
}

export async function reserveNextProductCode(year: string, catPrefix: string, transferCode: string): Promise<ProductCodeParts | null> {
  const r = await nextCodeRequest('product', { year, prefix: catPrefix, transfer: transferCode }, 'POST');
  if (!r?.code) return null;
  return {
    code: r.code,
    year: r.year || toEnglishDigits(String(year)),
    catPrefix: r.catPrefix || String(catPrefix),
    transferCode: r.transfer || String(transferCode),
    serial: r.serial || ''
  };
}

export async function peekNextRawCode(prefix: string): Promise<RawCodeParts | null> {
  const r = await nextCodeRequest('raw_material', { prefix }, 'GET');
  if (!r?.code) return null;
  return { code: r.code, prefix: r.prefix || cleanCategoryPrefix(prefix), serial: r.serial || '' };
}

export async function reserveNextRawCode(prefix: string): Promise<RawCodeParts | null> {
  const r = await nextCodeRequest('raw_material', { prefix }, 'POST');
  if (!r?.code) return null;
  return { code: r.code, prefix: r.prefix || cleanCategoryPrefix(prefix), serial: r.serial || '' };
}

/** V10-2.1: حذف dashهای لبه از پیشوند دسته‌بندی (رفع دوخط‌تیره B-H--101 در کدهای جدید) */
export function cleanCategoryPrefix(prefix: unknown): string {
  return String(prefix ?? '')
    .trim()
    .toUpperCase()
    .replace(/^-+|-+$/g, '');
}

/** ساخت کد ماده اولیه تک‌خط استاندارد: PREFIX-NNN */
export function buildRawItemCode(prefixRaw: unknown, numRaw: unknown): string {
  const p = cleanCategoryPrefix(prefixRaw);
  let digits = toEnglishDigits(String(numRaw ?? '')).replace(/\D/g, '');
  if (!digits) digits = '0';
  return `${p}-${String(parseInt(digits, 10)).padStart(3, '0')}`;
}

/** ساخت کد محصول چهاربخشی استاندارد: YYYY-P-TT-SS */
export function buildProductCode(
  yearRaw: unknown,
  catPrefixRaw: unknown,
  transferRaw: unknown,
  designVarRaw: unknown
): string {
  const year = toEnglishDigits(String(yearRaw ?? '')).replace(/\D/g, '').slice(-4);
  const catPrefix = cleanCategoryPrefix(catPrefixRaw);
  const transfer = toEnglishDigits(String(transferRaw ?? '')).replace(/\D/g, '');
  const dvDigits = toEnglishDigits(String(designVarRaw ?? '')).replace(/\D/g, '');
  const designVar = dvDigits ? String(parseInt(dvDigits, 10)).padStart(2, '0') : String(designVarRaw ?? '').trim().toUpperCase();
  return `${year}-${catPrefix}-${transfer}-${designVar}`;
}

export function processImageFile(
  file: File,
  onSuccess: (dataUrl: string) => void
): void {
  if (!file.type.startsWith('image/')) {
    toast.error('لطفاً یک فایل تصویری انتخاب کنید.');
    return;
  }

  // V10-2.3: استاندارد واحد فشرده‌سازی تصاویر (سقف ۳۰۰ کیلوبایت) به‌جای گیت خام ۱ مگابایتی
  compressTo300KB(file)
    .then(onSuccess)
    .catch(() => toast.error('خطا در پردازش تصویر. لطفاً فایل دیگری انتخاب کنید.'));
}
