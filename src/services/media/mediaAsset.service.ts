import fs from 'fs';
import type { Request } from 'express';
import type { Readable } from 'stream';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { items, mediaAssets, mediaSections } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/index.js';
import {
  MEDIA_FORMAT_TEXT, MEDIA_HEIC_TEXT, MEDIA_POSTER_MAX_BYTES, isHeicName, mediaDownloadName, mediaTypeOf, mediaWarnings,
  type MediaShotType, type MediaVariant, type MediaWarning,
} from '../../lib/media/mediaRules.js';
import {
  assertContentMatches, buildImageVariants, buildPosterThumb, extensionOfType, kindOfType, mediaFilePath, placeOriginal,
  readImageFacts, receiveToTemp,
} from './mediaStorage.js';

/**
 * v10.0.18 (N-05): records of the media library. Every write runs in one transaction with its «کتابخانه تصاویر» audit row
 * (`tx`); the original is placed on disk before the row is written, and the light version of an image is made right
 * after the commit (a failure is recorded on the row and can be rebuilt, the original stays).
 */

export const MEDIA_AUDIT_ENTITY = 'کتابخانه تصاویر';

export interface MediaActor {
  req?: Request;
  userId?: number;
  username: string;
  /** holds `media.manage`: edits and deletes every file, not only its own */
  canManage: boolean;
}

export interface MediaUploadInput {
  body: Readable;
  fileName: string;
  declaredType: string;
  sectionId: number;
  itemId?: number | null;
  shotType: MediaShotType;
  title?: string;
  description?: string;
}

type AssetRow = typeof mediaAssets.$inferSelect;

export interface MediaAssetView {
  id: number;
  sectionId: number;
  itemId: number | null;
  kind: string;
  shotType: string;
  title: string;
  description: string;
  sortOrder: number;
  isCover: boolean;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  isLowQuality: boolean;
  hasLight: boolean;
  hasThumb: boolean;
  lightFailed: boolean;
  createdBy: string;
  createdAt: string | null;
  version: number;
  warnings: MediaWarning[];
}

export function assetView(row: AssetRow): MediaAssetView {
  const kind = row.kind === 'video' ? 'video' : 'image';
  const longSide = row.width && row.height ? Math.max(row.width, row.height) : null;
  return {
    id: row.id,
    sectionId: row.sectionId,
    itemId: row.itemId ?? null,
    kind,
    shotType: row.shotType,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    isCover: row.isCover === 1,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width ?? null,
    height: row.height ?? null,
    durationSeconds: row.durationSeconds ?? null,
    isLowQuality: row.isLowQuality === 1,
    hasLight: row.lightBytes !== null,
    hasThumb: row.thumbBytes !== null,
    lightFailed: kind === 'image' && row.lightBytes === null && row.lightError !== '',
    createdBy: row.createdBy,
    createdAt: serverTimestampToUtcIso(row.createdAt),
    version: row.version,
    warnings: mediaWarnings(kind, row.sizeBytes, longSide),
  };
}

const auditSnapshot = (row: AssetRow) => ({
  sectionId: row.sectionId, itemId: row.itemId, kind: row.kind, shotType: row.shotType, title: row.title,
  description: row.description, sortOrder: row.sortOrder, originalName: row.originalName, mimeType: row.mimeType,
  sizeBytes: row.sizeBytes, sha256: row.sha256,
});

async function lockLiveSection(tx: DbTransaction, sectionId: number) {
  const [section] = await tx.select().from(mediaSections)
    .where(and(eq(mediaSections.id, sectionId), eq(mediaSections.isDeleted, 0))).for('share');
  if (!section) throw new ValidationError('بخش کتابخانه یافت نشد.', undefined, 'MEDIA_SECTION_INVALID');
  return section;
}

/** A products-section file names a live item; a file of another section names none */
async function resolveItemLink(tx: DbTransaction, sectionKind: string, itemId: number | null | undefined): Promise<number | null> {
  if (sectionKind !== 'products') {
    if (itemId) throw new ValidationError('فقط فایل بخش «محصولات» به کالا وصل می‌شود.', undefined, 'MEDIA_ITEM_NOT_ALLOWED');
    return null;
  }
  if (!itemId) throw new ValidationError('برای بخش «محصولات» کالا را انتخاب کنید.', undefined, 'MEDIA_ITEM_REQUIRED');
  const [item] = await tx.select({ id: items.id }).from(items)
    .where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('share');
  if (!item) throw new ValidationError('کالای انتخاب‌شده یافت نشد.', undefined, 'MEDIA_ITEM_INVALID');
  return item.id;
}

