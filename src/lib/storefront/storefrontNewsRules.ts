import { checkedPage, pageAssetIds, type PageSection, type SectionKind } from './storefrontPageRules.js';
import { text } from './storefrontPageParts.js';

/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of a news item of the site, shared by the
 * server and the editor (no I/O). A news item is a title, an address, a short summary, a cover image, a day, the search
 * title and description, and a body made of the page builder's «متن» and «گالری تصاویر» parts, checked by the page's own
 * rules (`checkedPage`). A draft may be unfinished; what is unsafe is refused on every save, what is only unfinished is
 * refused at «انتشار».
 */
export const NEWS_SECTION_KINDS: readonly SectionKind[] = ['text', 'gallery'];
export const NEWS_SUMMARY_MAX = 300;
export const NEWS_MAX = 2000;
/** rows of the ERP's list a page */
export const NEWS_PAGE_SIZE = 50;
const NOUN = 'خبر';

export interface NewsValues {
  title: string;
  slug: string;
  /** a few lines for the list of news and for a search engine ('' = the start of the text) */
  summary: string;
  coverAssetId: number | null;
  /** the day the item is dated, `YYYY-MM-DD` in Tehran ('' = the day it is published); a day to come puts it on the site that day */
  newsDate: string;
  seoTitle: string;
  seoDescription: string;
  sections: PageSection[];
}

export interface NewsProblem { field: string; section: number; message: string; code: string }
export type CheckedNews = { news: NewsValues; problem: null } | { news: null; problem: NewsProblem };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refuse = (field: string, message: string, code: string, section = -1): CheckedNews => ({ news: null, problem: { field, section, message, code } });
/** A message of the page's rules, said of a news item: its cover is «تصویر شاخص» and what it checks is a «خبر» */
const inNewsWords = (message: string): string => message.replaceAll('تصویر اشتراک‌گذاری', 'تصویر شاخص').replaceAll('صفحه', NOUN).replaceAll('our-story', 'new-collection');

/** A day as it is kept: `YYYY-MM-DD` of a real day between 2000 and 2100 */
export function isNewsDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

/** A news item as it is kept, from whatever a request carried; `forPublish` also refuses an item that is safe but unfinished */
export function checkedNews(raw: unknown, options: { forPublish: boolean }): CheckedNews {
  if (!isRecord(raw)) return refuse('news', 'خبر خوانا نیست.', 'STOREFRONT_NEWS_INVALID');
  const page = checkedPage(
    { title: raw.title, slug: raw.slug, seoTitle: raw.seoTitle, seoDescription: raw.seoDescription, shareImageAssetId: raw.coverAssetId ?? null, sections: raw.sections },
    { forPublish: options.forPublish, baseSlug: null, noun: NOUN, kinds: NEWS_SECTION_KINDS },
  );
  if (page.problem) {
    return { news: null, problem: { ...page.problem, message: inNewsWords(page.problem.message), field: page.problem.field === 'shareImageAssetId' ? 'coverAssetId' : page.problem.field } };
  }
  // the editor of a news item offers no background; the site draws every part of an item on one
  const coloured = page.page.sections.findIndex(section => section.background !== 'white');
  if (coloured >= 0) return refuse('sections', 'بخش‌های خبر رنگ زمینه نمی‌گیرند.', 'STOREFRONT_PAGE_SECTION_INVALID', coloured);
  if (raw.summary !== undefined && typeof raw.summary !== 'string') return refuse('summary', 'خلاصهٔ خبر خوانا نیست.', 'STOREFRONT_NEWS_FIELD_INVALID');
  // the lines of the box become one line; then it is a plain line of text by the page's own rule (no control or
  // direction character, no half of a broken emoji, which PostgreSQL would refuse)
  let summary: string;
  try {
    summary = text(String(raw.summary ?? '').replace(/\s+/g, ' '), NEWS_SUMMARY_MAX, 'خلاصهٔ خبر');
  } catch (err) {
    return refuse('summary', (err as Error).message, 'STOREFRONT_NEWS_FIELD_INVALID');
  }
  if (raw.newsDate !== undefined && typeof raw.newsDate !== 'string') return refuse('newsDate', 'تاریخ خبر خوانا نیست.', 'STOREFRONT_NEWS_DATE_INVALID');
  const newsDate = String(raw.newsDate ?? '').trim();
  if (newsDate && !isNewsDate(newsDate)) return refuse('newsDate', 'تاریخ خبر یک روز درست نیست.', 'STOREFRONT_NEWS_DATE_INVALID');
  return {
    news: {
      title: page.page.title, slug: page.page.slug, summary, coverAssetId: page.page.shareImageAssetId, newsDate,
      seoTitle: page.page.seoTitle, seoDescription: page.page.seoDescription, sections: page.page.sections,
    },
    problem: null,
  };
}

/** every image of the media library a news item names: its cover and the images of its body */
export const newsAssetIds = (news: Pick<NewsValues, 'sections' | 'coverAssetId'>): number[] => pageAssetIds({ sections: news.sections, shareImageAssetId: news.coverAssetId });
