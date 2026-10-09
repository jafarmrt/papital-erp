import { API_URL, ApiError, fetchJson, getAuthToken, getCsrfToken, setCsrfToken } from '../../api';
import type { MediaKind, MediaShotType, MediaVariant, MediaWarning } from './mediaRules';

/**
 * v10.0.25 (N-05 PR 2): the browser side of the media library API. Reads go through `fetchJson`; the zip download reads a
 * binary answer, so it uses `fetch` with the session cookie and the CSRF header itself.
 */

export interface MediaAssetView {
  id: number;
  sectionId: number;
  itemId: number | null;
  kind: MediaKind;
  shotType: MediaShotType;
  title: string;
  description: string;
  sortOrder: number;
  isCover: boolean;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  isLowQuality: boolean;
  hasLight: boolean;
  hasThumb: boolean;
  lightFailed: boolean;
  createdBy: string;
  createdAt: string | null;
  version: number;
  warnings: MediaWarning[];
  /** v10.0.27 (N-05 PR 3): free tags of the file, read with `normalizeMediaTags` */
  tags: string[];
}

export interface MediaProductRow {
  itemId: number;
  code: string;
  name: string;
  category: string | null;
  collections: string[];
  designYear: number | null;
  transferCode: string | null;
  assetCount: number;
  imageCount: number;
  videoCount: number;
  lowQualityCount: number;
  coverAssetId: number | null;
  coverHasThumb: boolean;
}

export interface MediaProductPage {
  data: MediaProductRow[];
  total: number;
  page: number;
  limit: number;
}

export interface MediaProductFilterOptions {
  collections: string[];
  designYears: number[];
  transferCodes: string[];
  categories: string[];
}

export interface MediaProductItem {
  id: number;
  code: string;
  name: string;
  category: string | null;
  unit: string | null;
  color: string | null;
  material: string | null;
  size: string | null;
  weight: number | string | null;
  collections: string[];
  designYear: number | null;
  transferCode: string | null;
  productDescription: string | null;
  technicalNotes: string | null;
  version: number;
}

export interface MediaProductDetail {
  item: MediaProductItem;
  assets: MediaAssetView[];
  productsSectionId: number;
}

export interface MediaProductInfoInput {
  version: number;
  collections?: string[];
  designYear?: number | null;
  transferCode?: string | null;
  productDescription?: string | null;
  technicalNotes?: string | null;
}

export interface MediaAssetEditInput {
  version: number;
  title?: string;
  description?: string;
  shotType?: MediaShotType;
  sortOrder?: number;
  tags?: string[];
}

/** Search conditions of the product grid; every one goes to the server, nothing is filtered in the browser */
export interface MediaProductQuery {
  search: string;
  collection: string;
  designYear: string;
  transferCode: string;
  category: string;
  withoutImages: boolean;
  withoutWhiteBackground: boolean;
  lowQuality: boolean;
  page: number;
}

export const MEDIA_PRODUCTS_PAGE_SIZE = 24;

const TEXT_KEYS = ['search', 'collection', 'designYear', 'transferCode', 'category'] as const;
const FLAG_KEYS = ['withoutImages', 'withoutWhiteBackground', 'lowQuality'] as const;

export function mediaProductQueryFrom(params: URLSearchParams): MediaProductQuery {
  const page = Number(params.get('page'));
  return {
    search: params.get('search') ?? '',
    collection: params.get('collection') ?? '',
    designYear: params.get('designYear') ?? '',
    transferCode: params.get('transferCode') ?? '',
    category: params.get('category') ?? '',
    withoutImages: params.get('withoutImages') === '1',
    withoutWhiteBackground: params.get('withoutWhiteBackground') === '1',
    lowQuality: params.get('lowQuality') === '1',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The query string of the conditions (also the address of the page): empty conditions and page 1 are left out */
export function mediaProductQueryParams(query: MediaProductQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = query[key].trim();
    if (value) params.set(key, value);
  }
  for (const key of FLAG_KEYS) if (query[key]) params.set(key, '1');
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}

export function listMediaProducts(query: MediaProductQuery, signal?: AbortSignal): Promise<MediaProductPage> {
  const params = mediaProductQueryParams(query);
  params.set('page', String(query.page));
  params.set('limit', String(MEDIA_PRODUCTS_PAGE_SIZE));
  return fetchJson<MediaProductPage>(`/media/products?${params.toString()}`, { signal });
}

export function getMediaProductFilters(signal?: AbortSignal): Promise<MediaProductFilterOptions> {
  return fetchJson<MediaProductFilterOptions>('/media/products/filters', { signal });
}

export function getMediaProduct(itemId: number, signal?: AbortSignal): Promise<MediaProductDetail> {
  return fetchJson<MediaProductDetail>(`/media/products/${itemId}`, { signal });
}

export async function updateMediaProductInfo(itemId: number, input: MediaProductInfoInput): Promise<MediaProductItem> {
  const res = await fetchJson<{ data: MediaProductItem }>(`/media/products/${itemId}/info`, { method: 'PUT', body: JSON.stringify(input) });
  return res.data;
}

export async function updateMediaAsset(id: number, input: MediaAssetEditInput): Promise<MediaAssetView> {
  const res = await fetchJson<{ data: MediaAssetView }>(`/media/assets/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  return res.data;
}

export async function deleteMediaAsset(id: number): Promise<void> {
  await fetchJson(`/media/assets/${id}`, { method: 'DELETE' });
}

/** Address of a stored file; an <img> or <video> reads it with the session cookie */
export function mediaFileUrl(id: number, variant: MediaVariant, download = false): string {
  return `${API_URL}/media/assets/${id}/file?variant=${variant}${download ? '&download=1' : ''}`;
}

export const OCC_CONFLICT_TEXT = 'این مورد را کاربر دیگری تغییر داده است؛ صفحه را دوباره بارگذاری کنید.';

/** The Persian message of a failed request; a stale version asks the user to reload */
export function mediaErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'OCC_CONFLICT') return OCC_CONFLICT_TEXT;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** The CSRF token of the session, fetched once when the page has none yet */
export async function ensureCsrfToken(): Promise<string | null> {
  const held = getCsrfToken();
  if (held) return held;
  try {
    const res = await fetch(`${API_URL}/auth/csrf`, { credentials: 'include' });
    const body = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
    if (body?.csrfToken) {
      setCsrfToken(body.csrfToken);
      return body.csrfToken;
    }
  } catch {
    // the request itself then reports the missing token
  }
  return null;
}

/** File name of a `Content-Disposition` header; `filename*=UTF-8''` first */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

export const MEDIA_ZIP_MAX_ASSETS = 500;
export const MEDIA_ZIP_FALLBACK_NAME = 'کتابخانه-تصاویر.zip';

/** Address of the zip of the chosen files (a GET, so a viewer with media.view alone may download) */
export function mediaZipUrl(assetIds: number[], variant: 'original' | 'light'): string {
  return `${API_URL}/media/zip?ids=${assetIds.slice(0, MEDIA_ZIP_MAX_ASSETS).join(',')}&variant=${variant}`;
}

/** Downloads the chosen files as one zip and saves it */
export async function downloadMediaZip(assetIds: number[], variant: 'original' | 'light'): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(mediaZipUrl(assetIds, variant), {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(body?.message || 'ساخت فایل فشرده ناموفق بود.', body?.code ?? 'MEDIA_ZIP_FAILED', res.status);
  }
  const blob = await res.blob();
  saveBlob(blob, fileNameFromDisposition(res.headers.get('Content-Disposition'), MEDIA_ZIP_FALLBACK_NAME));
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
