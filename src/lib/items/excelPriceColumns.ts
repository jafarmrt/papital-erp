import { getStrategyCanonicalKey, normalizeStrategyTitle } from '../../utils/formatters.js';

/**
 * v9.0.152 (TD-647، تصمیم ت۱ الف): ستون‌های قیمت اکسل کالا، مشترک میان ورود یکپارچه سرور و ورود سریع صفحه قیمت‌گذاری.
 * فقط فهرست‌های قیمت تنظیم‌شده (`pricing_strategies`) قیمت‌اند. پیش‌تر هر ستون «قیمت …» (و در ورود سریع هر ستون عددی)
 * فهرست قیمت فروش می‌شد، پس رفت‌وبرگشت فایل خروجی بها («قیمت میانگین خرید (WAC)») و «موجودی کل» را به کشوی قیمت فاکتور
 * فروش می‌برد.
 */

/** سرستون بهای میانگین در خروجی و الگوی اکسل؛ پیشوند «قیمت» ندارد تا هرگز فهرست قیمت خوانده نشود (واژه ت۶ بسته ۶) */
export const ITEM_WAC_COLUMN = 'میانگین موزون بها';

/** سرستون‌های پیشین بها که فایل‌های قدیمی هنوز دارند؛ ورود آن‌ها را بها می‌خواند، نه قیمت */
export const LEGACY_WAC_COLUMNS = [
  'قیمت میانگین خرید (WAC)',
  'قیمت میانگین خرید (WAC - ریال)',
  'قیمت میانگین خرید',
  'میانگین بهای خرید',
  'ارزش خرید',
  'weighted_average_cost',
] as const;

/** همه سرستون‌هایی که بهای میانگین کالا را می‌آورند، به ترتیب اولویت */
export const WAC_COLUMNS: readonly string[] = [ITEM_WAC_COLUMN, ...LEGACY_WAC_COLUMNS];

/**
 * عنوان‌هایی که فایل‌های پیشین به‌اشتباه فهرست قیمت کردند. مهاجرت 0068 ردیف‌های فعال همین عنوان‌ها را نرم حذف و در
 * `item_price_title_cleanup` ثبت کرد؛ عنوان ناشناخته دیگر فقط در بررسی سلامت فهرست می‌شود.
 */
export const NON_PRICE_LIST_TITLES = ['میانگین خرید (WAC)', 'موجودی کل', 'میانگین بهای خرید'] as const;

const PRICE_HEADER_PREFIXES = ['قیمت - ', 'قیمت-', 'قیمت: ', 'قیمت ', 'Price - ', 'Price-', 'Price: ', 'Price '];

export interface PriceListMatcher {
  /** عنوان تنظیم‌شده فهرستی که با این عنوان یکی است، یا null */
  match(title: string | null | undefined): string | null;
  titles: string[];
}

/** فهرست‌های قیمت تنظیم‌شده، با کلید متعارف (`getStrategyCanonicalKey`) */
export function priceListMatcher(strategies: readonly string[]): PriceListMatcher {
  const byKey = new Map<string, string>();
  for (const s of strategies) {
    const title = normalizeStrategyTitle(s);
    const key = getStrategyCanonicalKey(title);
    if (key && !byKey.has(key)) byKey.set(key, title);
  }
  return {
    match: (title) => {
      const key = getStrategyCanonicalKey(title);
      return key ? byKey.get(key) ?? null : null;
    },
    titles: [...byKey.values()],
  };
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

export interface RowPriceCell {
  /** عنوان تنظیم‌شده فهرست قیمت */
  title: string;
  /** سلول خام قیمت (اعتبارسنجی مقدار با فراخواننده است) */
  value: unknown;
  /** ارز ردیف یا ستون ارز همان فهرست؛ پیش‌فرض IRR */
  currency: string;
}

export interface RowPriceColumns {
  prices: RowPriceCell[];
  /** سرستون‌های «قیمت …» یا «Price …» که فهرست تنظیم‌شده‌ای نیستند و نادیده گرفته شدند */
  unknownColumns: string[];
}

/**
 * v9.0.200 (O12 بسته ۵): سرستون ارز هر فهرست قیمت در خروجی و الگوی اکسل، کنار ستون قیمت همان فهرست. پیش‌تر خروجی برای کل
 * ردیف یک «واحد ارز» داشت و کالایی با قیمت ریالی و دلاری پس از رفت‌وبرگشت همه قیمت‌هایش دلاری می‌شد. ستون «واحد ارز»
 * فایل‌های پیشین هنوز ارز فهرستی است که ستون ارز خودش را ندارد.
 */
export function priceCurrencyColumn(title: string): string {
  return `ارز - قیمت ${title}`;
}

export interface ExportPrice {
  price: number | string | null | undefined;
  currency?: string | null;
}

/** ستون‌های قیمت و ارز هر فهرست برای یک ردیف خروجی یا الگو: قیمت مثبت یا خالی، و ارز همان قیمت (پیش‌فرض IRR) */
export function priceExportCells(titles: readonly string[], priceOf: (title: string) => ExportPrice | undefined): Record<string, number | string> {
  const cells: Record<string, number | string> = {};
  for (const title of titles) {
    const entry = priceOf(title);
    const amount = Number(entry?.price);
    cells[`قیمت ${title}`] = entry && Number.isFinite(amount) && amount > 0 ? amount : '';
    cells[priceCurrencyColumn(title)] = (entry?.currency || '').trim() || 'IRR';
  }
  return cells;
}

function currencyFor(row: Record<string, unknown>, title: string): string {
  const v = row[priceCurrencyColumn(title)] ?? row[`ارز - ${title}`] ?? row[`ارز ${title}`] ?? row['واحد ارز'] ?? row['ارز'];
  const s = isBlank(v) ? '' : String(v).trim();
  return s || 'IRR';
}

/**
 * ستون‌های قیمت یک ردیف اکسل. سرستون «قیمت X»، «قیمت - X»، «Price X» یا خود «X» قیمت فهرست X است، فقط اگر X فهرست
 * تنظیم‌شده باشد. سلول خالی قیمتی نمی‌دهد. سرستون «قیمت …» دیگر (جز سرستون‌های بها) در `unknownColumns` می‌آید.
 */
export function extractRowPriceColumns(row: Record<string, unknown>, strategies: readonly string[]): RowPriceColumns {
  const matcher = priceListMatcher(strategies);
  const found = new Map<string, RowPriceCell>();
  const unknownColumns: string[] = [];
  const wacHeaders = new Set(WAC_COLUMNS);

  for (const header of Object.keys(row)) {
    const trimmed = header.trim();
    if (wacHeaders.has(trimmed)) continue;
    const isPriceHeader = PRICE_HEADER_PREFIXES.some(p => trimmed.startsWith(p));
    const title = matcher.match(trimmed);
    if (!title) {
      if (isPriceHeader && !isBlank(row[header])) unknownColumns.push(trimmed);
      continue;
    }
    if (isBlank(row[header]) || found.has(title)) continue;
    found.set(title, { title, value: row[header], currency: currencyFor(row, title) });
  }
  return { prices: [...found.values()], unknownColumns };
}

/** پیام فارسی خطای ردیف برای ستون قیمتی که فهرست تنظیم‌شده نیست */
export function unknownPriceColumnMessage(column: string): string {
  return `ستون «${column}» فهرست قیمت تنظیم‌شده‌ای نیست و نادیده گرفته شد. فهرست‌های قیمت در تنظیمات تعریف می‌شوند.`;
}
