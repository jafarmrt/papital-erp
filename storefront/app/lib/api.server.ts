import type {
  StorefrontCatalogPage, StorefrontFacet, StorefrontProductDetail, StorefrontPublicBrand, StorefrontPublicSettings,
} from '@erp/storefront/storefrontContracts';
import { siteEnv } from './site.server';
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

const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MAX = 500;

async function get<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
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
  if (!res.ok) throw new StorefrontApiError(res.status, path);
  const value = await res.json() as T;
  if (ttlMs > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(path, { at: Date.now(), value });
  }
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

export async function product(slug: string): Promise<StorefrontProductDetail | null> {
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

const MEDIA_FILE = /^[0-9a-f]{64}(-thumb)?\.webp$/;
export const isMediaFile = (file: string) => MEDIA_FILE.test(file);

/** An image of a product on the site, streamed through this server so the key never reaches the browser */
export async function mediaFile(file: string): Promise<Response | null> {
  if (!isMediaFile(file)) return null;
  const { apiUrl, apiKey } = siteEnv();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/media/${file}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new StorefrontApiError(503, '/media');
  }
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new StorefrontApiError(res.status, '/media');
  return res;
}
