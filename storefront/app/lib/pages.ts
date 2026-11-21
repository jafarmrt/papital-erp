import type { StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import type {
  StorefrontPageImage, StorefrontPageSection, StorefrontPageSummary, StorefrontPublicPage,
} from '@erp/storefront/storefrontPagePublicContracts';
import {
  BASE_PAGES, PAGE_ICONS, PAGE_SLUG_MAX, SECTION_BACKGROUNDS, pageLink, type PageIcon, type RichDoc, type SectionBackground,
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
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const side = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null);
const href = (value: unknown) => pageLink(value) ?? '';
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);

export function pageImage(value: unknown): SitePageImage | null {
  if (!isRecord(value) || typeof value.sha256 !== 'string' || !FILE_KEY.test(value.sha256)) return null;
  return { sha256: value.sha256, width: side(value.width), height: side(value.height), alt: str(value.alt, 300), thumb: value.thumb === true || value.thumb === 1 };
}

/** A product card as the ERP's catalog sends it; a card without an address or a name is left out */
function card(value: unknown): StorefrontProductCard | null {
  if (!isRecord(value) || typeof value.slug !== 'string' || !value.slug || typeof value.name !== 'string' || typeof value.retailPrice !== 'string') return null;
  if (!isRecord(value.stock) || typeof value.stock.status !== 'string') return null;
  const cover = pageImage(value.cover);
  return { ...(value as unknown as StorefrontProductCard), cover: cover ? { ...cover, isCover: true } : null };
}

/** The editor's JSON is drawn node by node by `RichText`, which knows each node it draws; here only its outer shape is checked */
const doc = (value: unknown): RichDoc => (isRecord(value) && value.type === 'doc' && Array.isArray(value.content) ? value as unknown as RichDoc : { type: 'doc', content: [] });

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

const summary = (value: unknown): StorefrontPageSummary | null => {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isPageSlug(value.slug) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const kind = value.kind === 'base' ? 'base' : 'custom';
  // a base page is one of the five the site has an address for; any other "base" page has nowhere to be shown
  if (kind === 'base' && !isBasePageSlug(value.slug)) return null;
  const at = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : '';
  return { slug: value.slug, kind, title: value.title.trim().slice(0, 200), noindex: value.noindex === true, updatedAt: at };
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

/** `YYYY-MM-DD` of an ISO time, for the sitemap's `lastmod` ('' when there is none) */
export const lastModOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : '');

/** The words of a text, without its formatting (for a page's description when none was written) */
function plainText(node: unknown, budget = { left: 400 }): string {
  if (!isRecord(node) || budget.left <= 0) return '';
  if (typeof node.text === 'string') {
    budget.left -= node.text.length;
    return node.text;
  }
  return list(node.content, 2000).map(child => plainText(child, budget)).filter(Boolean).join(' ');
}

const DESCRIPTION_MAX = 200;

/** The description of a page for a search engine: the one written in the ERP, else the first words of the page itself */
export function pageDescription(page: SitePage): string {
  if (page.seoDescription.trim()) return page.seoDescription.trim();
  for (const part of page.sections) {
    const words = (part.kind === 'hero' ? part.text : part.kind === 'text' || part.kind === 'textImage' ? plainText(part.doc) : '').replace(/\s+/g, ' ').trim();
    if (words) return words.length > DESCRIPTION_MAX ? `${words.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : words;
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