function resolveMediaType(fileName: string, declaredType: string): string {
  if (isHeicName(fileName) || /^image\/hei[cf]$/i.test(declaredType.trim())) {
    throw new ValidationError(MEDIA_HEIC_TEXT, undefined, 'MEDIA_FORMAT_HEIC');
  }
  const mimeType = mediaTypeOf(fileName, declaredType);
  if (!mimeType) throw new ValidationError(MEDIA_FORMAT_TEXT, undefined, 'MEDIA_FORMAT_INVALID');
  return mimeType;
}

/** Makes the light version and thumbnail of an image row and records the outcome; never throws */
export async function refreshImageVariants(row: Pick<AssetRow, 'id' | 'sha256' | 'mimeType' | 'kind'>): Promise<void> {
  if (row.kind !== 'image') return;
  try {
    const { lightBytes, thumbBytes } = await buildImageVariants(row.sha256, extensionOfType(row.mimeType));
    await orm.update(mediaAssets).set({ lightBytes, thumbBytes, lightError: '' }).where(eq(mediaAssets.id, row.id));
  } catch (err) {
    const message = errorMessageOf(err).slice(0, 500) || 'unknown error';
    logger.warn(`[media] light version of asset ${row.id} failed: ${message}`);
    await orm.update(mediaAssets).set({ lightBytes: null, thumbBytes: null, lightError: message }).where(eq(mediaAssets.id, row.id));
  }
}

