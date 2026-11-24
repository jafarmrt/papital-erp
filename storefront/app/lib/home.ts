import type { StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import { todayHomeSections, type HomeSection } from '@erp/storefront/storefrontHomeParts';
import { PAGE_ICONS, SECTION_BACKGROUNDS, type PageIcon, type SectionBackground } from '@erp/storefront/storefrontPageParts';
import { siteNewsCard, type SiteNewsCard } from './news';
import { cleanText, isBlank, isPageSlug, pageImage, siteHref, sitePageSection, siteProductCard, type SitePageImage, type SitePageSection } from './pages';

/**
 * v12 phase 10e (start plan V12_SITE_NEXT_START_PLAN.md §7.2): «صفحهٔ اصلی» of the ERP as the site may draw it
 * (`GET /home` of the Storefront API). As with a page, nothing is taken on trust: every part is rebuilt from the fields
 * the site draws, a part of a kind the site does not know is left out, every address is checked again (a path of this
 * site, or an https address only where the ERP says the link leaves the site), and every text is drawn as text.
 *
 * Until the shop publishes its home page the site draws its own: the same seven parts, with the words they have always
 * had (`todayHome`), through the same code as a published one.
 */
export interface SiteSlide {
  image: SitePageImage;
  mobileImage: SitePageImage | null;
  title: string;
  text: string;
  buttonLabel: string;
  href: string;
  external: boolean;
}
export type SiteHomeOwnSection =
  | { kind: 'slider'; slides: SiteSlide[] }
  | { kind: 'banner'; image: SitePageImage; mobileImage: SitePageImage | null; href: string; external: boolean }
  | { kind: 'collectionIntro'; background: SectionBackground; title: string; collection: string; paragraphs: string[]; image: SitePageImage | null; moreHref: string; products: StorefrontProductCard[] }
  | { kind: 'latestNews'; background: SectionBackground; title: string; items: SiteNewsCard[] }
  | { kind: 'homeIntro'; kicker: string; title: string; text: string; buttonLabel: string; buttonHref: string }
  | { kind: 'homeCategories'; title: string }
  | { kind: 'homeWhy'; points: Array<{ icon: PageIcon; text: string }> }
  | { kind: 'homeFeatured' | 'homeNewest'; title: string; buttonLabel: string; buttonHref: string }
  | { kind: 'homeCollections'; title: string; text: string }
  | { kind: 'homeWholesale'; title: string; text: string; buttonLabel: string; buttonHref: string; secondLabel: string; secondHref: string };
export type SiteHomeSection = SitePageSection | SiteHomeOwnSection;
export interface SiteHome {
  seoTitle: string;
  seoDescription: string;
  shareImage: SitePageImage | null;
  sections: SiteHomeSection[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const line = (value: unknown, max: number) => cleanText(value, max).replace(/\s+/g, ' ').trim();
const ground = (value: unknown): SectionBackground => (SECTION_BACKGROUNDS.includes(value as SectionBackground) ? value as SectionBackground : 'white');
/** a button is its words and its address together: half of one is none */
const button = (label: unknown, address: unknown) => {
  const [buttonLabel, buttonHref] = [line(label, 80), siteHref(address)];
  return buttonLabel && buttonHref ? { buttonLabel, buttonHref } : { buttonLabel: '', buttonHref: '' };
};
/** Where a slide's button or a banner leads: an address of this site, or an https address only when the ERP says it leaves the site */
function target(value: Record<string, unknown>): { href: string; external: boolean } {
  const href = siteHref(value.href);
  const external = value.external === true;
  return href && href.startsWith('/') !== external ? { href, external } : { href: '', external: false };
}
/** «آشنایی بیشتر» of a collection leads to a page of «صفحه‌های سایت» and nowhere else */
const moreHref = (value: unknown): string => (typeof value === 'string' && value.startsWith('/pages/') && isPageSlug(value.slice('/pages/'.length)) ? value : '');

function slide(value: unknown): SiteSlide | null {
  if (!isRecord(value)) return null;
  const image = pageImage(value.image);
  if (!image) return null;
  const to = target(value);
  const buttonLabel = to.href ? line(value.buttonLabel, 80) : '';
  return { image, mobileImage: pageImage(value.mobileImage), title: line(value.title, 160), text: line(value.text, 400), buttonLabel, href: buttonLabel ? to.href : '', external: buttonLabel ? to.external : false };
}

function ownSection(value: Record<string, unknown>): SiteHomeOwnSection | null {
  const title = line(value.title, 200);
  switch (value.kind) {
    case 'slider': {
      const slides = list(value.slides, 5).flatMap(raw => slide(raw) ?? []);
      return slides.length ? { kind: 'slider', slides } : null;
    }
    case 'banner': {
      const image = pageImage(value.image);
      return image ? { kind: 'banner', image, mobileImage: pageImage(value.mobileImage), ...target(value) } : null;
    }
    case 'collectionIntro': {
      const collection = typeof value.collection === 'string' ? cleanText(value.collection, 200) : '';
      const products = list(value.products, 3).flatMap(raw => siteProductCard(raw) ?? []);
      if (!collection || products.length === 0) return null;
      const paragraphs = cleanText(value.intro, 3000).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(part => part.trim()).filter(part => !isBlank(part)).slice(0, 40);
      return { kind: 'collectionIntro', background: ground(value.background), title, collection, paragraphs, image: pageImage(value.image), moreHref: moreHref(value.moreHref), products };
    }
    case 'latestNews': {
      const items = list(value.items, 3).flatMap(raw => siteNewsCard(raw) ?? []);
      return items.length ? { kind: 'latestNews', background: ground(value.background), title, items } : null;
    }
    case 'homeIntro':
      return title ? { kind: 'homeIntro', kicker: line(value.kicker, 160), title, text: line(value.text, 800), ...button(value.buttonLabel, value.buttonHref) } : null;
    case 'homeCategories':
      return { kind: 'homeCategories', title };
    case 'homeWhy': {
      const points = list(value.points, 4).flatMap(raw => (isRecord(raw) && PAGE_ICONS.includes(raw.icon as PageIcon) ? [{ icon: raw.icon as PageIcon, text: line(raw.text, 120) }] : []))
        // only the delivery point may come without words: the site writes them
        .filter(point => point.text || point.icon === 'truck');
      return points.length ? { kind: 'homeWhy', points } : null;
    }
    case 'homeFeatured': case 'homeNewest':
      return { kind: value.kind, title, ...button(value.buttonLabel, value.buttonHref) };
    case 'homeCollections':
      return { kind: 'homeCollections', title, text: line(value.text, 800) };
    case 'homeWholesale': {
      const [first, second] = [button(value.buttonLabel, value.buttonHref), button(value.secondLabel, value.secondHref)];
      return title ? { kind: 'homeWholesale', title, text: line(value.text, 800), ...first, secondLabel: second.buttonLabel, secondHref: second.buttonHref } : null;
    }
    default:
      return null;
  }
}

const OWN_KINDS = ['slider', 'banner', 'collectionIntro', 'latestNews', 'homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeNewest', 'homeCollections', 'homeWholesale'];
/** One part of the home page; a part of every page goes through the page's own checks */
const section = (value: unknown): SiteHomeSection | null => {
  if (!isRecord(value)) return null;
  // the table of delivery methods belongs to its own page; the ERP never sends it here
  if (value.kind === 'shippingMethods') return null;
  return OWN_KINDS.includes(value.kind as string) ? ownSection(value) : sitePageSection(value);
};

/** The parts of a home page from whatever was sent, at most forty */
export const siteHomeSections = (value: unknown): SiteHomeSection[] => list(value, 40).flatMap(raw => section(raw) ?? []);

/** `GET /home` of the Storefront API; null for an answer in another shape, or one with nothing to draw */
export function siteHome(value: unknown): SiteHome | null {
  if (!isRecord(value) || !Array.isArray(value.sections)) return null;
  const sections = siteHomeSections(value.sections);
  if (sections.length === 0) return null;
  return { seoTitle: line(value.seoTitle, 300), seoDescription: line(value.seoDescription, 600), shareImage: pageImage(value.shareImage), sections };
}

/**
 * The site's own home page: the seven parts it has always had, with their words, in the shape the ERP would send them.
 * The words live in one place (`storefrontHomeParts.ts`), which is also where the ERP's «شروع از صفحهٔ اصلی امروز»
 * takes them from, so the two never drift apart.
 */
export function todayHome(): SiteHomeSection[] {
  return siteHomeSections(todayHomeSections().map((part: HomeSection) => ({ ...part })));
}

/** What the parts of a home page need from the catalog, so the loader reads only that */
export interface HomeNeeds { featured: boolean; newest: boolean; categories: boolean; collections: boolean }
export function homeNeeds(sections: readonly SiteHomeSection[]): HomeNeeds {
  const has = (kind: SiteHomeSection['kind']) => sections.some(part => part.kind === kind);
  // the first product of the shop's own order stands beside the home page's opening words
  return { featured: has('homeFeatured') || has('homeIntro'), newest: has('homeNewest'), categories: has('homeCategories'), collections: has('homeCollections') };
}

/** how far a finger must move along the slider's row before the move counts as the visitor's own */
export const SWIPE_MIN_PX = 10;
/**
 * Whether one finger's move over the slider is a swipe along its row (the visitor moves the slider) and not a scroll
 * of the page past it or a finger resting on it: further than a few pixels, and more sideways than up or down.
 */
export function isRowSwipe(from: { x: number; y: number }, at: { x: number; y: number }): boolean {
  const [dx, dy] = [Math.abs(at.x - from.x), Math.abs(at.y - from.y)];
  return dx > SWIPE_MIN_PX && dx > dy;
}

/** The part that holds the top of the page: a «صفحهٔ ویژه» that asks for the home page takes its place while it is on the site */
export const isTopPart = (part: SiteHomeSection): boolean => part.kind === 'slider' || part.kind === 'homeIntro';
