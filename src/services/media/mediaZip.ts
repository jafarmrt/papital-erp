import fs from 'fs';
import type { Writable } from 'stream';
import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, mediaAssets } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { businessNowIsoDateTime } from '../../lib/businessClock.js';
import { ZipStreamWriter } from '../../lib/zipStream.js';
import { mediaDownloadName, type MediaShotType } from '../../lib/media/mediaRules.js';
import { extensionOfType, mediaFilePath } from './mediaStorage.js';

/**
 * v10.0.22 (N-05 PR 2): several library files in one zip, streamed from disk (`ZipStreamWriter`, no file held in memory).
 * The light variant of an image is its webp light version; a video, or an image whose light version is missing, goes in
 * its original. The whole zip is planned before the first byte: an unknown or deleted id is 422 and a zip above
 * `MEDIA_ZIP_MAX_BYTES` 422 `MEDIA_ZIP_TOO_LARGE`, so the browser gets a real error instead of a broken download.
 */

export const MEDIA_ZIP_MAX_BYTES = 1024 * 1024 * 1024;
export const MEDIA_ZIP_MAX_FILES = 500;

export type MediaZipVariant = 'original' | 'light';

export interface MediaZipEntry {
  assetId: number;
  name: string;
  path: string;
  bytes: number;
}

/** Entries of the zip in the order asked, each with a unique name */
export async function planMediaZip(assetIds: readonly number[], variant: MediaZipVariant): Promise<MediaZipEntry[]> {
  const ids = [...new Set(assetIds)];
  const rows = await orm.select().from(mediaAssets).where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.isDeleted, 0)));
  const byId = new Map(rows.map(r => [r.id, r]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`${missing.length.toLocaleString('fa-IR')} فایل انتخاب‌شده یافت نشد یا حذف شده است.`,
      { missing }, 'MEDIA_ZIP_ASSETS_INVALID');
  }
  const itemIds = [...new Set(rows.map(r => r.itemId).filter((v): v is number => v !== null))];
  const codes = new Map<number, string>();
  if (itemIds.length > 0) {
    for (const it of await orm.select({ id: items.id, code: items.code }).from(items).where(inArray(items.id, itemIds))) {
      codes.set(it.id, it.code);
    }
  }

  const used = new Set<string>();
  const entries: MediaZipEntry[] = [];
  let total = 0;
  for (const id of ids) {
    const row = byId.get(id)!;
    const ext = extensionOfType(row.mimeType);
    const light = variant === 'light' && row.kind === 'image' && row.lightBytes !== null;
    const prefix = (row.itemId !== null ? codes.get(row.itemId) : undefined) || row.title.trim() || 'papital';
    const base = mediaDownloadName({ prefix, shotType: row.shotType as MediaShotType, id: row.id, ext: light ? 'webp' : ext });
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = base.replace(/(\.[^.]+)?$/, m => `-${n}${m}`);
    used.add(name.toLowerCase());
    const bytes = light ? row.lightBytes! : row.sizeBytes;
    total += bytes;
    entries.push({ assetId: id, name, path: mediaFilePath(row.sha256, light ? 'light' : 'original', ext), bytes });
  }
  if (total > MEDIA_ZIP_MAX_BYTES) {
    throw new ValidationError('حجم فایل‌های انتخاب‌شده از یک گیگابایت بیشتر است؛ فایل‌های کمتری انتخاب کنید.',
      { totalBytes: total }, 'MEDIA_ZIP_TOO_LARGE');
  }
  return entries;
}

/** Writes the planned entries as a zip into `out` and ends it */
export async function writeMediaZip(out: Writable, entries: readonly MediaZipEntry[]): Promise<void> {
  const zip = new ZipStreamWriter(out, await businessNowIsoDateTime());
  for (const entry of entries) {
    await zip.addEntry(entry.name, fs.createReadStream(entry.path));
  }
  await zip.finish();
}
