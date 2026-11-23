import type { StorefrontPageImage, StorefrontPageSection } from './storefrontPagePublicContracts.js';

/**
 * v12 phase 10d (start plan V12_SITE_NEXT_START_PLAN.md §7.2; `AGENTS.md` §1.9c): what the site reads of «خبرهای سایت»
 * through `GET /api/storefront/v1/news`, `/news/:slug` and `/news-index`. Only the copy on the site of an item whose day
 * has come goes out, and only while «خبرها روی سایت بیایند» is on: never a draft, an item waiting for its day, a removed
 * item, an editor's name, a row id or an id of the media library (an image is named by the key of its file).
 */
export const STOREFRONT_NEWS_SETTING_KEYS = { enabled: 'sf_news_enabled' } as const;
/** items of the site's list a page */
export const NEWS_SITE_PAGE_SIZE = 12;
/** the first words of an item's text, shown where it has no summary of its own */
export const NEWS_EXCERPT_MAX = 200;

/** One item of the site's list of news */
export interface StorefrontNewsCard {
  slug: string;
  title: string;
  /** the item's summary, else the first words of its text ('' when it has neither) */
  summary: string;
  /** the day the item is dated, `YYYY-MM-DD` in Tehran */
  date: string;
  cover: StorefrontPageImage | null;
}

/** `GET /api/storefront/v1/news?page=N`: the newest first; while the switch is off, `enabled` is false and there is no item */
export interface StorefrontNewsList {
  enabled: boolean;
  data: StorefrontNewsCard[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /api/storefront/v1/news/:slug`: one item with its text (parts of kind «متن» and «گالری تصاویر») */
export interface StorefrontPublicNews extends StorefrontNewsCard {
  /** when the copy on the site was published, an ISO time in UTC */
  updatedAt: string;
  seoTitle: string;
  seoDescription: string;
  sections: StorefrontPageSection[];
}

/** One line of `GET /api/storefront/v1/news-index`: every item on the site now, for the sitemap */
export interface StorefrontNewsIndexRow {
  slug: string;
  date: string;
  updatedAt: string;
}
