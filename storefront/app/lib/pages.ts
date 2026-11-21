import type { StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import type {
  StorefrontPageImage, StorefrontPageSection, StorefrontPageSummary, StorefrontPublicPage,
} from '@erp/storefront/storefrontPagePublicContracts';
import {
  BASE_PAGES, PAGE_ICONS, PAGE_SLUG_MAX, RICH_TEXT_CHARS_MAX, RICH_TEXT_DEPTH_MAX, RICH_TEXT_NODES_MAX, SECTION_BACKGROUNDS, TEXT_ALIGNS, TEXT_COLORS, pageLink,
  type PageIcon, type RichDoc, type RichMark, type RichNode, type SectionBackground, type TextAlign, type TextColor,
} from '@erp/storefront/storefrontPageParts';

/**
 * v12 phase 10c (start plan V12_SITE_NEXT_START_PLAN.md §7.2): the pages of the ERP's «صفحه‌های سایت» as the site may
 * draw them. The site takes nothing on trust: a section of a kind it does not know, an image whose name is not a file
 * key and a link that is not a path of the site or an https address are left out, and every text is drawn as text. An
 * answer in another shape is no page, so the address keeps what it showed before (a base page's fixed text, or 404).
 */
export type SitePage = StorefrontPublicPage;
export type SitePageSection = StorefrontPageSection;
export type SitePageImage = StorefrontPageImage;

const PAGE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isPageSlug = (slug: string) => slug.length <= PAGE_SLUG_MAX && PAGE_SLUG.test(slug);
export const isBasePageSlug = (slug: string) => BASE_PAGES.some(page => page.slug === slug);
/** A base page lives at its own address, as before the ERP wrote it; a page the shop made lives under `/pages` */
export const pagePath = (page: { kind: string; slug: string }) => (page.kind === 'base' ? `/${page.slug}` : `/pages/${page.slug}`);

const FILE_KEY = /^[0-9a-f]{64}$/;
// control characters (a tab and a line break stay) and the characters that turn the direction of a line over
// eslint-disable-next-line no-control-regex
const UNSEEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const TURNS_LINE = /[\u202a-\u202e\u2066-\u2069]/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// half of a pair (an emoji cut in two, by the ERP or by the cut below): no address can be written from it
const LONE_HALF = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(UNSEEN, '').slice(0, max).replace(LONE_HALF, '') : '');
const side = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null);
const href = (value: unknown) => (typeof value === 'string' && TURNS_LINE.test(value) ? '' : pageLink(value) ?? '');
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
/** Nothing a visitor would see: empty, spaces, or only the joiners and marks that draw nothing */
export const isBlank = (value: string) => value.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '') === '';

export function pageImage(value: unknown): SitePageImage | null {
  if (!isRecord(value) || typeof value.sha256 !== 'string' || !FILE_KEY.test(value.sha256)) return null;
  return { sha256: value.sha256, width: side(value.width), height: side(value.height), alt: str(value.alt, 300), thumb: value.thumb === true || value.thumb === 1 };
}

const STOCK = ['in_stock', 'low', 'out'] as const;

/** A product card rebuilt from the fields the site draws, so a field the ERP never meant for it cannot ride along */
function card(value: unknown): StorefrontProductCard | null {
  // a product's address is lowercase Latin (the ERP's own rule), so nothing in it can lead out of `/p/`
  if (!isRecord(value) || typeof value.slug !== 'string' || !PAGE_SLUG.test(value.slug) || value.slug.length > 200 || typeof value.name !== 'string' || typeof value.retailPrice !== 'string') return null;
  const stock = isRecord(value.stock) ? value.stock : {};
  if (!STOCK.includes(stock.status as typeof STOCK[number])) return null;
  const cover = pageImage(value.cover);
  return {
    slug: str(value.slug, 200), sku: str(value.sku, 100), name: str(value.name, 300), category: str(value.category, 200),
    collections: list(value.collections, 30).flatMap(name => (typeof name === 'string' ? [str(name, 200)] : [])), retailPrice: str(value.retailPrice, 40),
    stock: { status: stock.status as typeof STOCK[number], quantity: typeof stock.quantity === 'number' && Number.isInteger(stock.quantity) && stock.quantity >= 0 ? stock.quantity : null },
    cover: cover ? { sha256: cover.sha256, width: cover.width, height: cover.height, alt: cover.alt, isCover: true } : null,
  };
}

/**
 * A text of the editor, rebuilt node by node from what the site draws: a node, mark or attribute it does not know is
 * left out, a link is checked again, and the whole is held to a size (twice the ERP's own limits, so a text the ERP
 * accepted always fits) and a depth. What is past the size is cut off; a page is never refused for it.
 */
