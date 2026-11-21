import { toLatinDigits } from '../numericInput.js';
import { normalizeEmail } from './storefrontEmailRules.js';

/**
 * v12 phase 10a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decisions 18 and 23): the rules of «اطلاعات
 * فروشگاه», shared by the ERP server, the ERP's «کالاها و تنظیمات سایت» and the storefront app. Nothing here reads the
 * database. The brand's name and motto, the footer's texts and the shop's contact details were fixed in the site's code
 * until this phase; an empty field keeps the value the site had (`SHOP_INFO_DEFAULTS`), so nothing changes on the site
 * until the owner writes something.
 */

/** What the site showed before this phase, and still shows for a field left empty */
export const SHOP_INFO_DEFAULTS = {
  brandName: 'پاپیتال',
  brandFullName: 'گالری پاپیتال',
  brandTagline: 'زیورآلات دست‌ساز با نقش کاشی‌های ایران',
  footerNote: 'ساخت دست، در کارگاه پاپیتال در تهران.',
  instagram: 'https://www.instagram.com/papital.gallery/',
  shippingTitle: 'ارسال و پرداخت',
  alternateSiteLabel: 'وبسایت ما در اروپا',
} as const;

/** The footer's last line while «متن حق نشر» is empty: the words the site had, with the brand's full name of now */
export const defaultCopyright = (brandFullName: string): string => `همهٔ حقوق برای ${brandFullName} محفوظ است.`;

export const SHOP_SOCIALS = ['instagram', 'telegram', 'youtube', 'aparat', 'linkedin'] as const;
export type ShopSocial = typeof SHOP_SOCIALS[number];
export const SHOP_SOCIAL_TITLES: Readonly<Record<ShopSocial, string>> = {
  instagram: 'اینستاگرام',
  telegram: 'تلگرام',
  youtube: 'یوتیوب',
  aparat: 'آپارات',
  linkedin: 'لینکدین',
};

export const SHOP_LINK_MAX = 300;
export const SHOP_SHIPPING_LINES_MAX = 6;
export const SHOP_SHIPPING_LINE_MAX = 120;
export const SHOP_POSTAL_CODE_LENGTH = 10;

/** The one-line text fields and the most characters each takes */
export const SHOP_TEXT_MAX = {
  brandName: 40,
  brandFullName: 60,
  brandTagline: 120,
  footerNote: 200,
  address: 300,
  hours: 120,
  copyright: 200,
  shippingTitle: 40,
  alternateSiteLabel: 60,
} as const;
export type ShopTextField = keyof typeof SHOP_TEXT_MAX;
const TEXT_FIELDS = Object.keys(SHOP_TEXT_MAX) as ShopTextField[];

const SHOP_TEXT_TITLES: Readonly<Record<ShopTextField, string>> = {
  brandName: 'نام کوتاه برند',
  brandFullName: 'نام کامل برند',
  brandTagline: 'شعار برند',
  footerNote: 'متن کوتاه پاورقی',
  address: 'نشانی',
  hours: 'ساعت پاسخ‌گویی',
  copyright: 'متن حق نشر',
  shippingTitle: 'عنوان ستون ارسال و پرداخت',
  alternateSiteLabel: 'نوشتهٔ پیوند سایت زبان دیگر',
};

export interface ShopInfoValues {
  brandName: string;
  brandFullName: string;
  brandTagline: string;
  /** the sentence after the motto under the footer's logo */
  footerNote: string;
  address: string;
  /** ten digits */
  postalCode: string;
  /** the landline, digits with an optional leading «+» */
  phone: string;
  mobile: string;
  email: string;
  hours: string;
  instagram: string;
  telegram: string;
  youtube: string;
  aparat: string;
  linkedin: string;
  copyright: string;
  shippingTitle: string;
  /** the lines of the footer's «ارسال و پرداخت» column, one per line; '' keeps the site's own lines */
  shippingText: string;
  /** the words of the footer's link to the brand's site in another language («جست‌وجو و آمار بازدید» holds its address) */
  alternateSiteLabel: string;
  /** the e-namad seal: the address its picture links to and the address of the picture; both or neither */
  enamadLinkUrl: string;
  enamadImageUrl: string;
  /** the floating WhatsApp button, with the number of «سفارش در واتس‌اپ» */
  whatsappFloat: boolean;
}

