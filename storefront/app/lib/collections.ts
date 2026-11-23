import { cleanText, isBlank, isPageSlug, pageImage, type SitePageImage } from './pages';

/**
 * v12 phase 10e: the words the shop wrote for a collection («کالکشن‌های سایت» in the ERP), as `GET /collections` of the
 * Storefront API answers them and as the collection's page draws them. Every field is rebuilt from what the site
 * draws, so an answer in another shape (or a field the ERP never meant for the site) shows nothing.
 */
export interface SiteCollectionText {
  name: string;
  /** the paragraphs of the introduction, in order (a line break inside one is kept) */
  paragraphs: string[];
  image: SitePageImage | null;
  /** the address of «آشنایی بیشتر» on this site ('' = no link) */
  moreHref: string;
}

const INTRO_MAX = 3000;
const PARAGRAPHS_MAX = 40;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** «آشنایی بیشتر» leads to a page of «صفحه‌های سایت» and nowhere else */
const moreHref = (value: unknown): string => {
  if (typeof value !== 'string' || !value.startsWith('/pages/')) return '';
  return isPageSlug(value.slice('/pages/'.length)) ? value : '';
};

function one(value: unknown): SiteCollectionText | null {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '' || value.name.length > 200) return null;
  const paragraphs = cleanText(value.intro, INTRO_MAX).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(part => part.trim()).filter(part => !isBlank(part)).slice(0, PARAGRAPHS_MAX);
  const image = pageImage(value.image);
  if (paragraphs.length === 0 && !image) return null;
  return { name: value.name, paragraphs, image, moreHref: moreHref(value.moreHref) };
}

/** `GET /collections` of the Storefront API, by the collection's name; an answer in another shape is no words at all */
export function siteCollectionTexts(value: unknown): Map<string, SiteCollectionText> {
  const out = new Map<string, SiteCollectionText>();
  if (!Array.isArray(value)) return out;
  for (const raw of value.slice(0, 500)) {
    const text = one(raw);
    if (text && !out.has(text.name)) out.set(text.name, text);
  }
  return out;
}

/** The words of a search result or a shared link for a collection: the start of its introduction, on one line */
export const collectionDescription = (text: SiteCollectionText | null): string => {
  const line = (text?.paragraphs.join(' ') ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= 160) return line;
  const cut = [...line].slice(0, 159).join('');
  return `${cut.trimEnd()}…`;
};
