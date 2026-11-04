import type {
  StorefrontCatalogPage, StorefrontFacet, StorefrontFeedItem, StorefrontProductDetail, StorefrontPublicBrand, StorefrontPublicSettings,
} from '@erp/storefront/storefrontContracts';
import type { StorefrontPublicRedirect, StorefrontPublicSeo } from '@erp/storefront/storefrontSeoContracts';
import { siteEnv } from './site.server';
import { STOREFRONT_QUERY_TEXT_MAX, STOREFRONT_SLUG_MAX } from '@erp/storefront/storefrontRules';
import { CATALOG_PAGE_SIZE, type CatalogSort } from './catalog';

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

const cache = new Map<string, { at: number; value: unknown; status?: number }>();
const CACHE_MAX = 500;
/** An address the ERP does not know (a crawler walking random slugs) is remembered this long, so it costs one call */
const NOT_FOUND_TTL_MS = 60_000;

function remember(path: string, entry: { at: number; value: unknown; status?: number }) {
  cache.delete(path);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(path, entry);
}

async function get<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  if (hit?.status === 404 && Date.now() - hit.at < NOT_FOUND_TTL_MS) throw new StorefrontApiError(404, path);
  if (hit && hit.status === undefined && Date.now() - hit.at < ttlMs) return hit.value as T;
  const { apiUrl, apiKey } = siteEnv();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorefrontApiError(503, path);
  }
  if (res.status === 404) remember(path, { at: Date.now(), value: null, status: 404 });
  if (!res.ok) throw new StorefrontApiError(res.status, path);
  const value = await res.json() as T;
  if (ttlMs > 0) remember(path, { at: Date.now(), value });
  return value;
}

export interface CatalogQuery {
  page?: number;
  limit?: number;
  q?: string;
  collection?: string;
  category?: string;
  sort?: CatalogSort;
}

export function catalog(query: CatalogQuery): Promise<StorefrontCatalogPage> {
  const params = new URLSearchParams();
  if (query.page && query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(query.limit ?? CATALOG_PAGE_SIZE));
  if (query.q) params.set('q', query.q);
  if (query.collection) params.set('collection', query.collection);
  if (query.category) params.set('category', query.category);
  if (query.sort && query.sort !== 'default') params.set('sort', query.sort);
  return get<StorefrontCatalogPage>(`/products?${params}`, CATALOG_TTL_MS);
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

const FEED_TTL_MS = 600_000;

/** v11 phase 8.5b: every item on the site with its feed fields; read only by the feed, which is fetched a few times a day */
export async function feed(): Promise<StorefrontFeedItem[]> {
  return (await get<{ data: StorefrontFeedItem[] }>('/feed', FEED_TTL_MS)).data;
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
 * Product images, kept in this server's memory once read: a name is the image's content hash, so a kept file never goes
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

/** A product image on the site, read through this server so the key never reaches the browser; null = no such image */
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
