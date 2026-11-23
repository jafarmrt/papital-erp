import type {
  StorefrontCatalogPage, StorefrontFacet, StorefrontFeedItem, StorefrontProductDetail, StorefrontPublicBrand, StorefrontPublicSettings,
} from '@erp/storefront/storefrontContracts';
import type { StorefrontPublicRedirect, StorefrontPublicSeo } from '@erp/storefront/storefrontSeoContracts';
import type { StorefrontCampaignPage, StorefrontCampaignSummary } from '@erp/storefront/storefrontCampaignContracts';
import { CAMPAIGN_SLUG_MAX } from '@erp/storefront/storefrontCampaignRules';
import { siteEnv } from './site.server';
import { STOREFRONT_QUERY_TEXT_MAX, STOREFRONT_SLUG_MAX } from '@erp/storefront/storefrontRules';
import { CATALOG_PAGE_SIZE, type CatalogSort } from './catalog';
import { NO_MENUS, safeMenus, type SiteMenus } from './menus';
import { DEFAULT_SHOP, siteShop, type SiteShop } from './shopInfo';
import type { StorefrontPageSummary } from '@erp/storefront/storefrontPagePublicContracts';
import { isPageSlug, sitePage, sitePageList, type SitePage } from './pages';
import { siteNewsIndex, siteNewsItem, siteNewsList, type SiteNewsIndexRow, type SiteNewsItem, type SiteNewsList } from './news';
import { siteCollectionTexts, type SiteCollectionText } from './collections';
import { PAGE_PREVIEW_TOKEN } from '@erp/storefront/storefrontPageParts';

/**
 * The only door to the ERP: the five read routes of the Storefront API (phase 8.1), called from this server with the
 * key in the `Authorization` header. A 404 of a product becomes the page's 404; any other failure is an error the
 * page shows as «فروشگاه در دسترس نیست», never an empty shop (a read error is not «no products»).
 */
const TIMEOUT_MS = 8000;
/** Small answers that change rarely are kept this long; a catalog page this long (stock moves; the order step checks again) */
const SETTINGS_TTL_MS = 60_000;
const CATALOG_TTL_MS = 20_000;

export class StorefrontApiError extends Error {
  constructor(readonly status: number, path: string) {
    super(`storefront api ${status} for ${path}`);
  }
}

type Entry = { at: number; value: unknown; status?: number };
const cache = new Map<string, Entry>();
const CACHE_MAX = 500;
/**
 * The answers every page or a reader of the shop needs, by fixed addresses, are kept apart from the bounded cache, so a
 * crawler walking random addresses (each a remembered 404 there) never pushes out the feed or the settings (the security
 * review of 8.5b)
 */
const PINNED_PATHS = new Set(['/facets', '/settings', '/brand', '/seo', '/redirects', '/feed', '/campaigns', '/menus', '/shop-info', '/pages', '/news', '/news-index', '/collections']);
const pinned = new Map<string, Entry>();
const kept = (path: string) => (PINNED_PATHS.has(path) ? pinned : cache).get(path);
/** Many visitors asking for the same address at once make one call */
const inFlight = new Map<string, Promise<unknown>>();
/** An address the ERP does not know (a crawler walking random slugs) is remembered this long, so it costs one call */
const NOT_FOUND_TTL_MS = 60_000;

function remember(path: string, entry: Entry) {
  if (PINNED_PATHS.has(path)) {
    pinned.set(path, entry);
    return;
  }
  cache.delete(path);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(path, entry);
}

