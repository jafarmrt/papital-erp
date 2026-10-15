import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.1.3 (N-05 PR 4): contract of the media library card on the health page, shared by the server
 * (`SystemHealthService.checkMediaLibrary`) and the card (`MediaLibraryHealthCard`). Sizes are of the live files' contents,
 * each content counted once, since rows holding the same file share one copy on disk. Free space is of the disk holding
 * the library directory. A failed read is `unknown` with null figures, never zeros.
 */

export type MediaLibraryHealthStatus = 'ok' | 'warning' | 'unknown';

export interface MediaLibraryHealth {
  status: MediaLibraryHealthStatus;
  path: string;
  /** live rows, and among them images and videos */
  fileCount: number | null;
  imageCount: number | null;
  videoCount: number | null;
  /** bytes of the originals, light versions and thumbnails of the distinct live contents */
  originalBytes: number | null;
  lightBytes: number | null;
  thumbBytes: number | null;
  /** live images whose light version failed (`light_error`), and those that have none without an error */
  lightFailedCount: number | null;
  lightMissingCount: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  messages: string[];
}

/** The terminal command that rebuilds light versions; the card shows it only among the technical details */
export const MEDIA_REBUILD_LIGHT_COMMAND = 'npm run media:rebuild-light -- --apply';

/** Free space below this share of the disk, or below `MEDIA_DISK_LOW_BYTES`, is a warning */
export const MEDIA_DISK_LOW_RATIO = 0.1;
export const MEDIA_DISK_LOW_BYTES = 5 * 1024 * 1024 * 1024;

export const MEDIA_LIBRARY_HEALTH_MESSAGES = {
  ok: 'کتابخانه تصاویر سالم است.',
  unknown: 'وضعیت کتابخانه تصاویر خوانده نشد. جزئیات در گزارش خطاهای کارساز ثبت شده است.',
  diskUnknown: 'فضای آزاد دیسک کتابخانه خوانده نشد.',
} as const;

export function lightFailedMessage(count: number): string {
  return `نسخه سبک ${formatPersianNumber(count)} تصویر ساخته نشد؛ فرمان ساخت دوباره نسخه‌های سبک را روی کارساز اجرا کنید.`;
}

export function lightMissingMessage(count: number): string {
  return `${formatPersianNumber(count)} تصویر هنوز نسخه سبک ندارد؛ فرمان ساخت دوباره نسخه‌های سبک را روی کارساز اجرا کنید.`;
}

export function diskLowMessage(freeBytes: number): string {
  return `فضای آزاد دیسک کتابخانه کم است (${formatByteSize(freeBytes)})؛ پیش از بارگذاری فیلم و عکس تازه فضا را بیشتر کنید.`;
}

/** Whether the free space of the library disk is low */
export function isDiskLow(freeBytes: number, totalBytes: number): boolean {
  return freeBytes < MEDIA_DISK_LOW_BYTES || (totalBytes > 0 && freeBytes / totalBytes < MEDIA_DISK_LOW_RATIO);
}

/**
 * Status and messages of the card from its figures: a failed or missing light version, or low free space, is a warning.
 */
export function mediaLibraryVerdict(h: Pick<MediaLibraryHealth, 'lightFailedCount' | 'lightMissingCount' | 'diskFreeBytes' | 'diskTotalBytes'>):
  { status: MediaLibraryHealthStatus; messages: string[] } {
  const messages: string[] = [];
  if ((h.lightFailedCount ?? 0) > 0) messages.push(lightFailedMessage(h.lightFailedCount ?? 0));
  if ((h.lightMissingCount ?? 0) > 0) messages.push(lightMissingMessage(h.lightMissingCount ?? 0));
  if (h.diskFreeBytes === null || h.diskTotalBytes === null) messages.push(MEDIA_LIBRARY_HEALTH_MESSAGES.diskUnknown);
  else if (isDiskLow(h.diskFreeBytes, h.diskTotalBytes)) messages.push(diskLowMessage(h.diskFreeBytes));
  const warning = messages.some(m => m !== MEDIA_LIBRARY_HEALTH_MESSAGES.diskUnknown);
  return { status: warning ? 'warning' : 'ok', messages: messages.length > 0 ? messages : [MEDIA_LIBRARY_HEALTH_MESSAGES.ok] };
}

const BYTE_UNITS: ReadonlyArray<[number, string]> = [
  [1024 ** 4, 'ترابایت'], [1024 ** 3, 'گیگابایت'], [1024 ** 2, 'مگابایت'], [1024, 'کیلوبایت'],
];

/** «۱٫۵ گیگابایت», with Persian digits; below one kilobyte in bytes */
export function formatByteSize(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  for (const [size, unit] of BYTE_UNITS) {
    if (value >= size) return `${formatPersianNumber(Math.round((value / size) * 10) / 10)} ${unit}`;
  }
  return `${formatPersianNumber(value)} بایت`;
}
