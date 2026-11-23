import { NEWS_SECTION_KINDS } from '@erp/storefront/storefrontNewsRules';
import { cleanText, isBlank, isPageSlug, lastModOf, pageImage, sitePage, type SitePage, type SitePageImage } from './pages';

/**
 * v12 phase 10d (start plan V12_SITE_NEXT_START_PLAN.md §7.2): the news of the ERP's «خبرهای سایت» as the site may
 * draw them. As with a page, nothing is taken on trust: an item is rebuilt from the fields the site draws, its text
 * goes through the page's own checks (`sitePage`) and keeps only the parts a news item has, and an answer in another
 * shape is no news.
 */
export interface SiteNewsCard {
  slug: string;
  title: string;
  summary: string;
  /** the day the item is dated, `YYYY-MM-DD` in Tehran */
  date: string;
  cover: SitePageImage | null;
}
export interface SiteNewsList { enabled: boolean; items: SiteNewsCard[]; total: number; page: number; pageSize: number }
/** One item: its card, and its text and search words in the shape of a page (so the site draws and describes it as one) */
export interface SiteNewsItem extends SiteNewsCard { page: SitePage }
/** `lastmod`: the later of the item's day and the day its copy was published ('' when neither can be read) */
export interface SiteNewsIndexRow { slug: string; lastmod: string }

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown, max: number) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null);
export const NEWS_PATH = '/news';
/** An item's address; its slug is lowercase Latin, so it needs no encoding */
export const newsPath = (slug: string) => `${NEWS_PATH}/${slug}`;
export const newsListPath = (page: number) => (page > 1 ? `${NEWS_PATH}?page=${page}` : NEWS_PATH);
/** The first moment of an item's day, a day of Tehran, as a time with its zone */
export const newsDayStart = (day: string) => `${day}T00:00:00+03:30`;
/**
 * When an item last changed, for a search engine: the time its copy was published, but only when that is not before
 * the item's own day (an item published ahead of its day would otherwise be «changed» before it was «published»)
 */
export const newsModifiedAt = (item: { date: string; page: { updatedAt: string } }): string => (
  item.page.updatedAt && Date.parse(item.page.updatedAt) >= Date.parse(newsDayStart(item.date)) ? item.page.updatedAt : ''
);

function card(value: unknown): SiteNewsCard | null {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isPageSlug(value.slug) || typeof value.date !== 'string' || !DAY.test(value.date)) return null;
  const title = cleanText(value.title, 200).trim();
  if (isBlank(title)) return null;
  return { slug: value.slug, title, summary: cleanText(value.summary, 400).replace(/\s+/g, ' ').trim(), date: value.date, cover: pageImage(value.cover) };
}

/** `GET /news?page=N` of the Storefront API; null for an answer in another shape */
export function siteNewsList(value: unknown): SiteNewsList | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.data)) return null;
  const [total, page, pageSize] = [count(value.total, 100_000), count(value.page, 100_000), count(value.pageSize, 100)];
  if (total === null || page === null || !pageSize) return null;
  return { enabled: value.enabled, items: value.data.slice(0, pageSize).flatMap(raw => card(raw) ?? []), total, page: Math.max(1, page), pageSize };
}

/** `GET /news/:slug` of the Storefront API; null for an answer that is no item */
export function siteNewsItem(value: unknown): SiteNewsItem | null {
  const top = card(value);
  if (!top || !isRecord(value)) return null;
  const page = sitePage({
    slug: top.slug, kind: 'custom', title: top.title, noindex: false, updatedAt: value.updatedAt, seoTitle: value.seoTitle, seoDescription: value.seoDescription,
    shareImage: value.cover, sections: value.sections,
  });
  if (!page) return null;
  // a news item is text and galleries; a part of any other kind (a row of products, a button) is not drawn in one
  return { ...top, page: { ...page, sections: page.sections.filter(section => NEWS_SECTION_KINDS.includes(section.kind)).map(section => ({ ...section, background: 'white' as const })) } };
}

/** two days as `YYYY-MM-DD` ('' = none) compare as text */
const laterDay = (a: string, b: string) => (a > b ? a : b);

/** `GET /news-index` of the Storefront API: each item's address and the day of its last change, for the sitemap */
export function siteNewsIndex(value: unknown): SiteNewsIndexRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5000).flatMap((raw): SiteNewsIndexRow[] => (
    isRecord(raw) && typeof raw.slug === 'string' && isPageSlug(raw.slug)
      ? [{ slug: raw.slug, lastmod: laterDay(typeof raw.date === 'string' && DAY.test(raw.date) ? raw.date : '', typeof raw.updatedAt === 'string' ? lastModOf(raw.updatedAt) : '') }]
      : []
  ));
}