async function fetchJson<T>(path: string, ttlMs: number, visitor = ''): Promise<T> {
  const { apiUrl, apiKey } = siteEnv();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      // v12 phase 7 (site review 1.4): a visitor's own read (a search) names the visitor, so the ERP limits each one apart
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(visitor ? { 'X-Storefront-Client-IP': visitor } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorefrontApiError(503, path);
  }
  if (res.status === 404) remember(path, { at: Date.now(), value: null, status: 404 });
  if (!res.ok) throw new StorefrontApiError(res.status, path);
  let value: T;
  try {
    value = await res.json() as T;
  } catch {
    // an answer that is not JSON (a proxy's error page with status 200) is a failed read like any other
    throw new StorefrontApiError(502, path);
  }
  if (ttlMs > 0) remember(path, { at: Date.now(), value });
  return value;
}

async function get<T>(path: string, ttlMs: number, visitor = ''): Promise<T> {
  const hit = kept(path);
  if (hit?.status === 404 && Date.now() - hit.at < NOT_FOUND_TTL_MS) throw new StorefrontApiError(404, path);
  if (hit && hit.status === undefined && Date.now() - hit.at < ttlMs) return hit.value as T;
  let pending = inFlight.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = fetchJson<T>(path, ttlMs, visitor).finally(() => inFlight.delete(path));
    inFlight.set(path, pending);
  }
  return pending;
}

export interface CatalogQuery {
  page?: number;
  limit?: number;
  q?: string;
  collection?: string;
  category?: string;
  sort?: CatalogSort;
}

/** `visitor`: the searching visitor's address ('' = a shared read), passed on to the ERP when the answer is not kept */
export function catalog(query: CatalogQuery, visitor = ''): Promise<StorefrontCatalogPage> {
  const params = new URLSearchParams();
  if (query.page && query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(query.limit ?? CATALOG_PAGE_SIZE));
  if (query.q) params.set('q', query.q);
  if (query.collection) params.set('collection', query.collection);
  if (query.category) params.set('category', query.category);
  if (query.sort && query.sort !== 'default') params.set('sort', query.sort);
  return get<StorefrontCatalogPage>(`/products?${params}`, CATALOG_TTL_MS, visitor);
}

/** A name longer than the API takes cannot match anything: the page is a 404 (the API itself would answer 400) */
export const tooLongForCatalog = (...texts: string[]) => texts.some(t => t.length > STOREFRONT_QUERY_TEXT_MAX);

