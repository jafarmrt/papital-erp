import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { mediaAssets } from '../../db/schema.js';
import { getMediaRoot } from '../../lib/media/mediaRoot.js';
import {
  MEDIA_LIBRARY_HEALTH_MESSAGES, mediaLibraryVerdict, type MediaLibraryHealth,
} from '../../lib/system/mediaLibraryHealth.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils.js';

export type { MediaLibraryHealth };

/**
 * v10.1.2 (N-05 PR 4): the media library card of the health page. Counts and sizes come from the live rows in one
 * query (each content once: rows holding the same file share one copy on disk); free space from `statfs` of the library
 * directory, or of its nearest existing parent before the first upload. Nothing is created or written.
 */
export async function readMediaLibraryHealth(): Promise<MediaLibraryHealth> {
  const root = getMediaRoot();
  try {
    const result = await orm.execute(sql`
      WITH live AS (
        SELECT ${mediaAssets.kind} AS kind, ${mediaAssets.sha256} AS sha256, ${mediaAssets.sizeBytes} AS size_bytes,
               ${mediaAssets.lightBytes} AS light_bytes, ${mediaAssets.thumbBytes} AS thumb_bytes, ${mediaAssets.lightError} AS light_error
        FROM ${mediaAssets} WHERE ${mediaAssets.isDeleted} = 0
      ), contents AS (
        SELECT sha256, max(size_bytes) AS size_bytes, max(light_bytes) AS light_bytes, max(thumb_bytes) AS thumb_bytes
        FROM live GROUP BY sha256
      )
      SELECT
        (SELECT count(*) FROM live)::int AS file_count,
        (SELECT count(*) FROM live WHERE kind = 'image')::int AS image_count,
        (SELECT count(*) FROM live WHERE kind = 'video')::int AS video_count,
        (SELECT coalesce(sum(size_bytes), 0) FROM contents)::text AS original_bytes,
        (SELECT coalesce(sum(light_bytes), 0) FROM contents)::text AS light_bytes,
        (SELECT coalesce(sum(thumb_bytes), 0) FROM contents)::text AS thumb_bytes,
        (SELECT count(*) FROM live WHERE kind = 'image' AND light_error <> '')::int AS light_failed,
        (SELECT count(*) FROM live WHERE kind = 'image' AND light_error = '' AND (light_bytes IS NULL OR thumb_bytes IS NULL))::int AS light_missing
    `);
    const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
    const disk = await diskSpace(root);
    const figures = {
      fileCount: Number(row.file_count ?? 0),
      imageCount: Number(row.image_count ?? 0),
      videoCount: Number(row.video_count ?? 0),
      originalBytes: Number(row.original_bytes ?? 0),
      lightBytes: Number(row.light_bytes ?? 0),
      thumbBytes: Number(row.thumb_bytes ?? 0),
      lightFailedCount: Number(row.light_failed ?? 0),
      lightMissingCount: Number(row.light_missing ?? 0),
      diskFreeBytes: disk?.free ?? null,
      diskTotalBytes: disk?.total ?? null,
    };
    return { path: root, ...figures, ...mediaLibraryVerdict(figures) };
  } catch (err) {
    logger.warn('Health check of the media library failed', { error: errorMessageOf(err) });
    return {
      status: 'unknown', path: root, fileCount: null, imageCount: null, videoCount: null, originalBytes: null, lightBytes: null,
      thumbBytes: null, lightFailedCount: null, lightMissingCount: null, diskFreeBytes: null, diskTotalBytes: null,
      messages: [MEDIA_LIBRARY_HEALTH_MESSAGES.unknown],
    };
  }
}

/** Free and total bytes of the disk holding `dir` (or its nearest existing parent); null when it cannot be read */
async function diskSpace(dir: string): Promise<{ free: number; total: number } | null> {
  let current = path.resolve(dir);
  for (;;) {
    try {
      const stat = await fs.promises.statfs(current);
      return { free: stat.bavail * stat.bsize, total: stat.blocks * stat.bsize };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Free space of the media library disk could not be read', { path: current, error: errorMessageOf(err) });
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
