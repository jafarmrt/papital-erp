import fs from 'fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { mediaAssets } from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/index.js';
import { buildImageVariants, extensionOfType, mediaFilePath } from './mediaStorage.js';
import { MEDIA_AUDIT_ENTITY } from './mediaAsset.service.js';

const AUDIT_ENTITY: 'کتابخانه تصاویر' = MEDIA_AUDIT_ENTITY;

/**
 * v10.1.2 (N-05 PR 4): the command that makes the light versions and thumbnails of the library's images again
 * (`npm run media:rebuild-light`). By default it takes the images whose light version is missing, failed or gone from
 * disk; `all` takes every live image (after a change of the light size or quality). Each distinct content is built once
 * and written to every live row holding it. A preview by default; one run at a time (session advisory lock); the
 * original is only read. A content that fails keeps a light version it already had and is listed in the report.
 */

export type LightRebuildScope = 'missing' | 'all';

export interface LightRebuildFailure {
  sha256: string;
  assetIds: number[];
  error: string;
}

export interface LightRebuildReport {
  scope: LightRebuildScope;
  apply: boolean;
  /** live images checked, and the distinct contents among them that need a rebuild */
  checkedImages: number;
  candidates: number;
  candidateAssets: number;
  rebuilt: number;
  failures: LightRebuildFailure[];
}

export type LightRebuildOutcome = { acquired: true; report: LightRebuildReport } | { acquired: false };

interface ImageContent {
  sha256: string;
  mimeType: string;
  assetIds: number[];
  /** some live row of this content has no light version or thumbnail, or a recorded failure */
  incomplete: boolean;
}

async function liveImageContents(): Promise<{ images: number; contents: ImageContent[] }> {
  const rows = await orm.select({
    sha256: mediaAssets.sha256,
    mimeType: mediaAssets.mimeType,
    assetIds: sql<number[]>`array_agg(${mediaAssets.id} ORDER BY ${mediaAssets.id})`,
    incomplete: sql<boolean>`bool_or(${mediaAssets.lightBytes} IS NULL OR ${mediaAssets.thumbBytes} IS NULL OR ${mediaAssets.lightError} <> '')`,
  }).from(mediaAssets)
    .where(and(eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image')))
    .groupBy(mediaAssets.sha256, mediaAssets.mimeType)
    .orderBy(sql`min(${mediaAssets.id})`);
  const contents = rows.map(r => ({ ...r, assetIds: (r.assetIds ?? []).map(Number), incomplete: Boolean(r.incomplete) }));
  return { images: contents.reduce((n, c) => n + c.assetIds.length, 0), contents };
}

function variantsOnDisk(content: ImageContent): boolean {
  const ext = extensionOfType(content.mimeType);
  return fs.existsSync(mediaFilePath(content.sha256, 'light', ext)) && fs.existsSync(mediaFilePath(content.sha256, 'thumb', ext));
}

async function rebuildContent(content: ImageContent): Promise<string | null> {
  const live = and(eq(mediaAssets.sha256, content.sha256), eq(mediaAssets.isDeleted, 0));
  try {
    const { lightBytes, thumbBytes } = await buildImageVariants(content.sha256, extensionOfType(content.mimeType));
    await orm.update(mediaAssets).set({ lightBytes, thumbBytes, lightError: '' }).where(live);
    return null;
  } catch (err) {
    const message = errorMessageOf(err).slice(0, 500) || 'unknown error';
    logger.warn(`[media] light rebuild of content ${content.sha256.slice(0, 12)} failed: ${message}`);
    // a row that still has a light version keeps it; only rows without one record the failure
    await orm.update(mediaAssets).set({ lightError: message }).where(and(live, isNull(mediaAssets.lightBytes)));
    return message;
  }
}

export const MediaLightRebuildService = {
  async rebuild(options: { apply: boolean; scope: LightRebuildScope; actor?: string }): Promise<LightRebuildOutcome> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.MEDIA_LIGHT_REBUILD, async () => {
      const { images, contents } = await liveImageContents();
      const targets = options.scope === 'all' ? contents : contents.filter(c => c.incomplete || !variantsOnDisk(c));
      const report: LightRebuildReport = {
        scope: options.scope, apply: options.apply, checkedImages: images, candidates: targets.length,
        candidateAssets: targets.reduce((n, c) => n + c.assetIds.length, 0), rebuilt: 0, failures: [],
      };
      if (!options.apply) return report;
      for (const content of targets) {
        const error = await rebuildContent(content);
        if (error === null) report.rebuilt++;
        else report.failures.push({ sha256: content.sha256, assetIds: content.assetIds, error });
      }
      await orm.transaction(async (tx) => {
        await logActivity({
          tx, username: options.actor ?? 'cli:media-rebuild-light', action: 'UPDATE', entity: AUDIT_ENTITY, entityId: 'light_rebuild',
          description: `ساخت دوباره نسخه‌های سبک کتابخانه: ${report.rebuilt} ساخته شد، ${report.failures.length} ناموفق`,
          details: {
            scope: report.scope, candidates: report.candidates, candidateAssets: report.candidateAssets, rebuilt: report.rebuilt,
            failedAssetIds: report.failures.flatMap(f => f.assetIds),
          },
        });
      });
      return report;
    });
    return outcome.acquired ? { acquired: true, report: outcome.result } : { acquired: false };
  },
};
