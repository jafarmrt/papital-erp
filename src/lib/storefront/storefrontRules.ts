import { normalizeGroupedDecimalString, toLatinDigits } from '../numericInput.js';

/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): rules of the storefront shared by the server, the ERP
 * settings tab and the storefront app. Nothing here reads the database.
 */

/** A latin address segment: lower-case letters and digits in words joined by single hyphens */
export const STOREFRONT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const STOREFRONT_SLUG_MAX = 120;
/** The longest search text, collection or category name the Storefront API takes in an address */
export const STOREFRONT_QUERY_TEXT_MAX = 100;

/**
 * v11 phase 8.3: the design an item belongs to, for «از همین طرح». The ERP keeps it in two places: the «کد ترنسفر»
 * field of the item card (the media screen filters on it) and the third part of a standard product code
 * (`1404-N-101-01` → `101`, how the «ترنسفر» page groups). The card field wins when it is filled; both are compared
 * without case or outer spaces, like the media filter. '' = no design, which matches nothing.
 */
export function storefrontDesignKey(transferCode: string | null, code: string): string {
  const own = (transferCode ?? '').trim().toLowerCase();
  if (own) return own;
  return (code.split('-')[2] ?? '').trim().toLowerCase();
}
export const STOREFRONT_SEO_TITLE_MAX = 70;
export const STOREFRONT_SEO_DESCRIPTION_MAX = 170;
export const SHIPPING_CODE_MAX = 40;
export const SHIPPING_TITLE_MAX = 80;
export const SHIPPING_DESCRIPTION_MAX = 200;
export const SHIPPING_RATES_MAX = 200;
/** At most this many units in stock reads «تعداد کم» unless the settings say otherwise (start plan decision 4, configurable) */
export const LOW_STOCK_THRESHOLD_DEFAULT = 3;
export const LOW_STOCK_THRESHOLD_MAX = 1000;
export const RESERVATION_HOURS_DEFAULT = 24;
export const RESERVATION_HOURS_MAX = 168;
/**
 * v12 phase 8b (site review 2.7, owner's decision 14): an «به حساب» order waits for a colleague's confirmation this long
 * (a weekend or a holiday fits), and the colleagues get a bell `APPROVAL_REMINDER_HOURS` before it runs out (half the wait
 * when the wait is shorter than twice that)
 */
export const APPROVAL_HOURS_DEFAULT = 72;
export const APPROVAL_REMINDER_HOURS = 12;
export const approvalReminderHours = (approvalHours: number): number => Math.min(APPROVAL_REMINDER_HOURS, approvalHours / 2);

export function slugError(slug: string): string | null {
  if (!slug) return 'نشانی لاتین محصول لازم است.';
  if (slug.length > STOREFRONT_SLUG_MAX) return `نشانی لاتین حداکثر ${STOREFRONT_SLUG_MAX.toLocaleString('fa-IR')} نویسه است.`;
  if (!STOREFRONT_SLUG_PATTERN.test(slug)) return 'نشانی لاتین فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها دارد.';
  return null;
}

/** A first address for an item that has none: its code, lower-cased, every other character a hyphen */
export function suggestedSlug(code: string): string {
  return toLatinDigits(code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, STOREFRONT_SLUG_MAX).replace(/-+$/g, '');
}

export function shippingCodeError(code: string): string | null {
  if (!code) return 'کد روش ارسال لازم است.';
  if (code.length > SHIPPING_CODE_MAX || !STOREFRONT_SLUG_PATTERN.test(code)) {
    return 'کد روش ارسال فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها دارد.';
  }
  return null;
}

/** Digits only, Persian and Arabic digits read, spaces and hyphens dropped */
export function digitsOnly(value: string): string {
  return toLatinDigits(value).replace(/[\s\-‌]/g, '');
}