const DOC_NODES_MAX = RICH_TEXT_NODES_MAX * 2;
const DOC_CHARS_MAX = RICH_TEXT_CHARS_MAX * 2;
/** the same as the ERP's own limit plus a margin; `RichText` draws to this depth too */
export const DOC_DEPTH_MAX = RICH_TEXT_DEPTH_MAX + 2;
const INLINE = ['text', 'hardBreak'] as const;
/** What each node may hold, as the ERP's own rules have it: a node anywhere else is left out, so what is kept is what is drawn */
const HOLDS: Readonly<Record<string, readonly string[]>> = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'libraryImage', 'table'],
  paragraph: INLINE, heading: INLINE, bulletList: ['listItem'], orderedList: ['listItem'], listItem: ['paragraph', 'bulletList', 'orderedList'],
  blockquote: ['paragraph'], table: ['tableRow'], tableRow: ['tableCell', 'tableHeader'], tableCell: ['paragraph'], tableHeader: ['paragraph'],
};
interface Budget { nodes: number; chars: number }

function marks(value: unknown): RichMark[] {
  const kept = new Map<string, RichMark>();
  for (const raw of list(value, 8)) {
    if (!isRecord(raw) || typeof raw.type !== 'string' || kept.has(raw.type)) continue;
    const attrs = isRecord(raw.attrs) ? raw.attrs : {};
    if (raw.type === 'bold' || raw.type === 'italic' || raw.type === 'underline') kept.set(raw.type, { type: raw.type });
    else if (raw.type === 'textColor' && TEXT_COLORS.includes(attrs.color as TextColor)) kept.set(raw.type, { type: 'textColor', attrs: { color: attrs.color as TextColor } });
    else if (raw.type === 'link' && href(attrs.href)) kept.set(raw.type, { type: 'link', attrs: { href: href(attrs.href) } });
  }
  return [...kept.values()];
}

function node(raw: unknown, allowed: readonly string[], depth: number, budget: Budget): RichNode | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !allowed.includes(raw.type) || budget.nodes >= DOC_NODES_MAX) return null;
  budget.nodes += 1;
  const attrs = isRecord(raw.attrs) ? raw.attrs : {};
  if (raw.type === 'text') {
    const text = str(raw.text, Math.max(0, DOC_CHARS_MAX - budget.chars));
    if (!text) return null;
    budget.chars += text.length;
    const kept = marks(raw.marks);
    return kept.length ? { type: 'text', text, marks: kept } : { type: 'text', text };
  }
  if (raw.type === 'hardBreak' || raw.type === 'horizontalRule') return { type: raw.type };
  if (raw.type === 'libraryImage') {
    const image = pageImage(attrs);
    return image ? { type: 'libraryImage', attrs: { sha256: image.sha256, width: image.width, height: image.height, alt: image.alt, thumb: image.thumb ? 1 : 0 } } : null;
  }
  // a block past the depth is left out whole (its words would otherwise be kept and never drawn)
  if (depth > DOC_DEPTH_MAX) return null;
  const kept: Record<string, string | number> = {};
  if (TEXT_ALIGNS.includes(attrs.textAlign as TextAlign) && (raw.type === 'paragraph' || raw.type === 'heading')) kept.textAlign = attrs.textAlign as TextAlign;
  if (raw.type === 'heading') kept.level = attrs.level === 2 || attrs.level === 3 ? attrs.level : 4;
  if (raw.type === 'orderedList' && typeof attrs.start === 'number' && Number.isInteger(attrs.start) && attrs.start > 1 && attrs.start <= 9999) kept.start = attrs.start;
  const content = list(raw.content, DOC_NODES_MAX).flatMap(child => node(child, HOLDS[raw.type as string] ?? [], depth + 1, budget) ?? []);
  return { type: raw.type, ...(Object.keys(kept).length ? { attrs: kept } : {}), ...(content.length ? { content } : {}) };
}

function doc(value: unknown): RichDoc {
  if (!isRecord(value) || value.type !== 'doc') return { type: 'doc', content: [] };
  const budget: Budget = { nodes: 0, chars: 0 };
  return { type: 'doc', content: list(value.content, DOC_NODES_MAX).flatMap(child => node(child, HOLDS.doc, 1, budget) ?? []) };
}

/** Whether a text has anything to show: a word, an image or a rule (a text of empty paragraphs has not) */
export const docIsBlank = (text: RichDoc): boolean => !text.content.some(function shows(part: RichNode): boolean {
  return part.type === 'libraryImage' || part.type === 'horizontalRule' || (typeof part.text === 'string' && !isBlank(part.text)) || Boolean(part.content?.some(shows));
});

