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
  /** v10.2.30: the nightly copy of the originals in Google Drive */
  offsite?: MediaOffsiteHealth;
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

/**
 * v10.2.30 (decision T43-a, 10.2 package 13 item 7): the nightly encrypted copy of the library's originals in Google
 * Drive, from the report `scripts/backup-media-offsite.sh` writes. No report, or a copy that is not set up, is `off` and
 * no warning; a failed copy, or none complete for more than `MEDIA_OFFSITE_STALE_HOURS`, is a warning.
 */
export type MediaOffsiteState = 'off' | 'ok' | 'stale' | 'failed' | 'unknown';

export interface MediaOffsiteHealth {
  state: MediaOffsiteState;
  /** ISO time of the last complete copy, null when there was none */
  lastOkAt: string | null;
  /** originals on the server at the last run */
  fileCount: number | null;
  message: string;
}

export interface MediaOffsiteReport {
  state: 'ok' | 'failed' | 'off';
  /** seconds since the epoch */
  at: number;
  lastOkAt: number | null;
  files: number;
  error: string;
}

/** Two nights without a complete copy */
export const MEDIA_OFFSITE_STALE_HOURS = 50;

export const MEDIA_OFFSITE_MESSAGES = {
  off: 'رونوشت کتابخانه در گوگل‌درایو راه‌اندازی نشده است.',
  ok: 'رونوشت کتابخانه در گوگل‌درایو کامل است.',
  stale: 'رونوشت کتابخانه در گوگل‌درایو بیش از دو شب است کامل نشده است؛ گزارش رونوشت کتابخانه را در پوشه گزارش‌های کارساز ببینید.',
  unknown: 'گزارش رونوشت کتابخانه در گوگل‌درایو خوانده نشد.',
} as const;

const MEDIA_OFFSITE_FAILURES: Record<string, string> = {
  'no-rclone': 'برنامه ارسال به درایو روی کارساز نصب نیست',
  'no-remote': 'مقصد درایو در تنظیمات ارسال کارساز پیدا نشد',
  'not-crypt': 'مقصد درایو رمزگذار نیست و چیزی فرستاده نشد',
  'bad-remote': 'نام مقصد در تنظیمات کارساز درست نیست',
  'copy-failed': 'ارسال پرونده‌ها کامل نشد',
  'check-failed': 'بررسی پرونده‌های فرستاده‌شده کامل نشد',
};

export function mediaOffsiteFailedMessage(code: string): string {
  const reason = MEDIA_OFFSITE_FAILURES[code] ?? 'خطای ناشناخته';
  return `آخرین رونوشت کتابخانه در گوگل‌درایو ناموفق بود: ${reason}. گزارش رونوشت کتابخانه را در پوشه گزارش‌های کارساز ببینید.`;
}

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The report, or null when the text is not one */
export function parseMediaOffsiteReport(text: string): MediaOffsiteReport | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || (r.state !== 'ok' && r.state !== 'failed' && r.state !== 'off') || !isWhole(r.at) || !isWhole(r.files)) return null;
  if (r.lastOkAt !== null && !isWhole(r.lastOkAt)) return null;
  return { state: r.state, at: r.at, lastOkAt: r.lastOkAt, files: r.files, error: typeof r.error === 'string' ? r.error : '' };
}

export function mediaOffsiteVerdict(report: MediaOffsiteReport | null, now: Date): MediaOffsiteHealth {
  if (!report || report.state === 'off') return { state: 'off', lastOkAt: null, fileCount: null, message: MEDIA_OFFSITE_MESSAGES.off };
  const lastOkAt = report.lastOkAt === null ? null : new Date(report.lastOkAt * 1000).toISOString();
  const fileCount = report.files;
  if (report.state === 'failed') return { state: 'failed', lastOkAt, fileCount, message: mediaOffsiteFailedMessage(report.error) };
  const ageHours = report.lastOkAt === null ? Infinity : (now.getTime() - report.lastOkAt * 1000) / 3_600_000;
  if (ageHours > MEDIA_OFFSITE_STALE_HOURS) return { state: 'stale', lastOkAt, fileCount, message: MEDIA_OFFSITE_MESSAGES.stale };
  return { state: 'ok', lastOkAt, fileCount, message: MEDIA_OFFSITE_MESSAGES.ok };
}

/** Whether the copy needs attention: a failed or stale copy, or an unreadable report */
export const isMediaOffsiteWarning = (o: MediaOffsiteHealth): boolean => o.state === 'failed' || o.state === 'stale' || o.state === 'unknown';
