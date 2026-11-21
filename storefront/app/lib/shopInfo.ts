import { normalizeEmail } from '@erp/storefront/storefrontEmailRules';
import {
  SHOP_INFO_DEFAULTS, SHOP_SHIPPING_LINES_MAX, SHOP_SHIPPING_LINE_MAX, SHOP_SOCIALS, SHOP_SOCIAL_TITLES, SHOP_TEXT_MAX, defaultCopyright, enamadUrl, httpsLink,
  safeShopText, shopPhone, shopPostalCode, type ShopSocial,
} from '@erp/storefront/storefrontShopInfoRules';

/**
 * v12 phase 10a (start plan V12_SITE_NEXT_START_PLAN.md §7.2, owner's decision 23): what the pages show of the shop
 * itself, from the ERP's «اطلاعات فروشگاه». A field the owner left empty keeps the words the site always had
 * (`SHOP_INFO_DEFAULTS`), and so does everything when the ERP cannot be read. The site takes nothing on trust: a text
 * that is not one line within its length, an address that is not https (the seal's: not on enamad.ir), a number that is
 * not digits, are read as empty.
 */
export interface SiteBrand {
  name: string;
  fullName: string;
  tagline: string;
}

export interface SiteShop {
  brand: SiteBrand;
  footerNote: string;
  contact: { address: string; postalCode: string; phone: string; mobile: string; email: string; hours: string };
  /** the social pages to link to, in a fixed order; Instagram is always there (the owner's, or the one the site had) */
  social: Array<{ name: ShopSocial; title: string; href: string }>;
  /** the Instagram page's name as visitors know it ('' when the address has none) */
  instagramHandle: string;
  copyright: string;
  /** `lines` empty = the footer's own lines */
  shipping: { title: string; lines: string[] };
  alternateSiteLabel: string;
  enamad: { linkUrl: string; imageUrl: string } | null;
  /** the shop's WhatsApp number while the floating button is on; '' = no button */
  whatsappFloat: string;
}

const text = (value: unknown, max: number, fallback = ''): string => safeShopText(value, max) || fallback;
const link = (value: unknown): string => (typeof value === 'string' ? httpsLink(value) ?? '' : '');
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function handleOf(instagram: string): string {
  const first = new URL(instagram).pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first : '';
}

/** The ERP's answer as the pages may use it; any other shape (or none) is the site's own words */
export function siteShop(raw: unknown): SiteShop {
  const v = record(raw);
  const [brand, contact, social, shipping, enamad] = [record(v.brand), record(v.contact), record(v.social), record(v.shipping), record(v.enamad)];
  const fullName = text(brand.fullName, SHOP_TEXT_MAX.brandFullName, SHOP_INFO_DEFAULTS.brandFullName);
  const pages = SHOP_SOCIALS.flatMap((name) => {
    const href = link(social[name]) || (name === 'instagram' ? SHOP_INFO_DEFAULTS.instagram : '');
    return href ? [{ name, title: SHOP_SOCIAL_TITLES[name], href }] : [];
  });
  const [sealLink, sealImage] = [enamad.linkUrl, enamad.imageUrl].map(u => (typeof u === 'string' ? enamadUrl(u) ?? '' : ''));
  const lines = Array.isArray(shipping.lines) ? shipping.lines.slice(0, SHOP_SHIPPING_LINES_MAX).flatMap(l => text(l, SHOP_SHIPPING_LINE_MAX) || []) : [];
  const float = typeof v.whatsappFloat === 'string' && /^\d{8,15}$/.test(v.whatsappFloat) ? v.whatsappFloat : '';
  return {
    brand: {
      name: text(brand.name, SHOP_TEXT_MAX.brandName, SHOP_INFO_DEFAULTS.brandName),
      fullName,
      tagline: text(brand.tagline, SHOP_TEXT_MAX.brandTagline, SHOP_INFO_DEFAULTS.brandTagline),
    },
    footerNote: text(v.footerNote, SHOP_TEXT_MAX.footerNote, SHOP_INFO_DEFAULTS.footerNote),
    contact: {
      address: text(contact.address, SHOP_TEXT_MAX.address),
      postalCode: typeof contact.postalCode === 'string' ? shopPostalCode(contact.postalCode) ?? '' : '',
      phone: typeof contact.phone === 'string' ? shopPhone(contact.phone) ?? '' : '',
      mobile: typeof contact.mobile === 'string' ? shopPhone(contact.mobile) ?? '' : '',
      email: normalizeEmail(contact.email),
      hours: text(contact.hours, SHOP_TEXT_MAX.hours),
    },
    social: pages,
    instagramHandle: handleOf(pages[0].href),
    copyright: text(v.copyright, SHOP_TEXT_MAX.copyright, defaultCopyright(fullName)),
    shipping: { title: text(shipping.title, SHOP_TEXT_MAX.shippingTitle, SHOP_INFO_DEFAULTS.shippingTitle), lines },
    alternateSiteLabel: text(v.alternateSiteLabel, SHOP_TEXT_MAX.alternateSiteLabel, SHOP_INFO_DEFAULTS.alternateSiteLabel),
    enamad: sealLink && sealImage ? { linkUrl: sealLink, imageUrl: sealImage } : null,
    whatsappFloat: float,
  };
}

/** The shop as the site knew it before «اطلاعات فروشگاه», and while the ERP cannot be read */
export const DEFAULT_SHOP: SiteShop = siteShop(null);
