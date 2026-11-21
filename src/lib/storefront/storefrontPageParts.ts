import { isSafeSitePath } from './storefrontSeoRules.js';
import { httpsLink } from './storefrontShopInfoRules.js';

/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decisions 4, 23 and 24): the rules of «صفحه‌های
 * سایت», shared by the ERP server, the ERP's page builder and (from 10c) the storefront app. Nothing here reads the
 * database.
 *
 * A page is an ordered list of «بخش» (sections) of a fixed set of kinds; there is no free HTML and no script, ever. A
 * section's text is the JSON of the Tiptap editor, and only the nodes and marks named here are taken: anything else is
 * refused with a message that names it, never dropped in silence. An image is always a file of the media library, named
 * by its id (never an address), and a link is a path of this site or an https address, as in the menus.
 *
 * A draft may be unfinished (a section still without its image, a card still without a title): what makes a page unsafe
 * is refused on every save, what only makes it unfinished is refused when it is published.
 */

export const PAGE_KINDS = ['base', 'custom'] as const;
export type PageKind = typeof PAGE_KINDS[number];
export const isPageKind = (value: unknown): value is PageKind => PAGE_KINDS.includes(value as PageKind);

/** The five pages every shop needs. They are never removed and keep their address; the migration makes them, unpublished. */
export const BASE_PAGES = [
  { slug: 'about', title: 'درباره ما' },
  { slug: 'contact', title: 'تماس با ما' },
  { slug: 'shipping', title: 'ارسال و پرداخت' },
  { slug: 'terms', title: 'قوانین خرید' },
  { slug: 'privacy', title: 'حریم خصوصی' },
] as const;
export type BasePageSlug = typeof BASE_PAGES[number]['slug'];

export const PAGE_SLUG_MAX = 60;
export const PAGE_TITLE_MAX = 120;
export const PAGE_SEO_TITLE_MAX = 200;
export const PAGE_SEO_DESCRIPTION_MAX = 400;
export const PAGE_SECTIONS_MAX = 30;
export const PAGES_MAX = 200;

export const SECTION_BACKGROUNDS = ['white', 'cream', 'brand', 'dark'] as const;
export type SectionBackground = typeof SECTION_BACKGROUNDS[number];
export const SECTION_BACKGROUND_TITLES: Readonly<Record<SectionBackground, string>> = { white: 'سفید', cream: 'کرم', brand: 'زرد برند', dark: 'تیره' };

export const SECTION_KINDS = ['hero', 'text', 'textImage', 'iconCards', 'gallery', 'people', 'map', 'products', 'button', 'shippingMethods'] as const;
export type SectionKind = typeof SECTION_KINDS[number];
export const SECTION_KIND_TITLES: Readonly<Record<SectionKind, string>> = {
  hero: 'سربرگ',
  text: 'متن',
  textImage: 'متن و تصویر',
  iconCards: 'کارت‌های آیکون‌دار',
  gallery: 'گالری تصاویر',
  people: 'کارت افراد',
  map: 'نقشه',
  products: 'ردیف محصولات',
  button: 'دکمه',
  shippingMethods: 'روش‌ها و هزینهٔ ارسال',
};
/** the kind that reads the live shipping settings belongs to the «ارسال و پرداخت» page alone */
export const SHIPPING_SECTION_PAGE: BasePageSlug = 'shipping';

export const PAGE_ICONS = ['leaf', 'handshake', 'truck', 'gift', 'heart', 'sparkles', 'clock', 'map', 'phone', 'mail', 'shield', 'star'] as const;
export type PageIcon = typeof PAGE_ICONS[number];
export const PAGE_ICON_TITLES: Readonly<Record<PageIcon, string>> = {
  leaf: 'برگ', handshake: 'دست دادن', truck: 'ارسال', gift: 'هدیه', heart: 'قلب', sparkles: 'درخشش', clock: 'ساعت', map: 'نشانی', phone: 'تلفن',
  mail: 'نامه', shield: 'سپر', star: 'ستاره',
};

/** The colours a word of a text may take: names, never a colour code, so the site keeps its own palette */
export const TEXT_COLORS = ['brand', 'accent', 'muted', 'danger'] as const;
export type TextColor = typeof TEXT_COLORS[number];
export const TEXT_COLOR_TITLES: Readonly<Record<TextColor, string>> = { brand: 'لاجوردی', accent: 'زرد', muted: 'خاکستری', danger: 'قرمز' };
export const TEXT_ALIGNS = ['right', 'center', 'left', 'justify'] as const;
export type TextAlign = typeof TEXT_ALIGNS[number];

export const SECTION_TITLE_MAX = 120;
export const SECTION_TEXT_MAX = 400;
export const BUTTON_LABEL_MAX = 40;
export const LINK_MAX = 300;
export const CARD_TITLE_MAX = 60;
export const CARD_TEXT_MAX = 300;
export const ICON_CARDS_MIN = 2;
export const ICON_CARDS_MAX = 4;
export const GALLERY_MIN = 2;
export const GALLERY_MAX = 12;
export const IMAGE_ALT_MAX = 120;
export const PEOPLE_MAX = 8;
export const PERSON_NAME_MAX = 60;
export const PERSON_ROLE_MAX = 80;
export const PERSON_CONTACT_MAX = 120;
export const MAP_ADDRESS_MAX = 300;
export const PRODUCT_ROW_MAX = 8;
export const COLLECTION_NAME_MAX = 120;

/** A text of the editor: at most this many characters and nodes, nested this deep */
export const RICH_TEXT_CHARS_MAX = 20_000;
export const RICH_TEXT_NODES_MAX = 2_000;
export const RICH_TEXT_DEPTH_MAX = 8;
export const RICH_TEXT_HEADING_LEVELS = [2, 3, 4] as const;
export const RICH_TEXT_TABLE_COLUMNS_MAX = 6;
export const RICH_TEXT_TABLE_ROWS_MAX = 30;