export async function product(slug: string): Promise<StorefrontProductDetail | null> {
  if (!slug || slug.length > STOREFRONT_SLUG_MAX) return null;
  try {
    return (await get<{ data: StorefrontProductDetail }>(`/products/${encodeURIComponent(slug)}`, CATALOG_TTL_MS)).data;
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
}

export async function facets(): Promise<{ collections: StorefrontFacet[]; categories: StorefrontFacet[] }> {
  return (await get<{ data: { collections: StorefrontFacet[]; categories: StorefrontFacet[] } }>('/facets', SETTINGS_TTL_MS)).data;
}

export async function publicSettings(): Promise<StorefrontPublicSettings> {
  return (await get<{ data: StorefrontPublicSettings }>('/settings', SETTINGS_TTL_MS)).data;
}

const BRAND_TTL_MS = 300_000;

/** The logo and browser icon as data URLs ('' = none); the pages link to them through /brand/:kind */
export async function brand(): Promise<StorefrontPublicBrand> {
  try {
    return (await get<{ data: StorefrontPublicBrand }>('/brand', BRAND_TTL_MS)).data;
  } catch (error) {
    // a logo that cannot be read never takes the shop down: the pages show the name instead
    if (error instanceof StorefrontApiError) return { logo: '', favicon: '' };
    throw error;
  }
}

const NO_SEO: StorefrontPublicSeo = { verification: { google: '', bing: '' }, analytics: { provider: 'none', id: '', url: '' }, alternateSiteUrl: '' };

const SEO_FAILURE_TTL_MS = 30_000;
let seoFailedAt = 0;

const isSeo = (value: unknown): value is StorefrontPublicSeo => {
  const v = value as Partial<StorefrontPublicSeo> | null;
  return Boolean(v && typeof v === 'object' && v.verification && typeof v.verification === 'object'
    && v.analytics && typeof v.analytics === 'object' && typeof v.alternateSiteUrl === 'string');
};

/**
 * v11 phase 8.5: verification codes, the statistics service and the other-language site. Every page reads it, so any
 * failure (the ERP down, an answer in another shape) means none of them, never a down shop, and a failure is remembered
 * a little while so pages do not wait on a slow ERP again and again.
 */
export async function seo(): Promise<StorefrontPublicSeo> {
  if (Date.now() - seoFailedAt < SEO_FAILURE_TTL_MS) return NO_SEO;
  try {
    const data = (await get<{ data: unknown }>('/seo', SETTINGS_TTL_MS)).data;
    if (isSeo(data)) return data;
  } catch {
    // falls through to none
  }
  seoFailedAt = Date.now();
  return NO_SEO;
}

const MENUS_TTL_MS = 60_000;
let menusFailedAt = 0;

/**
 * v12 phase 9c: the menus of «فهرست‌های سایت», read by every page and kept a minute like the settings. Any failure means
 * the fixed menus, never a down shop, and is remembered a little while like the SEO settings.
 */
export async function menus(): Promise<SiteMenus> {
  if (Date.now() - menusFailedAt < SEO_FAILURE_TTL_MS) return NO_MENUS;
  try {
    return safeMenus((await get<{ data: unknown }>('/menus', MENUS_TTL_MS)).data);
  } catch {
    menusFailedAt = Date.now();
    return NO_MENUS;
  }
}

let shopInfoFailedAt = 0;
let lastGoodShop: SiteShop | null = null;

/**
 * v12 phase 10a: «اطلاعات فروشگاه» (the brand's name, the contact details, the footer's texts, the e-namad seal), read by
 * every page and kept a minute like the settings. Any failure (an ERP not yet updated answers 404) means the words the
 * site always had, never a down shop, and is remembered a little while like the menus. Once an answer has been read, a
 * later failure keeps that answer (10a review): one slow moment of the ERP must not turn the brand's name, the feed and
 * the installed app back to the old words for half a minute.
 */
export async function shopInfo(): Promise<SiteShop> {
  if (Date.now() - shopInfoFailedAt < SEO_FAILURE_TTL_MS) return lastGoodShop ?? DEFAULT_SHOP;
  try {
    lastGoodShop = siteShop((await get<{ data: unknown }>('/shop-info', SETTINGS_TTL_MS)).data);
    return lastGoodShop;
  } catch {
    shopInfoFailedAt = Date.now();
    return lastGoodShop ?? DEFAULT_SHOP;
  }
}

const FEED_TTL_MS = 600_000;

/** v11 phase 8.5b: every item on the site with its feed fields; read by the feed (fetched a few times a day) and, v12 phase 10c, by the sitemap */
export async function feed(): Promise<StorefrontFeedItem[]> {
  return (await get<{ data: StorefrontFeedItem[] }>('/feed', FEED_TTL_MS)).data;
}

const CAMPAIGN_TTL_MS = 60_000;
const CAMPAIGN_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isCampaignSlug = (slug: string) => slug.length <= CAMPAIGN_SLUG_MAX && CAMPAIGN_SLUG.test(slug);

/**
 * v11 phase 8.5b: «صفحه‌های ویژه» on the site now (on, and inside their days). The home page, the sitemap and the
 * not-found page read the list; any failure there is no pages, never a down shop.
 */
export async function campaigns(): Promise<StorefrontCampaignSummary[]> {
  try {
    return (await get<{ data: StorefrontCampaignSummary[] }>('/campaigns', CAMPAIGN_TTL_MS)).data;
  } catch (error) {
    if (error instanceof StorefrontApiError) return [];
    throw error;
  }
}

/** One campaign page on the site now; null when there is none by that address (or it is off, or outside its days) */
export async function campaign(slug: string): Promise<StorefrontCampaignPage | null> {
  if (!isCampaignSlug(slug)) return null;
  try {
    return (await get<{ data: StorefrontCampaignPage }>(`/campaigns/${slug}`, CAMPAIGN_TTL_MS)).data;
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * A page's answer is kept a minute, like the settings: after «انتشار» or «برداشتن از سایت» in the ERP, the site follows
 * within a minute (a page not there is remembered as long, NOT_FOUND_TTL_MS, so a newly published one appears as late).
 */
const PAGE_TTL_MS = 60_000;

/**
 * v12 phase 10c: the pages of «صفحه‌های سایت» on the site now, for the sitemap. Any failure (an ERP not yet updated
 * answers 404) is no pages, never a down shop: the five base pages then keep the text the site always had.
 */
export async function pages(): Promise<StorefrontPageSummary[]> {
  try {
    return sitePageList((await get<{ data: unknown }>('/pages', PAGE_TTL_MS)).data);
  } catch (error) {
    if (error instanceof StorefrontApiError) return [];
    throw error;
  }
}

const NEWS_TTL_MS = 60_000;

/**
 * v12 phase 10d: a page of the list of news; null when the site has no news (the switch «خبرها روی سایت بیایند» is off,
 * or the ERP is not yet updated and answers 404), so `/news` is then a 404 like any other address. A read that failed
 * in any other way is an error, never «no news».
 */
export async function newsList(page: number): Promise<SiteNewsList | null> {
  const path = page > 1 ? `/news?page=${page}` : '/news';
  try {
    const list = siteNewsList(await get<unknown>(path, NEWS_TTL_MS));
    if (!list) throw new StorefrontApiError(502, path);
    return list.enabled ? list : null;
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
}

/** v12 phase 10d: one news item on the site now; null when there is none by that address (a read error is not «no such item») */
export async function newsItem(slug: string): Promise<SiteNewsItem | null> {
  if (!isPageSlug(slug)) return null;
  const path = `/news/${slug}`;
  try {
    const answer = await get<unknown>(path, NEWS_TTL_MS);
    const found = siteNewsItem(typeof answer === 'object' && answer !== null ? (answer as { data?: unknown }).data : null);
    if (!found || found.slug !== slug) throw new StorefrontApiError(502, path);
    return found;
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
}

/** v12 phase 10d: every news item on the site now, for the sitemap; any failure is no news, never a missing sitemap */
export async function newsIndex(): Promise<SiteNewsIndexRow[]> {
  try {
    return siteNewsIndex((await get<{ data: unknown }>('/news-index', NEWS_TTL_MS)).data);
  } catch (error) {
    if (error instanceof StorefrontApiError) return [];
    throw error;
  }
}

/**
 * v12 phase 10e: the words the shop wrote for one collection («کالکشن‌های سایت»), or null. They are an extra above the
 * list of products: any failure (an ERP not yet updated answers 404) is a page without them, never a down shop.
 */
export async function collectionText(name: string): Promise<SiteCollectionText | null> {
  try {
    return siteCollectionTexts((await get<{ data: unknown }>('/collections', PAGE_TTL_MS)).data).get(name) ?? null;
  } catch (error) {
    if (error instanceof StorefrontApiError) return null;
    throw error;
  }
}

/** The last copy read of each base page and each fixed page's words (fifteen at most), to show while the ERP cannot be read */
const lastGoodBasePage = new Map<string, SitePage>();
/**
 * When such a read last failed: for half a minute the ERP is not asked again for that page (the words of «پیدا نشد» are
 * read for every page of the site, so a failing read would otherwise be tried on every visit).
 */
const FALLBACK_RETRY_MS = 30_000;
const fallbackFailedAt = new Map<string, number>();

/**
 * One published page; null when there is none by that address. A page the shop made is an error while the ERP cannot
 * be read (a read error is not «no such page»). `fallback` is for a base page and for the words of a fixed page (10c),
 * which must never be down: when the ERP
 * says the page is not published (404) the caller shows the site's fixed text; when the ERP cannot be read at all, the
 * copy read last is shown (10c review: an error must not put the fixed text back in place of a published page), and
 * only a site that has never read the page falls back to the fixed text.
 */
export async function page(slug: string, { fallback = false } = {}): Promise<SitePage | null> {
  if (!isPageSlug(slug)) return null;
  const path = `/pages/${slug}`;
  if (fallback && Date.now() - (fallbackFailedAt.get(slug) ?? -FALLBACK_RETRY_MS) < FALLBACK_RETRY_MS) return lastGoodBasePage.get(slug) ?? null;
  try {
    const answer = await get<unknown>(path, PAGE_TTL_MS);
    const found = sitePage(typeof answer === 'object' && answer !== null ? (answer as { data?: unknown }).data : null);
    // a 200 that is not a page, or is another address's page, is a failed read: «no page» is only the ERP's own 404
    if (!found || found.slug !== slug) throw new StorefrontApiError(502, path);
    if (fallback) {
      lastGoodBasePage.set(slug, found);
      fallbackFailedAt.delete(slug);
    }
    return found;
  } catch (error) {
    if (!(error instanceof StorefrontApiError)) throw error;
    if (error.status === 404) {
      lastGoodBasePage.delete(slug);
      fallbackFailedAt.delete(slug);
      return null;
    }
    if (fallback) {
      fallbackFailedAt.set(slug, Date.now());
      return lastGoodBasePage.get(slug) ?? null;
    }
    throw error;
  }
}

/** The key of a preview link as the ERP makes it (32 random bytes in base64url); another shape is never sent to the ERP */
export const isPreviewToken = (token: string) => PAGE_PREVIEW_TOKEN.test(token);

/** One read of the ERP under a preview key, kept nowhere: not in the page cache (the key would be its name) and not as a missing address */
async function previewFetch(path: string, token: string, accept: string): Promise<Response | null> {
  const { apiUrl, apiKey } = siteEnv();
  let res: Response;
  try {
    // the key goes in a header, never in the address, so it is in no log of the ERP
    res = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, 'X-Preview-Key': token, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new StorefrontApiError(503, '/page-preview');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new StorefrontApiError(res.status, '/page-preview');
  return res;
}

/**
 * v12 phase 10c: «پیش‌نمایش»: the saved draft of a page of the ERP, for the one-hour link a colleague made there; null
 * when the key opens nothing (unknown, ended, or the page removed). Read from the ERP each time, so a draft saved a
 * moment ago shows at once and an ended link stops at once.
 */
export async function pagePreview(token: string): Promise<{ page: SitePage; expiresAt: string } | null> {
  if (!isPreviewToken(token)) return null;
  const res = await previewFetch('/page-preview', token, 'application/json');
  if (!res) return null;
  let answer: unknown;
  try {
    answer = await res.json();
  } catch {
    throw new StorefrontApiError(502, '/page-preview');
  }
  const data = typeof answer === 'object' && answer !== null ? (answer as { data?: unknown }).data : null;
  const page = sitePage(data);
  if (!page) throw new StorefrontApiError(502, '/page-preview');
  const expiresAt = (data as { expiresAt?: unknown }).expiresAt;
  // whatever the answer says, a preview is never for a search engine
  return { page: { ...page, noindex: true }, expiresAt: typeof expiresAt === 'string' ? expiresAt : '' };
}

/** An image the previewed draft names, under the same key; never kept in this server's memory (it is not on the site) */
export async function pagePreviewMedia(token: string, file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isPreviewToken(token) || !isMediaFile(file)) return null;
  const res = await previewFetch(`/page-preview/media/${file}`, token, 'image/webp');
  return res ? new Uint8Array<ArrayBuffer>(await res.arrayBuffer()) : null;
}

const REDIRECTS_TTL_MS = 300_000;
let redirectIndex: { list: StorefrontPublicRedirect[]; map: Map<string, StorefrontPublicRedirect> } | null = null;

/**
 * v11 phase 8.5: the old WooCommerce addresses and where each goes, by the old address's key. Read only when a request
 * misses every page of the site, and kept a few minutes; unreadable = none, so the site's own guesses (temporary) apply.
 */
export async function redirects(): Promise<ReadonlyMap<string, StorefrontPublicRedirect>> {
  try {
    const list = (await get<{ data: StorefrontPublicRedirect[] }>('/redirects', REDIRECTS_TTL_MS)).data;
    // the same kept answer is indexed once
    if (redirectIndex?.list !== list) redirectIndex = { list, map: new Map(list.map(r => [r.from, r])) };
    return redirectIndex.map;
  } catch (error) {
    if (error instanceof StorefrontApiError) return new Map();
    throw error;
  }
}

const MEDIA_FILE = /^[0-9a-f]{64}(-thumb)?\.webp$/;
export const isMediaFile = (file: string) => MEDIA_FILE.test(file);

/**
 * Product images, and (v12 phase 10c) the images of published pages, kept in this server's memory once read: a name is the image's content hash, so a kept file never goes
 * stale. Every visitor reaches the ERP from this one server, so without this a busy listing page (about 24 images) would
 * spend the ERP's per-address budget quickly. The cache is bounded by bytes; the oldest image leaves first.
 */
const MEDIA_CACHE_BYTES = 96 * 1024 * 1024;
const MEDIA_FILE_MAX_CACHED = 2 * 1024 * 1024;
const mediaCache = new Map<string, Uint8Array<ArrayBuffer>>();
const mediaMissing = new Map<string, number>();
const mediaInFlight = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
let mediaCacheBytes = 0;

function keepMedia(file: string, bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.byteLength > MEDIA_FILE_MAX_CACHED) return;
  mediaCache.set(file, bytes);
  mediaCacheBytes += bytes.byteLength;
  while (mediaCacheBytes > MEDIA_CACHE_BYTES) {
    const oldest = mediaCache.keys().next().value as string;
    mediaCacheBytes -= mediaCache.get(oldest)!.byteLength;
    mediaCache.delete(oldest);
  }
}

async function fetchMedia(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { apiUrl, apiKey } = siteEnv();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/media/${file}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new StorefrontApiError(503, '/media');
  }
  if (res.status === 404) {
    if (mediaMissing.size >= CACHE_MAX) mediaMissing.delete(mediaMissing.keys().next().value as string);
    mediaMissing.set(file, Date.now());
    return null;
  }
  if (!res.ok) throw new StorefrontApiError(res.status, '/media');
  const bytes = new Uint8Array<ArrayBuffer>(await res.arrayBuffer());
  keepMedia(file, bytes);
  return bytes;
}

/**
 * An image on the site (a product's, a campaign page's or a published page's), read through this server so the key never
 * reaches the browser; null = no such image. Known limit: an image read once stays in this memory, and in a browser
 * that has it, after its product or page leaves the site, for whoever still has its exact address (a 64-character key
 * no page names any more); a restart of this server empties the memory.
 */
export async function mediaFile(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isMediaFile(file)) return null;
  const kept = mediaCache.get(file);
  if (kept) {
    // used again: it moves to the young end
    mediaCache.delete(file);
    mediaCache.set(file, kept);
    return kept;
  }
  const missingAt = mediaMissing.get(file);
  if (missingAt !== undefined && Date.now() - missingAt < NOT_FOUND_TTL_MS) return null;
  // many visitors asking for the same new image at once make one call
  let pending = mediaInFlight.get(file);
  if (!pending) {
    pending = fetchMedia(file).finally(() => mediaInFlight.delete(file));
    mediaInFlight.set(file, pending);
  }
  return pending;
}
