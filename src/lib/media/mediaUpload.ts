import { API_URL, getAuthToken } from '../../api';
import {
  MEDIA_FORMAT_TEXT, MEDIA_HEIC_TEXT, MEDIA_MAX_BYTES, MEDIA_POSTER_MAX_BYTES, MEDIA_THUMB_LONG_SIDE, MEDIA_TOO_LARGE_TEXT, MEDIA_TYPES,
  isHeicName, mediaTypeOf, mediaWarnings, type MediaKind, type MediaShotType, type MediaWarning,
} from './mediaRules';
import { ensureCsrfToken, type MediaAssetView } from './mediaApi';

/**
 * v10.0.25 (N-05 PR 2): checks a file before upload with the server's rules (`mediaRules.ts`) and sends it as the raw
 * request body with `XMLHttpRequest`, so each file shows its own progress. A video gets a poster made in the browser.
 */

export type MediaPrecheck =
  | { ok: false; error: string }
  | { ok: true; type: string; kind: MediaKind; warnings: MediaWarning[] };

/** Size, HEIC and format checks that need no reading of the file */
export function checkMediaFile(file: { name: string; type: string; size: number }, longSidePixels?: number | null): MediaPrecheck {
  if (isHeicName(file.name)) return { ok: false, error: MEDIA_HEIC_TEXT };
  const type = mediaTypeOf(file.name, file.type || '');
  if (!type) return { ok: false, error: MEDIA_FORMAT_TEXT };
  if (file.size > MEDIA_MAX_BYTES) return { ok: false, error: MEDIA_TOO_LARGE_TEXT };
  const kind = MEDIA_TYPES[type].kind;
  return { ok: true, type, kind, warnings: mediaWarnings(kind, file.size, longSidePixels) };
}

/** The long side of an image in pixels, or null when the browser cannot read it (TIFF, for example) */
export function readImageLongSide(file: Blob): Promise<number | null> {
  if (typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    img.onload = () => done(Math.max(img.naturalWidth, img.naturalHeight) || null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Full check of a file: the size checks first, then the image's pixels for the low quality warning */
export async function precheckMediaFile(file: File): Promise<MediaPrecheck> {
  const first = checkMediaFile(file);
  if (!first.ok || first.kind !== 'image') return first;
  return checkMediaFile(file, await readImageLongSide(file));
}

export const DEFAULT_SHOT_TYPE: Readonly<Record<MediaKind, MediaShotType>> = { image: 'white_background', video: 'video' };

export class MediaUploadError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

export interface UploadAnswer {
  data: MediaAssetView;
  warnings: MediaWarning[];
}

interface RawSend {
  method: 'POST' | 'PUT';
  url: string;
  body: Blob;
  contentType: string;
  fileName: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const NETWORK_TEXT = 'ارتباط با کارساز قطع شد؛ وضعیت فایل را بررسی کنید و در صورت نیاز دوباره بفرستید.';

/** Sends a raw body with the session cookie, the CSRF header and the file name */
export async function sendRawFile<T>(req: RawSend): Promise<T> {
  const csrf = await ensureCsrfToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(req.method, req.url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', req.contentType);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(req.fileName));
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (req.onProgress && xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) req.onProgress?.(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      let body: { message?: string; code?: string } & Record<string, unknown> = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new MediaUploadError(body.message || 'بارگذاری فایل ناموفق بود.', body.code ?? 'MEDIA_UPLOAD_FAILED', xhr.status));
    };
    xhr.onerror = () => reject(new MediaUploadError(NETWORK_TEXT, 'NETWORK_ERROR', 0));
    xhr.onabort = () => reject(new MediaUploadError('بارگذاری لغو شد.', 'ABORTED', 0));
    req.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(req.body);
  });
}

export interface UploadTarget {
  sectionId: number;
  itemId?: number | null;
  shotType: MediaShotType;
}

export function uploadUrl(target: UploadTarget): string {
  const params = new URLSearchParams({ sectionId: String(target.sectionId) });
  if (target.itemId) params.set('itemId', String(target.itemId));
  params.set('shotType', target.shotType);
  return `${API_URL}/media/assets?${params.toString()}`;
}

export function uploadMediaFile(file: File, type: string, target: UploadTarget, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadAnswer> {
  return sendRawFile<UploadAnswer>({ method: 'POST', url: uploadUrl(target), body: file, contentType: type, fileName: file.name, onProgress, signal });
}

/** A duration the poster route accepts: at most two decimals */
export function posterDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return String(Math.round(seconds * 100) / 100);
}

export interface VideoPoster {
  blob: Blob;
  durationSeconds: number | null;
}

/** A JPEG poster of a video at about one second, at most 400 px on its long side */
export function posterFromVideo(file: Blob, timeoutMs = 20000): Promise<VideoPoster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const timer = setTimeout(() => finish(new Error('poster timeout')), timeoutMs);
    function finish(err: Error | null, poster?: VideoPoster) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      if (err || !poster) reject(err ?? new Error('poster failed'));
      else resolve(poster);
    }
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(1, duration > 0 ? duration / 2 : 0);
    };
    video.onseeked = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return finish(new Error('video has no frame'));
      const scale = Math.min(1, MEDIA_THUMB_LONG_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(new Error('no canvas'));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size > MEDIA_POSTER_MAX_BYTES) return finish(new Error('poster too large'));
        finish(null, { blob, durationSeconds: Number.isFinite(video.duration) ? video.duration : null });
      }, 'image/jpeg', 0.8);
    };
    video.onerror = () => finish(new Error('video unreadable'));
    video.src = url;
  });
}

export function uploadVideoPoster(assetId: number, poster: VideoPoster): Promise<unknown> {
  const duration = poster.durationSeconds === null ? null : posterDuration(poster.durationSeconds);
  const query = duration ? `?durationSeconds=${duration}` : '';
  return sendRawFile({
    method: 'PUT', url: `${API_URL}/media/assets/${assetId}/poster${query}`, body: poster.blob, contentType: 'image/jpeg', fileName: `poster-${assetId}.jpg`,
  });
}

/**
 * v10.0.27 (N-05 PR 3): replaces a file with a better version of the same kind (`PUT /media/assets/:id/content`, raw
 * body like an upload); title, description, tags, order and cover are kept by the server.
 */
export function replaceMediaFileContent(assetId: number, file: File, type: string, onProgress?: (fraction: number) => void): Promise<UploadAnswer> {
  return sendRawFile<UploadAnswer>({
    method: 'PUT', url: `${API_URL}/media/assets/${assetId}/content`, body: file, contentType: type, fileName: file.name, onProgress,
  });
}

export const MEDIA_REPLACE_KIND_TEXT: Readonly<Record<MediaKind, string>> = {
  image: 'این فایل تصویر است؛ فقط با تصویر دیگری جایگزین می‌شود.',
  video: 'این فایل فیلم است؛ فقط با فیلم دیگری جایگزین می‌شود.',
};

/** The accept attribute of a replacement file input: only files of the asset's own kind */
export function replaceAcceptOf(kind: MediaKind): string {
  return Object.entries(MEDIA_TYPES)
    .filter(([, t]) => t.kind === kind)
    .map(([mime, t]) => `${mime},.${t.ext}`)
    .join(',') + (kind === 'image' ? ',.jpeg,.tiff' : ',.m4v');
}
