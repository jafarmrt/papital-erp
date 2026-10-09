import { fetchJson } from '../../api';
import { MEDIA_SHOT_TYPES, type MediaKind, type MediaShotType } from './mediaRules';
import type { MediaAssetView } from './mediaApi';

/**
 * v10.0.27 (N-05 PR 3): sections of the media library («محصولات» and the sections a manager adds), the files of a custom
 * section with their search conditions in the page address, tags, and the manager's order, cover and item-picture actions.
 */

export type MediaSectionKind = 'products' | 'custom';

export interface MediaSection {
  id: number;
  kind: MediaSectionKind;
  title: string;
  description: string;
  sortOrder: number;
  version: number;
  assetCount: number;
}

export interface MediaSectionInput {
  title: string;
  description?: string;
}

export function listMediaSections(signal?: AbortSignal): Promise<MediaSection[]> {
  return fetchJson<{ data: MediaSection[] }>('/media/sections', { signal })
    .then(res => (Array.isArray(res?.data) ? res.data : []));
}

export async function createMediaSection(input: MediaSectionInput): Promise<MediaSection> {
  const res = await fetchJson<{ data: MediaSection }>('/media/sections', { method: 'POST', body: JSON.stringify(input) });
  return res.data;
}

export async function updateMediaSection(id: number, input: MediaSectionInput & { version: number }): Promise<MediaSection> {
  const res = await fetchJson<{ data: MediaSection }>(`/media/sections/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  return res.data;
}

export async function deleteMediaSection(id: number): Promise<void> {
  await fetchJson(`/media/sections/${id}`, { method: 'DELETE' });
}

/** Sends every live section id in the new order and returns the sections as stored */
export async function reorderMediaSections(ids: number[]): Promise<MediaSection[]> {
  const res = await fetchJson<{ data: MediaSection[] }>('/media/sections/order', { method: 'PUT', body: JSON.stringify({ ids }) });
  return Array.isArray(res?.data) ? res.data : [];
}

/** The ids with one id moved one place earlier (-1) or later (+1); the same list when it cannot move */
export function movedIds(ids: number[], id: number, step: -1 | 1): number[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function getMediaTags(sectionId?: number | null, signal?: AbortSignal): Promise<string[]> {
  const query = sectionId ? `?sectionId=${sectionId}` : '';
  return fetchJson<{ data: string[] }>(`/media/tags${query}`, { signal })
    .then(res => (Array.isArray(res?.data) ? res.data : []));
}

/** Search conditions of a custom section's files; every one goes to the server */
export interface MediaSectionQuery {
  search: string;
  tag: string;
  kind: '' | MediaKind;
  shotType: '' | MediaShotType;
  lowQuality: boolean;
  page: number;
}

export const MEDIA_SECTION_PAGE_SIZE = 60;
export const EMPTY_SECTION_QUERY: MediaSectionQuery = { search: '', tag: '', kind: '', shotType: '', lowQuality: false, page: 1 };

/** The section chosen in the page address; null means the products grid */
export function sectionIdFrom(params: URLSearchParams): number | null {
  const id = Number(params.get('section'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function mediaSectionQueryFrom(params: URLSearchParams): MediaSectionQuery {
  const kind = params.get('kind');
  const shotType = params.get('shotType') ?? '';
  const page = Number(params.get('page'));
  return {
    search: params.get('search') ?? '',
    tag: params.get('tag') ?? '',
    kind: kind === 'image' || kind === 'video' ? kind : '',
    shotType: (MEDIA_SHOT_TYPES as readonly string[]).includes(shotType) ? shotType as MediaShotType : '',
    lowQuality: params.get('lowQuality') === '1',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The page address of a section and its conditions: empty conditions and page 1 are left out */
export function mediaSectionQueryParams(sectionId: number, query: MediaSectionQuery): URLSearchParams {
  const params = new URLSearchParams({ section: String(sectionId) });
  const search = query.search.trim();
  const tag = query.tag.trim();
  if (search) params.set('search', search);
  if (tag) params.set('tag', tag);
  if (query.kind) params.set('kind', query.kind);
  if (query.shotType) params.set('shotType', query.shotType);
  if (query.lowQuality) params.set('lowQuality', '1');
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}

export function hasSectionConditions(query: MediaSectionQuery): boolean {
  return Boolean(query.search.trim() || query.tag.trim() || query.kind || query.shotType || query.lowQuality);
}

export interface MediaAssetPage {
  data: MediaAssetView[];
  total: number;
  page: number;
  limit: number;
}

export function listSectionAssets(sectionId: number, query: MediaSectionQuery, signal?: AbortSignal): Promise<MediaAssetPage> {
  const params = mediaSectionQueryParams(sectionId, query);
  params.delete('section');
  params.set('sectionId', String(sectionId));
  params.set('page', String(query.page));
  params.set('limit', String(MEDIA_SECTION_PAGE_SIZE));
  return fetchJson<MediaAssetPage>(`/media/assets?${params.toString()}`, { signal });
}

/** Sends all live files of the section (and of the product when `itemId`) in the new order */
export async function reorderMediaAssets(input: { sectionId: number; itemId?: number | null; ids: number[] }): Promise<MediaAssetView[]> {
  const body = input.itemId ? input : { sectionId: input.sectionId, ids: input.ids };
  const res = await fetchJson<{ data: MediaAssetView[] }>('/media/assets/order', { method: 'PUT', body: JSON.stringify(body) });
  return Array.isArray(res?.data) ? res.data : [];
}

/** Makes a product image the cover (or not); answers all live files of that product */
export async function setMediaAssetCover(id: number, cover: boolean): Promise<MediaAssetView[]> {
  const res = await fetchJson<{ data: MediaAssetView[] }>(`/media/assets/${id}/cover`, { method: 'PUT', body: JSON.stringify({ cover }) });
  return Array.isArray(res?.data) ? res.data : [];
}

export interface MediaItemImageAnswer {
  itemId: number;
  image: string;
  thumbnail: string;
  version: number;
}

/** Copies the light version of a product image into the item's picture; `version` is the item's version */
export async function copyMediaAssetToItemImage(id: number, version: number): Promise<MediaItemImageAnswer> {
  const res = await fetchJson<{ data: MediaItemImageAnswer }>(`/media/assets/${id}/item-image`, { method: 'POST', body: JSON.stringify({ version }) });
  return res.data;
}
