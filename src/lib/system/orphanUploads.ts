import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.2.17 (OBS-R2-60, 10.2 package 13): image files left in `public/uploads` that no record points to any more. An image
 * field (item, transfer design, avatar, raw material request, company logo) is written by `uploadBase64ToStorage` as
 * `<optional prefix->uuid.<jpg|png|webp|gif>` and the record keeps `/uploads/<name>`; replacing the image left the old file
 * on the server. «پاک کردن تصویرهای بی‌صاحب» of «عملیات سامانه» first counts and then removes, by hand only, the files
 * that no row of any table (a soft-deleted or copied record included) names. Shared by the server and the card.
 */

/** The names `uploadBase64ToStorage` writes; any other file of the folder (a public asset, a sub-folder) is never touched */
export const ORPHAN_UPLOAD_NAME_PATTERN = /^(?:[a-z]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

/** A file younger than this is left alone: its record may still be saving */
export const ORPHAN_UPLOAD_MIN_AGE_MINUTES = 60;

/** How many removed names the answer and the audit row list */
export const ORPHAN_UPLOAD_LISTED_NAMES = 200;

export interface OrphanUploadsReport {
  dryRun: boolean;
  /** image files of the uploads folder written by the image fields */
  scannedFiles: number;
  /** of those, files some row names */
  referencedFiles: number;
  /** files no row names, older than the minimum age */
  orphans: { files: number; bytes: number; removed: number; names: string[] };
  /** files no row names yet, younger than the minimum age */
  recentFiles: number;
  failures: Array<{ name: string; error: string }>;
}

/** The file names a stored value names as `uploads/<name>`, lower-cased (a full address and a path alike) */
export function uploadNamesIn(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/uploads\/([A-Za-z0-9._-]+)/g)) names.push(m[1].toLowerCase());
  return names;
}

export function formatBytesFa(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatPersianNumber(Math.ceil(bytes / 1024))} کیلوبایت`;
  return `${formatPersianNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} مگابایت`;
}

/** The card's sentence for a preview or a run */
export function orphanUploadsMessage(report: OrphanUploadsReport): string {
  if (report.orphans.files === 0) return 'تصویر بی‌صاحبی پیدا نشد؛ هر تصویر پوشهٔ بارگذاری‌ها به رکوردی وصل است.';
  if (report.dryRun) {
    return `${formatPersianNumber(report.orphans.files)} تصویر (${formatBytesFa(report.orphans.bytes)}) به هیچ رکوردی وصل نیست و پاک کردنی است.`;
  }
  const failed = report.failures.length > 0 ? ` ${formatPersianNumber(report.failures.length)} تصویر پاک نشد.` : '';
  return `${formatPersianNumber(report.orphans.removed)} تصویر بی‌صاحب (${formatBytesFa(report.orphans.bytes)}) پاک شد.${failed}`;
}
