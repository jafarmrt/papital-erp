import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.2.17 (OBS-R2-60, 10.2 package 13): image files left in `public/uploads` that no record points to any more. An image
 * field (item, transfer design, avatar, raw material request) is written by `uploadBase64ToStorage` as
 * `<optional prefix->uuid.<jpg|png|webp|gif>` and the record keeps `/uploads/<name>`; replacing the image left the old file
 * on the server. «تصویرهای بی‌صاحب» of «عملیات سامانه», by hand only and after a preview the admin confirms, moves such a
 * file to `.orphaned/<day>/` (never served, still in the backup), moves one back when a row names it again, and removes
 * only a moved file still named by no row after `ORPHAN_UPLOAD_HOLD_DAYS`. A file counts as named when its UUID appears
 * anywhere in a row, whatever the address around it. Shared by the server and the card.
 */

/** The names `uploadBase64ToStorage` writes; any other file of the folder (a public asset, a sub-folder) is never touched */
export const ORPHAN_UPLOAD_NAME_PATTERN = /^(?:[a-z]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

/** The UUID of a file name and of a reference, in JavaScript and PostgreSQL alike (matched without letter case) */
export const UPLOAD_UUID_PATTERN_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The quarantine folder under `public/uploads` (a dot folder: `/uploads` never serves it) and its day folders */
export const ORPHAN_UPLOAD_QUARANTINE_DIR = '.orphaned';
export const ORPHAN_UPLOAD_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** A quarantined file as the preview names it and the run confirms it: `<day>/<name>` */
export const ORPHAN_UPLOAD_HELD_PATTERN = new RegExp(`^\\d{4}-\\d{2}-\\d{2}/${ORPHAN_UPLOAD_NAME_PATTERN.source.slice(1)}`);

/** A file younger than this is left alone: its record may still be saving */
export const ORPHAN_UPLOAD_MIN_AGE_MINUTES = 60;
/** A moved file is removed only after this many days in the quarantine folder */
export const ORPHAN_UPLOAD_HOLD_DAYS = 30;
/** At most this many files are moved and this many removed by one run (the preview lists them all); the rest next run */
export const ORPHAN_UPLOAD_RUN_LIMIT = 2000;
/** Names re-checked against the rows, and written to one audit row, at a time */
export const ORPHAN_UPLOAD_CHUNK = 200;
/** Failures listed in the answer (the count is whole) */
export const ORPHAN_UPLOAD_LISTED_FAILURES = 50;

export interface OrphanUploadsReport {
  dryRun: boolean;
  /** image files of the uploads folder written by the image fields */
  scannedFiles: number;
  /** of those, files some row names */
  referencedFiles: number;
  /** files no row names yet, younger than the minimum age */
  recentFiles: number;
  /** top-level files no row names: to move (`names`, at most the run limit) and, on a run, moved */
  orphans: { files: number; bytes: number; moved: number; names: string[] };
  /** files in the quarantine folder */
  heldFiles: number;
  /** quarantined files past the hold no row names: to remove (`names` as `<day>/<name>`) and, on a run, removed */
  expired: { files: number; bytes: number; removed: number; names: string[] };
  /** quarantined files a row names again: moved back on a run */
  restored: { files: number; moved: number };
  /** on a run: files left alone because the admin did not confirm them or a row named them at the re-check */
  skipped: number;
  failures: Array<{ name: string; code: string }>;
  failureCount: number;
}

/** The UUIDs a stored value names, lower-cased, whatever surrounds them (`%2F`, `\/`, a bare name, any letter case) */
export function uploadUuidsIn(text: string): string[] {
  return [...text.matchAll(new RegExp(UPLOAD_UUID_PATTERN_SOURCE, 'gi'))].map(m => m[0].toLowerCase());
}

/** The UUID of a file name the image fields write */
export function uploadUuidOf(name: string): string {
  return uploadUuidsIn(name)[0] ?? '';
}

/** The day folder `<day>` is past the hold on `today` (both `YYYY-MM-DD`) */
export function isHoldOver(day: string, today: string): boolean {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= ORPHAN_UPLOAD_HOLD_DAYS * 86_400_000;
}

export function formatBytesFa(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatPersianNumber(Math.ceil(bytes / 1024))} کیلوبایت`;
  return `${formatPersianNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} مگابایت`;
}

const n = formatPersianNumber;

/** The card's sentence for a preview or a run */
export function orphanUploadsMessage(report: OrphanUploadsReport): string {
  const { orphans, expired, restored } = report;
  if (orphans.files === 0 && expired.files === 0 && restored.files === 0) {
    return 'تصویر بی‌صاحبی پیدا نشد؛ هر تصویر پوشهٔ بارگذاری‌ها به رکوردی وصل است.';
  }
  const parts: string[] = [];
  if (report.dryRun) {
    if (orphans.files > 0) parts.push(`${n(orphans.files)} تصویر (${formatBytesFa(orphans.bytes)}) به هیچ رکوردی وصل نیست و به پوشهٔ جدا منتقل می‌شود؛ بعد از ${n(ORPHAN_UPLOAD_HOLD_DAYS)} روز پاک می‌شود.`);
    if (expired.files > 0) parts.push(`${n(expired.files)} تصویر (${formatBytesFa(expired.bytes)}) بیش از ${n(ORPHAN_UPLOAD_HOLD_DAYS)} روز در پوشهٔ جدا مانده و پاک می‌شود.`);
    if (restored.files > 0) parts.push(`${n(restored.files)} تصویر پوشهٔ جدا دوباره به رکوردی وصل شده و برمی‌گردد.`);
    if (orphans.files > ORPHAN_UPLOAD_RUN_LIMIT || expired.files > ORPHAN_UPLOAD_RUN_LIMIT) parts.push(`هر اجرا حداکثر ${n(ORPHAN_UPLOAD_RUN_LIMIT)} تصویر را جابه‌جا یا پاک می‌کند؛ بقیه در اجرای بعد.`);
    return parts.join(' ');
  }
  if (orphans.moved > 0) parts.push(`${n(orphans.moved)} تصویر بی‌صاحب به پوشهٔ جدا منتقل شد و بعد از ${n(ORPHAN_UPLOAD_HOLD_DAYS)} روز پاک می‌شود.`);
  if (expired.removed > 0) parts.push(`${n(expired.removed)} تصویر پوشهٔ جدا پاک شد.`);
  if (restored.moved > 0) parts.push(`${n(restored.moved)} تصویر به پوشهٔ بارگذاری‌ها برگشت.`);
  if (report.skipped > 0) parts.push(`${n(report.skipped)} تصویر دست نخورد، چون در بررسی تأیید نشده بود یا رکوردی به آن اشاره کرد.`);
  if (report.failureCount > 0) parts.push(`${n(report.failureCount)} تصویر جابه‌جا یا پاک نشد.`);
  return parts.length > 0 ? parts.join(' ') : 'تصویری جابه‌جا یا پاک نشد.';
}