/** A 16-digit bank card number with a valid Luhn check digit; '' is allowed (no card) */
export function cardNumberError(raw: string): string | null {
  const card = digitsOnly(raw);
  if (!card) return null;
  if (!/^\d{16}$/.test(card)) return 'شماره کارت باید ۱۶ رقم باشد.';
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = Number(card[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? null : 'شماره کارت درست نیست؛ رقم‌ها را دوباره ببینید.';
}

/** An Iranian IBAN (شبا): IR and 24 digits with a valid ISO 7064 check; '' is allowed (no IBAN) */
export function ibanError(raw: string): string | null {
  const iban = normalizeIban(raw);
  if (!iban) return null;
  if (!/^IR\d{24}$/.test(iban)) return 'شماره شبا باید IR و ۲۴ رقم باشد.';
  const rearranged = `${iban.slice(4)}1827${iban.slice(2, 4)}`; // I = 18, R = 27
  let remainder = 0;
  for (const ch of rearranged) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1 ? null : 'شماره شبا درست نیست؛ رقم‌ها را دوباره ببینید.';
}

/**
 * The shop's WhatsApp number in the international form wa.me needs (98 and the 10 digits of a mobile): «09…», «+98…»,
 * «0098…» and Persian digits are read; '' is allowed (no number)
 */
export function normalizeWhatsappNumber(raw: string): string {
  const digits = digitsOnly(raw).replace(/^\+/, '');
  if (!digits) return '';
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^0098\d{10}$/.test(digits)) return digits.slice(2);
  return digits;
}

export function whatsappNumberError(raw: string): string | null {
  const number = normalizeWhatsappNumber(raw);
  if (!number) return null;
  return /^989\d{9}$/.test(number) ? null : 'شماره واتس‌اپ باید شماره همراه باشد، مانند ۰۹۱۲۳۴۵۶۷۸۹.';
}

export function normalizeIban(raw: string): string {
  const text = digitsOnly(raw).toUpperCase();
  if (!text) return '';
  return text.startsWith('IR') ? text : `IR${text}`;
}

export const SHIPPING_PRICING = ['flat', 'table', 'on_delivery', 'free'] as const;
export type ShippingPricing = typeof SHIPPING_PRICING[number];
export const SHIPPING_PRICING_TITLES: Readonly<Record<ShippingPricing, string>> = {
  flat: 'نرخ ثابت',
  table: 'بر اساس وزن و استان',
  on_delivery: 'پرداخت خریدار در محل',
  free: 'رایگان',
};
export const isShippingPricing = (value: unknown): value is ShippingPricing => SHIPPING_PRICING.includes(value as ShippingPricing);

/** The 31 provinces, the names a table row of a weight and province priced method may take ('' = every other one) */
export const IRAN_PROVINCES = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام', 'بوشهر', 'تهران', 'چهارمحال و بختیاری',
  'خراسان جنوبی', 'خراسان رضوی', 'خراسان شمالی', 'خوزستان', 'زنجان', 'سمنان', 'سیستان و بلوچستان', 'فارس', 'قزوین',
  'قم', 'کردستان', 'کرمان', 'کرمانشاه', 'کهگیلویه و بویراحمد', 'گلستان', 'گیلان', 'لرستان', 'مازندران', 'مرکزی',
  'هرمزگان', 'همدان', 'یزد',
] as const;
export const isProvince = (value: string): boolean => value === '' || (IRAN_PROVINCES as readonly string[]).includes(value);

export type StockStatus = 'in_stock' | 'low' | 'out';
export const STOCK_STATUS_TITLES: Readonly<Record<StockStatus, string>> = { in_stock: 'موجود', low: 'تعداد کم', out: 'ناموجود' };

/** What the site shows for a sellable quantity; a threshold of 0 never reads «تعداد کم» (start plan decision 4) */
export function stockStatusOf(sellable: number, lowThreshold: number = LOW_STOCK_THRESHOLD_DEFAULT): StockStatus {
  if (!(sellable > 0)) return 'out';
  return sellable <= lowThreshold ? 'low' : 'in_stock';
}