export const MediaAssetService = {
  async productsSectionId(): Promise<number> {
    const [row] = await orm.select({ id: mediaSections.id }).from(mediaSections)
      .where(and(eq(mediaSections.kind, 'products'), eq(mediaSections.isDeleted, 0))).limit(1);
    if (!row) throw new NotFoundError('بخش «محصولات» کتابخانه یافت نشد.', undefined, 'MEDIA_SECTION_INVALID');
    return row.id;
  },

  async listSections() {
    const rows = await orm.select().from(mediaSections).where(eq(mediaSections.isDeleted, 0))
      .orderBy(asc(mediaSections.sortOrder), asc(mediaSections.id));
    return rows.map(s => ({ id: s.id, kind: s.kind, title: s.title, description: s.description, sortOrder: s.sortOrder, version: s.version }));
  },

  /**
   * Stores one uploaded file. The body is streamed to disk and checked (size, content against the declared type, image
   * readable) before any row is written; a file whose content a live row already holds is 409 `MEDIA_DUPLICATE`.
   */
  async upload(input: MediaUploadInput, actor: MediaActor): Promise<{ asset: MediaAssetView; warnings: MediaWarning[] }> {
    const mimeType = resolveMediaType(input.fileName, input.declaredType);
    const kind = kindOfType(mimeType);
    const received = await receiveToTemp(input.body);
    let placed = false;
    try {
      await assertContentMatches(received.tempPath, mimeType);
      const facts = kind === 'image' ? await readImageFacts(received.tempPath) : null;
      const warnings = mediaWarnings(kind, received.sizeBytes, facts ? Math.max(facts.width, facts.height) : null);
      const shotType: MediaShotType = kind === 'video' ? 'video' : (input.shotType === 'video' ? 'other' : input.shotType);

      const row = await orm.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.MEDIA_FILE_CONTENT}::int, hashtext(${received.sha256}::text))`);
        const section = await lockLiveSection(tx, input.sectionId);
        const itemId = await resolveItemLink(tx, section.kind, input.itemId);
        const [existing] = await tx.select({ id: mediaAssets.id, title: mediaAssets.title, originalName: mediaAssets.originalName })
          .from(mediaAssets).where(and(eq(mediaAssets.sha256, received.sha256), eq(mediaAssets.isDeleted, 0))).limit(1);
        if (existing) {
          throw new ConflictError(`این فایل قبلاً در کتابخانه بارگذاری شده است (شماره ${existing.id}).`, { assetId: existing.id }, 'MEDIA_DUPLICATE');
        }
        await placeOriginal(received.tempPath, received.sha256, extensionOfType(mimeType));
        placed = true;
        const [inserted] = await tx.insert(mediaAssets).values({
          sectionId: section.id,
          itemId,
          kind,
          shotType,
          title: (input.title ?? '').trim(),
          description: (input.description ?? '').trim(),
          originalName: input.fileName.trim().slice(0, 255),
          mimeType,
          sizeBytes: received.sizeBytes,
          sha256: received.sha256,
          width: facts?.width ?? null,
          height: facts?.height ?? null,
          isLowQuality: warnings.includes('low_quality') ? 1 : 0,
          createdBy: actor.username,
          createdByUserId: actor.userId ?? null,
        }).returning();
        await logActivity({
          tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'CREATE', entity: MEDIA_AUDIT_ENTITY,
          entityId: inserted.id, description: `بارگذاری فایل «${inserted.originalName}» در بخش «${section.title}»`,
          details: { after: auditSnapshot(inserted) },
        });
        return inserted;
      });

      await refreshImageVariants(row);
      const [fresh] = await orm.select().from(mediaAssets).where(eq(mediaAssets.id, row.id));
      return { asset: assetView(fresh ?? row), warnings };
    } finally {
      if (!placed) await fs.promises.rm(received.tempPath, { force: true });
    }
  },

  /** Stores the first-frame image the browser took of a video and its duration */
  async setVideoPoster(id: number, body: Readable, durationSeconds: number | null, actor: MediaActor): Promise<MediaAssetView> {
    const received = await receiveToTemp(body, MEDIA_POSTER_MAX_BYTES);
    try {
      return await orm.transaction(async (tx) => {
        const row = await lockOwnAsset(tx, id, actor);
        if (row.kind !== 'video') throw new ValidationError('تصویر نخست فقط برای فیلم است.', undefined, 'MEDIA_POSTER_NOT_VIDEO');
        const thumbBytes = await buildPosterThumb(row.sha256, received.tempPath);
        const [updated] = await tx.update(mediaAssets).set({
          thumbBytes,
          durationSeconds: durationSeconds ?? row.durationSeconds,
          updatedAt: sql`now()`,
        }).where(eq(mediaAssets.id, id)).returning();
        return assetView(updated);
      });
    } finally {
      await fs.promises.rm(received.tempPath, { force: true });
    }
  },

  async list(filters: { sectionId?: number; itemId?: number; kind?: string; shotType?: string; lowQuality?: boolean; search?: string; page: number; limit: number }) {
    const conditions: SQL[] = [eq(mediaAssets.isDeleted, 0)];
    if (filters.sectionId) conditions.push(eq(mediaAssets.sectionId, filters.sectionId));
    if (filters.itemId) conditions.push(eq(mediaAssets.itemId, filters.itemId));
    if (filters.kind) conditions.push(eq(mediaAssets.kind, filters.kind));
    if (filters.shotType) conditions.push(eq(mediaAssets.shotType, filters.shotType));
    if (filters.lowQuality) conditions.push(eq(mediaAssets.isLowQuality, 1));
    if (filters.search?.trim()) {
      const pattern = containsLikePattern(filters.search.trim());
      conditions.push(or(ilike(mediaAssets.title, pattern), ilike(mediaAssets.description, pattern), ilike(mediaAssets.originalName, pattern))!);
    }
    const where = and(...conditions);
    const [{ total }] = await orm.select({ total: count() }).from(mediaAssets).where(where);
    const rows = await orm.select().from(mediaAssets).where(where)
      .orderBy(asc(mediaAssets.sectionId), asc(mediaAssets.itemId), asc(mediaAssets.sortOrder), desc(mediaAssets.id))
      .limit(filters.limit).offset((filters.page - 1) * filters.limit);
    return { data: rows.map(assetView), total: Number(total), page: filters.page, limit: filters.limit };
  },

  async get(id: number): Promise<MediaAssetView> {
    return assetView(await liveAsset(id));
  },

  async update(id: number, input: { version: number; title?: string; description?: string; shotType?: MediaShotType; sortOrder?: number }, actor: MediaActor): Promise<MediaAssetView> {
    return orm.transaction(async (tx) => {
      const before = await lockOwnAsset(tx, id, actor);
      if (before.version !== input.version) {
        throw new ConflictError('این فایل را کاربر دیگری تغییر داده؛ دوباره باز کنید.', undefined, 'OCC_CONFLICT');
      }
      if (input.shotType !== undefined && (input.shotType === 'video') !== (before.kind === 'video')) {
        throw new ValidationError('نوع نمای «فیلم کوتاه» فقط برای فیلم است.', undefined, 'MEDIA_SHOT_TYPE_INVALID');
      }
      const [after] = await tx.update(mediaAssets).set({
        title: input.title !== undefined ? input.title.trim() : before.title,
        description: input.description !== undefined ? input.description.trim() : before.description,
        shotType: input.shotType ?? before.shotType,
        sortOrder: input.sortOrder ?? before.sortOrder,
        version: before.version + 1,
        updatedAt: sql`now()`,
      }).where(and(eq(mediaAssets.id, id), eq(mediaAssets.version, before.version))).returning();
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
        entityId: id, description: `ویرایش اطلاعات فایل «${before.originalName}»`,
        details: { before: auditSnapshot(before), after: auditSnapshot(after) },
      });
      return assetView(after);
    });
  },

  /** Soft delete; the file stays on disk (another row may hold the same content, and the cleanup keeps it 30 days) */
  async remove(id: number, actor: MediaActor): Promise<void> {
    await orm.transaction(async (tx) => {
      const before = await lockOwnAsset(tx, id, actor);
      await tx.update(mediaAssets).set({ isDeleted: 1, deletedAt: sql`now()`, version: before.version + 1 }).where(eq(mediaAssets.id, id));
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'DELETE', entity: MEDIA_AUDIT_ENTITY,
        entityId: id, description: `حذف فایل «${before.originalName}» از کتابخانه`, details: { before: auditSnapshot(before) },
      });
    });
  },

  /** Makes the light version and thumbnail of an image again (after a failure, or for files stored before) */
  async rebuildLight(id: number): Promise<MediaAssetView> {
    const row = await liveAsset(id);
    if (row.kind !== 'image') throw new ValidationError('نسخه سبک فقط برای تصویر ساخته می‌شود.', undefined, 'MEDIA_LIGHT_NOT_IMAGE');
    await refreshImageVariants(row);
    return assetView(await liveAsset(id));
  },

  /** The file of one variant and the name it downloads under; a variant that does not exist is 404 */
  async fileOf(id: number, variant: MediaVariant): Promise<{ path: string; mimeType: string; downloadName: string }> {
    const row = await liveAsset(id);
    const ext = extensionOfType(row.mimeType);
    if (variant === 'light' && row.lightBytes === null) throw new NotFoundError('نسخه سبک این فایل وجود ندارد.', undefined, 'MEDIA_VARIANT_MISSING');
    if (variant === 'thumb' && row.thumbBytes === null) throw new NotFoundError('تصویر کوچک این فایل وجود ندارد.', undefined, 'MEDIA_VARIANT_MISSING');
    let prefix = row.title.trim();
    if (row.itemId) {
      const [item] = await orm.select({ code: items.code }).from(items).where(eq(items.id, row.itemId));
      if (item?.code) prefix = item.code;
    }
    const fileExt = variant === 'original' ? ext : 'webp';
    return {
      path: mediaFilePath(row.sha256, variant, ext),
      mimeType: variant === 'original' ? row.mimeType : 'image/webp',
      downloadName: mediaDownloadName({ prefix: prefix || 'papital', shotType: row.shotType as MediaShotType, id: row.id, ext: fileExt }),
    };
  },
};

async function liveAsset(id: number): Promise<AssetRow> {
  const [row] = await orm.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.isDeleted, 0)));
  if (!row) throw new NotFoundError('فایل یافت نشد.', undefined, 'MEDIA_NOT_FOUND');
  return row;
}

/** Locks a live file for a change; without `media.manage` only the uploader may change it */
async function lockOwnAsset(tx: DbTransaction, id: number, actor: MediaActor): Promise<AssetRow> {
  const [row] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('فایل یافت نشد.', undefined, 'MEDIA_NOT_FOUND');
  const own = actor.userId !== undefined && row.createdByUserId === actor.userId;
  if (!actor.canManage && !own) {
    throw new ForbiddenError('فقط فرستنده فایل یا دارنده دسترسی «مدیریت کتابخانه تصاویر» آن را تغییر می‌دهد.', undefined, 'MEDIA_NOT_OWN');
  }
  return row;
}
