/**
 * v10.0.18 (N-05, media library): the size, format and quality rules of a media library file, shared by the server
 * (`src/services/media/`) and the upload box, so the warnings the browser shows before sending are the ones the server
 * stores. Product-owner rules (2026-10-08): an image above 10 MB is warned, any file above 50 MB is refused, an image
 * below 200 KB is warned as possibly low quality; a short side of pixels is warned the same way.
 */

export const MB = 1024 * 1024;

/** Any file above this is refused (browser and server, 422 `MEDIA_FILE_TOO_LARGE`) */
export const MEDIA_MAX_BYTES = 50 * MB;
/** An image above this is accepted with a warning to reduce it */
export const MEDIA_IMAGE_WARN_BYTES = 10 * MB;
/** An image below this is accepted with a low quality warning */
export const MEDIA_IMAGE_LOW_BYTES = 200 * 1024;
/** An image whose long side is below this is accepted with a low quality warning */
export const MEDIA_IMAGE_LOW_PIXELS = 1000;
/** The long side of the light version of an image */
export const MEDIA_LIGHT_LONG_SIDE = 1600;
/** The long side of the thumbnail of an image or of a video poster */
export const MEDIA_THUMB_LONG_SIDE = 400;
/** A video poster the browser sends is at most this large */
export const MEDIA_POSTER_MAX_BYTES = 2 * MB;

export type MediaKind = 'image' | 'video';

/** Accepted media types and the extension the original is stored with */
export const MEDIA_TYPES: Readonly<Record<string, { kind: MediaKind; ext: string }>> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/tiff': { kind: 'image', ext: 'tif' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
};

/** Media type of a file the browser names by extension only (some browsers send an empty type for .mov or .tif) */
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export function mediaTypeOf(fileName: string, declaredType: string): string | null {
  const declared = declaredType.trim().toLowerCase();
  if (MEDIA_TYPES[declared]) return declared;
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_TYPES[ext] ?? null;
}

/** Shot types of a product file; `other` also for files of other sections */
export const MEDIA_SHOT_TYPES = ['white_background', 'side', 'detail', 'on_model', 'packaging', 'video', 'other'] as const;
export type MediaShotType = (typeof MEDIA_SHOT_TYPES)[number];

export const MEDIA_SHOT_TYPE_LABELS: Readonly<Record<MediaShotType, string>> = {
  white_background: 'پشت‌سفید',
  side: 'نمای کنار',
  detail: 'جزئیات',
  on_model: 'روی دست یا مدل',
  packaging: 'بسته‌بندی',
  video: 'فیلم کوتاه',
  other: 'سایر',
};

export type MediaWarning = 'large_image' | 'low_quality';

export const MEDIA_WARNING_TEXT: Readonly<Record<MediaWarning, string>> = {
  large_image: 'حجم تصویر بالاست؛ بهتر است آن را به کمتر از ۱۰ مگابایت برسانید.',
  low_quality: 'ممکن است کیفیت تصویر پایین باشد؛ اگر نسخه باکیفیت‌تری از آن دارید، آن را جایگزین کنید.',
};

export const MEDIA_TOO_LARGE_TEXT = 'حجم فایل بیش از ۵۰ مگابایت است و پذیرفته نمی‌شود.';
export const MEDIA_FORMAT_TEXT = 'قالب فایل پذیرفته نیست. تصویر JPG، PNG، WEBP یا TIFF و فیلم MP4، MOV یا WEBM بفرستید.';
export const MEDIA_HEIC_TEXT = 'عکس HEIC آیفون پذیرفته نیست. در تنظیمات دوربین آیفون گزینه Most Compatible را بزنید یا عکس را JPG کنید.';

/** Whether the file name is an iPhone HEIC/HEIF photo, which gets its own hint */
export function isHeicName(fileName: string): boolean {
  return /\.(heic|heif)$/i.test(fileName.trim());
}

/** The warnings of a file; pixels are known on the server, and in the browser once the image is read */
export function mediaWarnings(kind: MediaKind, sizeBytes: number, longSidePixels?: number | null): MediaWarning[] {
  if (kind !== 'image') return [];
  const warnings: MediaWarning[] = [];
  if (sizeBytes > MEDIA_IMAGE_WARN_BYTES) warnings.push('large_image');
  const smallPixels = typeof longSidePixels === 'number' && longSidePixels > 0 && longSidePixels < MEDIA_IMAGE_LOW_PIXELS;
  if (sizeBytes < MEDIA_IMAGE_LOW_BYTES || smallPixels) warnings.push('low_quality');
  return warnings;
}

/** Variants of a stored file the download route serves */
export const MEDIA_VARIANTS = ['original', 'light', 'thumb'] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/** A readable download name: «<product code>_<shot type>_<asset id>.<ext>» or «<title>_<asset id>.<ext>» */
export function mediaDownloadName(parts: { prefix: string; shotType: MediaShotType; id: number; ext: string }): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim();
  const prefix = clean(parts.prefix);
  const label = MEDIA_SHOT_TYPE_LABELS[parts.shotType] ?? '';
  return [prefix, label, String(parts.id)].filter(Boolean).join('_') + `.${parts.ext}`;
}

/** Server request timeout (server.ts): a 50 MB upload at about 250 kbit/s still finishes */
export const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