/** Whether the site shows only the status, or the status and the number of units (decision 4, configurable) */
export const STOCK_DISPLAYS = ['status', 'count'] as const;
export type StockDisplay = typeof STOCK_DISPLAYS[number];
export const STOCK_DISPLAY_TITLES: Readonly<Record<StockDisplay, string>> = {
  status: 'فقط وضعیت (موجود، تعداد کم، ناموجود)',
  count: 'وضعیت و تعداد موجود',
};
export const isStockDisplay = (value: unknown): value is StockDisplay => STOCK_DISPLAYS.includes(value as StockDisplay);

/** The whole units a buyer may put in the cart: the sellable quantity rounded down, never below zero */
export function maxOrderQuantity(sellable: number): number {
  return Number.isFinite(sellable) && sellable > 0 ? Math.floor(sellable) : 0;
}

/** Why an item cannot be published, or null (start plan decision 3: no retail price, no publication) */
export type PublishBlocker = 'not_product' | 'no_retail_price' | 'retail_list_unset';
export const PUBLISH_BLOCKER_MESSAGES: Readonly<Record<PublishBlocker, string>> = {
  not_product: 'فقط «محصول نهایی» روی سایت منتشر می‌شود.',
  no_retail_price: 'این کالا در لیست قیمت تکی سایت قیمت ریالی ندارد.',
  retail_list_unset: 'لیست قیمت تکی سایت در تنظیمات «فروشگاه سایت» انتخاب نشده است.',
};

/** A whole rial amount as plain digits (Persian digits and thousands separators read), or null; zero only when allowed */
export function rialAmountText(value: unknown, options: { allowZero: boolean }): string | null {
  const text = typeof value === 'number' ? (Number.isSafeInteger(value) ? String(value) : '') : typeof value === 'string' ? normalizeGroupedDecimalString(value) : '';
  if (!/^\d{1,14}$/.test(text)) return null;
  const clean = text.replace(/^0+(?=\d)/, '');
  if (clean === '0' && !options.allowZero) return null;
  return clean;
}

/** A rate row as the quote reads it: '' province = every other one, null weight = no upper bound, rate in whole rials */
export interface ShippingRateRule {
  province: string;
  maxWeightGrams: number | null;
  rate: string;
}

export interface ShippingMethodRule {
  pricing: ShippingPricing;
  flatRate: string;
  isFreeShippingEligible: boolean;
  rates: readonly ShippingRateRule[];
}

/** What a method costs a cart: an amount, «the buyer pays the courier», or not offered to this address and weight */
export type ShippingQuote = { kind: 'cost'; amount: string; free: boolean } | { kind: 'on_delivery' } | { kind: 'unavailable' };

/**
 * The cost of one method for a cart (whole rials as digit strings, compared as BigInt, never as a float): a table row of the
 * buyer's province wins over the '' row; among the rows of that province the lightest bound that holds the weight wins.
 * An eligible method is free when the threshold is set and the cart reaches it.
 */
export function shippingQuote(method: ShippingMethodRule, cart: { province: string; weightGrams: number; subtotal: string }, freeThreshold: string): ShippingQuote {
  if (method.pricing === 'on_delivery') return { kind: 'on_delivery' };
  let amount: string;
  if (method.pricing === 'free') amount = '0';
  else if (method.pricing === 'flat') amount = method.flatRate;
  else {
    const fits = (row: ShippingRateRule) => row.maxWeightGrams === null || cart.weightGrams <= row.maxWeightGrams;
    const lightest = (rows: ShippingRateRule[]) => rows.filter(fits)
      .sort((a, b) => (a.maxWeightGrams ?? Number.MAX_SAFE_INTEGER) - (b.maxWeightGrams ?? Number.MAX_SAFE_INTEGER))[0];
    const row = (cart.province ? lightest(method.rates.filter(r => r.province === cart.province)) : undefined)
      ?? lightest(method.rates.filter(r => r.province === ''));
    if (!row) return { kind: 'unavailable' };
    amount = row.rate;
  }
  const reached = method.isFreeShippingEligible && freeThreshold !== '' && BigInt(cart.subtotal || '0') >= BigInt(freeThreshold);
  return reached ? { kind: 'cost', amount: '0', free: true } : { kind: 'cost', amount, free: amount === '0' };
}

