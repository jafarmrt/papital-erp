import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';

/**
 * v10.0.1 (TD-1010): خواندن سلول نوع ردیف اکسل کالا، مشترک سرور (`itemExcelRow.ts`) و
 * پیش‌نمایش مرورگر (`excelImportValidation.ts`). پیش‌تر نوع ناشناخته («مواد اولیه») بی‌صدا «محصول» می‌شد
 * و ماده اولیه با قالب کد محصول سنجیده و رد می‌شد؛ پیش‌نمایش هم نوع را از دسته می‌گرفت و با سرور نمی‌خواند.
 * v10.0.2 (TD-1011): سلول‌های عدد هم همین‌جا خوانده می‌شوند؛ پیش‌تر عدد متنی («۱٬۹۲۵٬۰۰۰» یا «1,925,000») بی‌صدا
 * نادیده گرفته می‌شد، پس کالا بی بها یا بی موجودی ساخته می‌شد و خطایی دیده نمی‌شد.
 */

export type ItemExcelType = 'product' | 'raw_material';

/** سرستون‌های نوع کالا، به ترتیب اولویت */
export const ITEM_TYPE_COLUMNS: readonly string[] = ['نوع کالا', 'نوع', 'type'];

const TYPE_WORDS: Record<string, ItemExcelType> = {
  'ماده اولیه': 'raw_material',
  'مواد اولیه': 'raw_material',
  raw_material: 'raw_material',
  'محصول نهایی': 'product',
  'محصول': 'product',
  product: 'product',
};

/** نوشته سلول برای مقایسه: نیم‌فاصله و فاصله‌های پیاپی یک فاصله، «ي» و «ك» عربی فارسی */
function typeKey(text: string): string {
  return text.replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();
}

export function isBlankExcelCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** نخستین سرستون پرِ ردیف از میان این سرستون‌ها */
export function firstFilledColumn(row: Record<string, unknown>, headers: readonly string[]): string | undefined {
  return headers.find(h => !isBlankExcelCell(row[h]));
}

export type CellResult<T> = { value?: T; error?: string };

/** نوع کالا از ستون نوع؛ سلول خالی `undefined`، نوشته ناشناخته خطای ردیف */
export function parseItemTypeCell(row: Record<string, unknown>): CellResult<ItemExcelType> {
  const header = firstFilledColumn(row, ITEM_TYPE_COLUMNS);
  if (!header) return {};
  const text = String(row[header]).trim();
  const type = TYPE_WORDS[typeKey(text)];
  if (type) return { value: type };
  return { error: `«${text}» در ستون «${header}» نوع شناخته‌شده‌ای نیست؛ «ماده اولیه» یا «محصول نهایی» بنویسید. ردیف ثبت نشد.` };
}

/** نوع کالای تازه: ستون نوع، وگرنه پالایش صفحه، وگرنه محصول (همان قاعده سرور) */
export function newItemTypeOf(typeCell: ItemExcelType | undefined, typeFilter: string | undefined): ItemExcelType {
  return typeCell ?? (typeFilter === 'raw_material' ? 'raw_material' : 'product');
}

/**
 * عدد نخستین سلول پرِ این سرستون‌ها: عدد اکسل همان عدد؛ متن با ارقام فارسی یا عربی، ممیز «٫» و جداکننده هزارگان خوانده
 * می‌شود؛ متن دیگر خطای ردیف با نام ستون. سلول خالی `undefined` است (برای کالای موجود یعنی بی‌تغییر).
 */
export function parseNumberCell(row: Record<string, unknown>, headers: readonly string[]): CellResult<number> {
  const header = firstFilledColumn(row, headers);
  if (!header) return {};
  const raw = row[header];
  if (typeof raw === 'number') {
    if (Number.isFinite(raw)) return { value: raw };
  } else {
    const text = normalizeDecimalString(String(raw));
    if (DECIMAL_PATTERN.test(text)) return { value: Number(text) };
  }
  return { error: `«${String(raw).trim()}» در ستون «${header}» عدد نیست. ردیف ثبت نشد.` };
}

/** سرستون‌هایی از ردیف که موجودی می‌دهند و پیش‌نمایش (که انبارها را ندارد) باید عدد بودنشان را بسنجد */
export function stockColumnsOf(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter(h => h === 'موجودی' || h.startsWith('موجودی ') || h.startsWith('stock_'));
}

/**
 * v10.0.13 (TD-1012): پیش‌نمایش کالای تازه‌ای را که از اکسل موجودی می‌گیرد ولی «میانگین موزون بها» ندارد خطا نشان می‌دهد؛
 * سرور همان ردیف را رد می‌کند (`stockWithoutCostError`). ستون‌های بها همان سرستون‌های سرورند و از فراخواننده می‌آیند.
 */
export function newItemStockWithoutCost(row: Record<string, unknown>, wacHeaders: readonly string[]): boolean {
  const wac = parseNumberCell(row, wacHeaders).value;
  if (wac !== undefined && wac > 0) return false;
  return stockColumnsOf(row).some(h => (parseNumberCell(row, [h]).value ?? 0) > 0);
}
