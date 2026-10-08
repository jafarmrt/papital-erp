/**
 * v10.0.1 (TD-1010): خواندن سلول نوع ردیف اکسل کالا، مشترک سرور (`itemExcelRow.ts`) و
 * پیش‌نمایش مرورگر (`excelImportValidation.ts`). پیش‌تر نوع ناشناخته («مواد اولیه») بی‌صدا «محصول» می‌شد
 * و ماده اولیه با قالب کد محصول سنجیده و رد می‌شد؛ پیش‌نمایش هم نوع را از دسته می‌گرفت و با سرور نمی‌خواند.
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