/** v11 phase 8.3: the site's logo and browser icon, kept as data URLs in the settings (owner: changeable in the settings) */
export const BRAND_IMAGE_KINDS = ['logo', 'favicon'] as const;
export type BrandImageKind = typeof BRAND_IMAGE_KINDS[number];
export const BRAND_IMAGE_TITLES: Readonly<Record<BrandImageKind, string>> = { logo: 'لوگوی سایت', favicon: 'آیکون مرورگر' };
export const BRAND_IMAGE_MAX_BYTES: Readonly<Record<BrandImageKind, number>> = { logo: 300 * 1024, favicon: 100 * 1024 };
const BRAND_IMAGE_TYPES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] as const;
const DATA_URL = /^data:(image\/(?:svg\+xml|png|webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;
/**
 * What an SVG may not hold (it is shown only as an image and served sandboxed; this is defence in depth): scripts and
 * other active or outside elements, with or without a namespace prefix; animation, which can rewrite a link; event
 * handlers; character references and entity definitions, which can hide any of these; style that loads anything; and a
 * link (`href` or `xlink:href`) to anything but a fragment of the same file or an embedded bitmap.
 */
const SVG_UNSAFE = new RegExp([
  String.raw`<\s*(?:[\w.-]+:)?(?:script|foreignobject|iframe|embed|object|handler|listener|animate\w*|set)\b`,
  String.raw`\s(?:[\w.-]+:)?on[a-z]+\s*=`,
  String.raw`javascript\s*:`,
  String.raw`&#`,
  String.raw`<!\s*entity`,
  String.raw`<!\s*doctype[^>]*\[`,
  String.raw`@import`,
  String.raw`url\(\s*["']?\s*(?!#)`,
  String.raw`(?:^|[\s"'])(?:[\w.-]+:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|webp|gif);)`,
].join('|'), 'i');

/** The first bytes each bitmap type must start with (the declared type of the data URL is not trusted) */
function rasterTypeMatches(type: string, head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (type === 'image/png') return head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  if (type === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === 'image/webp') return head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return false;
}

/** An SVG as text, or null when it is not plain UTF-8 (a UTF-16 file or a NUL byte would slip past the text checks) */
function svgText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function parseBrandImage(dataUrl: string): { type: typeof BRAND_IMAGE_TYPES[number]; base64: string } | null {
  const match = DATA_URL.exec(dataUrl);
  return match ? { type: match[1] as typeof BRAND_IMAGE_TYPES[number], base64: match[2] } : null;
}

/** The decoded size of a base64 text, without decoding it */
export const base64Bytes = (base64: string): number => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

/**
 * '' (no image) is allowed; anything else must be a small SVG, PNG, WEBP or JPEG data URL whose bytes are that type,
 * and an SVG without active content. `decodeBytes` turns base64 into bytes (Buffer on the server, atob in the browser).
 */
export function brandImageError(dataUrl: string, kind: BrandImageKind, decodeBytes: (base64: string) => Uint8Array): string | null {
  if (dataUrl === '') return null;
  const parsed = parseBrandImage(dataUrl);
  if (!parsed) return 'فایل باید تصویر SVG، PNG، WEBP یا JPG باشد.';
  if (base64Bytes(parsed.base64) > BRAND_IMAGE_MAX_BYTES[kind]) {
    return `${BRAND_IMAGE_TITLES[kind]} حداکثر ${Math.round(BRAND_IMAGE_MAX_BYTES[kind] / 1024)} کیلوبایت است.`.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  }
  const bytes = decodeBytes(parsed.base64);
  if (parsed.type !== 'image/svg+xml') {
    return rasterTypeMatches(parsed.type, bytes) ? null : 'محتوای این فایل با نوع تصویرش جور نیست؛ آن را دوباره به PNG، WEBP یا JPG ذخیره کنید.';
  }
  const text = svgText(bytes);
  if (text === null || SVG_UNSAFE.test(text)) {
    return 'این فایل SVG کد یا پیوند بیرونی دارد؛ آن را بدون اسکریپت دوباره ذخیره کنید یا PNG بفرستید.';
  }
  return null;
}