function section(value: unknown): SitePageSection | null {
  if (!isRecord(value)) return null;
  const background: SectionBackground = SECTION_BACKGROUNDS.includes(value.background as SectionBackground) ? value.background as SectionBackground : 'white';
  const title = str(value.title, 200);
  switch (value.kind) {
    case 'hero':
      return { kind: 'hero', background, title, text: str(value.text, 1000), image: pageImage(value.image), buttonLabel: str(value.buttonLabel, 80), buttonHref: href(value.buttonHref) };
    case 'text':
      return { kind: 'text', background, doc: doc(value.doc) };
    case 'textImage':
      return {
        kind: 'textImage', background, title, doc: doc(value.doc), image: pageImage(value.image), imageSide: value.imageSide === 'left' ? 'left' : 'right',
        buttonLabel: str(value.buttonLabel, 80), buttonHref: href(value.buttonHref),
      };
    case 'iconCards':
      return {
        kind: 'iconCards', background, title,
        cards: list(value.cards, 8).flatMap(raw => (isRecord(raw) && PAGE_ICONS.includes(raw.icon as PageIcon)
          ? [{ icon: raw.icon as PageIcon, title: str(raw.title, 120), text: str(raw.text, 600) }] : [])),
      };
    case 'gallery':
      return { kind: 'gallery', background, title, images: list(value.images, 24).flatMap(raw => pageImage(raw) ?? []) };
    case 'people':
      return {
        kind: 'people', background, title,
        people: list(value.people, 16).flatMap(raw => (isRecord(raw) ? [{ image: pageImage(raw.image), name: str(raw.name, 120), role: str(raw.role, 160), contact: str(raw.contact, 240) }] : [])),
      };
    case 'map':
      return {
        kind: 'map', background, title, image: pageImage(value.image), address: str(value.address, 600),
        neshanUrl: href(value.neshanUrl), baladUrl: href(value.baladUrl), googleUrl: href(value.googleUrl),
      };
    case 'products':
      return { kind: 'products', background, title, collection: str(value.collection, 200), products: list(value.products, 12).flatMap(raw => card(raw) ?? []) };
    case 'button':
      return { kind: 'button', background, label: str(value.label, 80), href: href(value.href) };
    case 'shippingMethods':
      return { kind: 'shippingMethods', background, title };
    default:
      return null;
  }
}

/**
 * A time that names its zone (`…Z` or `…+03:30`). One without a zone would be read in this server's own zone, and the
 * day worked out from it would then depend on where the site runs, so it is no time at all here.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const isInstant = (text: string) => INSTANT.test(text) && !Number.isNaN(Date.parse(text));

const summary = (value: unknown): StorefrontPageSummary | null => {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isPageSlug(value.slug) || isBlank(str(value.title, 200))) return null;
  const kind = value.kind === 'base' ? 'base' : 'custom';
  // a base page is one of the five the site has an address for; any other "base" page has nowhere to be shown
  if (kind === 'base' && !isBasePageSlug(value.slug)) return null;
  const at = typeof value.updatedAt === 'string' && isInstant(value.updatedAt) ? value.updatedAt : '';
  return { slug: value.slug, kind, title: str(value.title, 200).trim(), noindex: value.noindex === true, updatedAt: at };
};

export function sitePage(value: unknown): SitePage | null {
  const top = summary(value);
  if (!top || !isRecord(value)) return null;
  return {
    ...top, seoTitle: str(value.seoTitle, 300), seoDescription: str(value.seoDescription, 600), shareImage: pageImage(value.shareImage),
    sections: list(value.sections, 40).flatMap(raw => section(raw) ?? []),
  };
}

export const sitePageList = (value: unknown): StorefrontPageSummary[] => list(value, 400).flatMap(raw => summary(raw) ?? []);

/** The day (in UTC) of a time that names its zone, for the sitemap's `lastmod`; '' for anything else */
export const lastModOf = (iso: string) => (isInstant(iso) ? new Date(iso).toISOString().slice(0, 10) : '');

/** The words of a text without its formatting: the pieces of one paragraph run together, and paragraphs are a space apart */
function plainText(part: RichNode): string {
  if (typeof part.text === 'string') return part.text;
  if (part.type === 'hardBreak') return ' ';
  const inside = (part.content ?? []).map(plainText);
  return part.type === 'paragraph' || part.type === 'heading' ? inside.join('') : inside.filter(Boolean).join(' ');
}

const DESCRIPTION_MAX = 200;

/** The description of a page for a search engine: the one written in the ERP, else the first words of the page itself */
export function pageDescription(page: SitePage): string {
  if (!isBlank(page.seoDescription)) return page.seoDescription.trim();
  for (const part of page.sections) {
    const words = (part.kind === 'hero' ? part.text : part.kind === 'text' || part.kind === 'textImage' ? part.doc.content.map(plainText).filter(Boolean).join(' ') : '')
      .replace(/\s+/g, ' ').trim();
    if (!isBlank(words)) return words.length > DESCRIPTION_MAX ? `${words.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : words;
  }
  return page.title;
}

/** The image of a page's social card: the one chosen in the ERP, else the image of its first section that has one */
export function pageCardImage(page: SitePage): SitePageImage | null {
  if (page.shareImage) return page.shareImage;
  for (const part of page.sections) {
    if ((part.kind === 'hero' || part.kind === 'textImage' || part.kind === 'map') && part.image) return part.image;
    if (part.kind === 'gallery' && part.images[0]) return part.images[0];
  }
  return null;
}