export interface RichMark {
  type: 'bold' | 'italic' | 'underline' | 'textColor' | 'link';
  attrs?: { color?: TextColor; href?: string };
}
export interface RichNode {
  type: string;
  attrs?: Record<string, string | number | null>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
}
export interface RichDoc {
  type: 'doc';
  content: RichNode[];
}
export const EMPTY_DOC: RichDoc = { type: 'doc', content: [] };

interface SectionBase { background: SectionBackground }
export interface HeroSection extends SectionBase { kind: 'hero'; title: string; text: string; imageAssetId: number | null; buttonLabel: string; buttonHref: string }
export interface TextSection extends SectionBase { kind: 'text'; doc: RichDoc }
export interface TextImageSection extends SectionBase {
  kind: 'textImage'; title: string; doc: RichDoc; imageAssetId: number | null; imageAlt: string; imageSide: 'right' | 'left'; buttonLabel: string; buttonHref: string;
}
export interface IconCard { icon: PageIcon; title: string; text: string }
export interface IconCardsSection extends SectionBase { kind: 'iconCards'; title: string; cards: IconCard[] }
export interface GalleryImage { assetId: number; alt: string }
export interface GallerySection extends SectionBase { kind: 'gallery'; title: string; images: GalleryImage[] }
export interface Person { imageAssetId: number | null; name: string; role: string; contact: string }
export interface PeopleSection extends SectionBase { kind: 'people'; title: string; people: Person[] }
export interface MapSection extends SectionBase {
  kind: 'map'; title: string; imageAssetId: number | null; address: string; neshanUrl: string; baladUrl: string; googleUrl: string;
}
export interface ProductsSection extends SectionBase { kind: 'products'; title: string; source: 'items' | 'collection'; itemIds: number[]; collection: string }
export interface ButtonSection extends SectionBase { kind: 'button'; label: string; href: string }
export interface ShippingMethodsSection extends SectionBase { kind: 'shippingMethods'; title: string }
export type PageSection =
  | HeroSection | TextSection | TextImageSection | IconCardsSection | GallerySection | PeopleSection | MapSection | ProductsSection | ButtonSection
  | ShippingMethodsSection;

export interface PageValues {
  title: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  noindex: boolean;
  shareImageAssetId: number | null;
  sections: PageSection[];
}

export interface PageProblem {
  /** the field of the page, or «sections» */
  field: string;
  /** the section the problem is in, from 0; -1 for the page itself */
  section: number;
  message: string;
  code: string;
}

export const fa = (n: number) => n.toLocaleString('fa-IR');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
export const CONTROL_IN_RICH_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const oneLine = (value: string): string => value.replace(/[ \t\u00a0]+/g, ' ').trim();
export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;

export class Refused extends Error {
  constructor(message: string, readonly code: string, readonly field = 'sections') {
    super(message);
  }
}
export const refuse = (message: string, code: string, field?: string): never => {
  throw new Refused(message, code, field);
};

/**
 * A link of a page: a path of this site (one «/» first, no «//», no space or control character) or an https address on
 * a plain host; '' stays ''. Anything else (`javascript:`, `http:`, `data:`, `//host`, a mail or phone link) is null.
 */
export function pageLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return '';
  if (text.length > LINK_MAX) return null;
  if (text.startsWith('/')) return isSafeSitePath(text) ? text : null;
  return httpsLink(text);
}

export function text(value: unknown, max: number, title: string): string {
  if (typeof value !== 'string') return refuse(`«${title}» باید متن باشد.`, 'STOREFRONT_PAGE_FIELD_INVALID');
  const kept = oneLine(value);
  if (CONTROL.test(kept)) return refuse(`«${title}» یک خط متن ساده است.`, 'STOREFRONT_PAGE_FIELD_INVALID');
  if (kept.length > max) return refuse(`«${title}» حداکثر ${fa(max)} نویسه است.`, 'STOREFRONT_PAGE_FIELD_TOO_LONG');
  return kept;
}

export function link(value: unknown, title: string): string {
  const kept = pageLink(value);
  if (kept === null) {
    return refuse(`«${title}» باید مسیری از همین سایت باشد که با «/» آغاز می‌شود، یا نشانی‌ای که با https:// آغاز می‌شود.`, 'STOREFRONT_PAGE_LINK_INVALID');
  }
  return kept;
}

export function assetId(value: unknown, title: string): number | null {
  if (value === null || value === undefined) return null;
  if (!isId(value)) return refuse(`«${title}» باید عکسی از کتابخانهٔ تصاویر باشد.`, 'STOREFRONT_PAGE_IMAGE_INVALID');
  return value;
}

export function oneOf<T extends string>(value: unknown, list: readonly T[], title: string): T {
  if (typeof value !== 'string' || !list.includes(value as T)) return refuse(`«${title}» شناخته نیست.`, 'STOREFRONT_PAGE_FIELD_INVALID');
  return value as T;
}

export function list(value: unknown, max: number, title: string): unknown[] {
  if (!Array.isArray(value)) return refuse(`«${title}» باید فهرست باشد.`, 'STOREFRONT_PAGE_FIELD_INVALID');
  if (value.length > max) return refuse(`«${title}» حداکثر ${fa(max)} مورد می‌گیرد.`, 'STOREFRONT_PAGE_TOO_MANY');
  return value;
}

/** Only the named keys of an object: an unknown key is refused by name, so nothing rides along unseen */
export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) refuse(`${where} فیلد ناشناختهٔ «${extra.slice(0, 40)}» دارد.`, 'STOREFRONT_PAGE_FIELD_UNKNOWN');
}