export type ShopInfoField = keyof ShopInfoValues;

// Control characters, the line and paragraph separators and the direction overrides (which could turn a name around in a
// browser tab); the zero-width non-joiner of Persian words is not one of them
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** One line of text as it is kept: trimmed, with runs of spaces as one */
const oneLine = (value: string): string => value.replace(/[ \t ]+/g, ' ').trim();

/**
 * A host name of letters, digits and hyphens in dot-separated labels, and nothing else. `new URL` also takes «;», «,»,
 * «*», quotes and «=» in a host; the site writes the seal's host into its security policy header, where «;» ends a
 * directive, «,» ends the policy and «*» is a wildcard, so none of them is ever a host here (10a review).
 */
const PLAIN_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const isPlainHost = (hostname: string): boolean => hostname.length <= 253 && PLAIN_HOST.test(hostname);

/**
 * An address outside the site that a page may link to or load a picture from: https, a plain host with a dot, no user,
 * no port and no fragment, at most `SHOP_LINK_MAX` characters. '' stays ''; anything else is null.
 */
export function httpsLink(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  if (text.length > SHOP_LINK_MAX || CONTROL.test(text) || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
  if (!isPlainHost(url.hostname)) return null;
  return url.href.length > SHOP_LINK_MAX ? null : url.href;
}

const ENAMAD_HOST = /(^|\.)enamad\.ir$/;

/**
 * An address of the e-namad seal (its page or its picture): an `httpsLink` on enamad.ir or one of its hosts. The site
 * adds the picture's host to its security policy, so no other host is ever taken here.
 */
export function enamadUrl(value: string): string | null {
  const link = httpsLink(value);
  if (!link) return link;
  return ENAMAD_HOST.test(new URL(link).hostname) ? link : null;
}

/**
 * The shop's email as a page may link to it (`mailto:`): an address whose part before «@» is only letters, digits, «.»,
 * «_», «+» and «-», so it can carry no «?subject=…» or other field of a mail link. '' stays ''; null otherwise.
 */
export function shopEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.trim()) return '';
  const email = normalizeEmail(value);
  return email && /^[A-Za-z0-9._+-]+@/.test(email) ? email : null;
}

/** A phone number as it is kept: Latin digits with an optional leading «+»; '' stays ''; null when it is not a number */
export function shopPhone(value: string): string | null {
  const text = toLatinDigits(value).replace(/[\s\-().\u200c]/g, '');
  if (!text) return '';
  return /^\+?\d{5,15}$/.test(text) ? text : null;
}

/** A postal code as it is kept: ten Latin digits; '' stays ''; null otherwise */
export function shopPostalCode(value: string): string | null {
  const text = toLatinDigits(value).replace(/[\s\-\u200c]/g, '');
  if (!text) return '';
  return new RegExp(`^\\d{${SHOP_POSTAL_CODE_LENGTH}}$`).test(text) ? text : null;
}

/** The lines of «متن ستون ارسال و پرداخت» as the footer lists them: trimmed, without the empty ones */
export function shippingLines(text: string): string[] {
  return text.split(/\r?\n/).map(oneLine).filter(Boolean);
}

const fa = (n: number) => n.toLocaleString('fa-IR');

/** The first problem of an «اطلاعات فروشگاه» form, as the field and the message; null when it is valid */
export function shopInfoError(raw: ShopInfoValues): { field: ShopInfoField; message: string } | null {
  for (const field of TEXT_FIELDS) {
    const text = oneLine(raw[field]);
    if (CONTROL.test(text)) return { field, message: `«${SHOP_TEXT_TITLES[field]}» یک خط متن ساده است.` };
    if (text.length > SHOP_TEXT_MAX[field]) return { field, message: `«${SHOP_TEXT_TITLES[field]}» حداکثر ${fa(SHOP_TEXT_MAX[field])} نویسه است.` };
  }
  if (shopPostalCode(raw.postalCode) === null) return { field: 'postalCode', message: `کد پستی ${fa(SHOP_POSTAL_CODE_LENGTH)} رقم است.` };
  if (shopPhone(raw.phone) === null) return { field: 'phone', message: 'تلفن ثابت فقط رقم است، با کد شهر، مانند ۰۲۱۱۲۳۴۵۶۷۸.' };
  if (shopPhone(raw.mobile) === null) return { field: 'mobile', message: 'شمارهٔ همراه فقط رقم است، مانند ۰۹۱۲۱۲۳۴۵۶۷.' };
  if (shopEmail(raw.email) === null) return { field: 'email', message: 'ایمیل درست نیست، مانند info@example.com.' };
  for (const social of SHOP_SOCIALS) {
    if (httpsLink(raw[social]) === null) {
      return { field: social, message: `نشانی ${SHOP_SOCIAL_TITLES[social]} باید با https:// آغاز شود و حداکثر ${fa(SHOP_LINK_MAX)} نویسه باشد.` };
    }
  }
  if (CONTROL_BUT_NEWLINE.test(raw.shippingText)) return { field: 'shippingText', message: 'متن ستون ارسال و پرداخت متن ساده است، هر نکته در یک خط.' };
  const lines = shippingLines(raw.shippingText);
  if (lines.length > SHOP_SHIPPING_LINES_MAX) return { field: 'shippingText', message: `ستون ارسال و پرداخت حداکثر ${fa(SHOP_SHIPPING_LINES_MAX)} خط می‌گیرد.` };
  if (lines.some(line => line.length > SHOP_SHIPPING_LINE_MAX)) {
    return { field: 'shippingText', message: `هر خط ستون ارسال و پرداخت حداکثر ${fa(SHOP_SHIPPING_LINE_MAX)} نویسه است.` };
  }
  const enamadMessage = 'نشانی نماد باید با https:// آغاز شود و روی enamad.ir باشد، مانند https://trustseal.enamad.ir/….';
  if (enamadUrl(raw.enamadLinkUrl) === null) return { field: 'enamadLinkUrl', message: enamadMessage };
  if (enamadUrl(raw.enamadImageUrl) === null) return { field: 'enamadImageUrl', message: enamadMessage };
  if (Boolean(raw.enamadLinkUrl.trim()) !== Boolean(raw.enamadImageUrl.trim())) {
    return {
      field: raw.enamadLinkUrl.trim() ? 'enamadImageUrl' : 'enamadLinkUrl',
      message: 'برای نماد، هم نشانی پیوند و هم نشانی تصویر لازم است؛ یا هر دو را خالی بگذارید.',
    };
  }
  return null;
}

/** The values as they are saved (after `shopInfoError` passed) */
export function normalizedShopInfo(values: ShopInfoValues): ShopInfoValues {
  return {
    brandName: oneLine(values.brandName),
    brandFullName: oneLine(values.brandFullName),
    brandTagline: oneLine(values.brandTagline),
    footerNote: oneLine(values.footerNote),
    address: oneLine(values.address),
    postalCode: shopPostalCode(values.postalCode) ?? '',
    phone: shopPhone(values.phone) ?? '',
    mobile: shopPhone(values.mobile) ?? '',
    email: shopEmail(values.email) ?? '',
    hours: oneLine(values.hours),
    instagram: httpsLink(values.instagram) ?? '',
    telegram: httpsLink(values.telegram) ?? '',
    youtube: httpsLink(values.youtube) ?? '',
    aparat: httpsLink(values.aparat) ?? '',
    linkedin: httpsLink(values.linkedin) ?? '',
    copyright: oneLine(values.copyright),
    shippingTitle: oneLine(values.shippingTitle),
    shippingText: shippingLines(values.shippingText).join('\n'),
    alternateSiteLabel: oneLine(values.alternateSiteLabel),
    enamadLinkUrl: enamadUrl(values.enamadLinkUrl) ?? '',
    enamadImageUrl: enamadUrl(values.enamadImageUrl) ?? '',
    whatsappFloat: values.whatsappFloat === true,
  };
}

/** A line of text the site may write into a page as the ERP sent it: a string, one line, within its length; '' otherwise */
export function safeShopText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = oneLine(value);
  return text.length > max || CONTROL.test(text) ? '' : text;
}
