import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { items, mediaAssets, mediaSections } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { getImageUploadsDir } from '../../lib/storage.js';
import { mediaWarnings, type MediaWarning } from '../../lib/media/mediaRules.js';
import {
  assetView, auditSnapshot, lockOwnAsset, MEDIA_AUDIT_ENTITY, refreshImageVariants, resolveMediaType,
  type MediaActor, type MediaAssetView,
} from './mediaAsset.service.js';
import { ITEM_AUDIT_ENTITY } from './mediaProducts.service.js';
import {
  assertContentMatches, extensionOfType, kindOfType, mediaFilePath, placeOriginal, readImageFacts, receiveToTemp,
} from './mediaStorage.js';

/**
 * v10.0.27 (N-05 PR 3): arranging the files of the media library — their order, the cover of a product, replacing a
 * file with a better version and using a product image as the item's picture. Each change runs in one transaction with
 * its audit row (`tx`).
 */

type AssetRow = typeof mediaAssets.$inferSelect;

/** The live files of one section, or of one product of the products section, locked in id order */
async function lockScope(tx: DbTransaction, sectionId: number, itemId: number | null): Promise<AssetRow[]> {
  return tx.select().from(mediaAssets).where(and(
    eq(mediaAssets.sectionId, sectionId),
    itemId === null ? isNull(mediaAssets.itemId) : eq(mediaAssets.itemId, itemId),
    eq(mediaAssets.isDeleted, 0),
  )).orderBy(asc(mediaAssets.id)).for('update');
}

const ordered = (rows: AssetRow[]) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map(assetView);

export const MediaArrangeService = {
  /**
   * Sets the display order of the files of a section (of one product in the products section): `ids` names every live
   * file of that scope exactly once, else 422 `MEDIA_ORDER_INVALID`.
   */
  async reorder(input: { sectionId: number; itemId?: number | null; ids: readonly number[] }, actor: MediaActor): Promise<MediaAssetView[]> {
    return orm.transaction(async (tx) => {
      const [section] = await tx.select().from(mediaSections)
        .where(and(eq(mediaSections.id, input.sectionId), eq(mediaSections.isDeleted, 0))).for('share');
      if (!section) throw new ValidationError('بخش کتابخانه یافت نشد.', undefined, 'MEDIA_SECTION_INVALID');
      const itemId = section.kind === 'products' ? (input.itemId ?? null) : null;
      if (section.kind === 'products' && itemId === null) {
        throw new ValidationError('برای بخش «محصولات» کالا را انتخاب کنید.', undefined, 'MEDIA_ITEM_REQUIRED');
      }
      const rows = await lockScope(tx, section.id, itemId);
      const live = new Set(rows.map(r => r.id));
      const ids = input.ids;
      if (new Set(ids).size !== ids.length || ids.length !== live.size || ids.some(id => !live.has(id))) {
        throw new ValidationError('ترتیب باید همه فایل‌های این بخش را یک بار نام ببرد؛ صفحه را دوباره بارگذاری کنید.', undefined, 'MEDIA_ORDER_INVALID');
      }
      const before = rows.map(r => ({ id: r.id, sortOrder: r.sortOrder }));
      for (const [index, id] of ids.entries()) {
        await tx.update(mediaAssets).set({ sortOrder: index + 1, version: sql`${mediaAssets.version} + 1`, updatedAt: sql`now()` })
          .where(eq(mediaAssets.id, id));
      }
      await logActivity({
        tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
        description: `تغییر ترتیب فایل‌های بخش «${section.title}»${itemId ? ` (کالای ${itemId})` : ''}`,
        details: { sectionId: section.id, itemId, before, after: ids.map((id, i) => ({ id, sortOrder: i + 1 })) },
      });
      return ordered(await lockScope(tx, section.id, itemId));
    });
  },

  /**
   * Makes a product image the cover of its product, or takes the mark away. Only an image of the products section with a
   * thumbnail may be the cover (422 `MEDIA_COVER_INVALID`); the other files of the product lose the mark in the same
   * transaction, so one live file per product carries it (`uq_media_assets_cover_item`).
   */
  async setCover(id: number, cover: boolean, actor: MediaActor): Promise<MediaAssetView[]> {
    return orm.transaction(async (tx) => {
      const [target] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.isDeleted, 0)));
      if (!target) throw new NotFoundError('فایل یافت نشد.', undefined, 'MEDIA_NOT_FOUND');
      if (target.itemId === null || target.kind !== 'image' || target.thumbBytes === null) {
        throw new ValidationError('فقط تصویر یک محصول که تصویر کوچک دارد تصویر شاخص می‌شود.', undefined, 'MEDIA_COVER_INVALID');
      }
      const rows = await lockScope(tx, target.sectionId, target.itemId);
      const current = rows.find(r => r.id === id);
      if (!current) throw new NotFoundError('فایل یافت نشد.', undefined, 'MEDIA_NOT_FOUND');
      const previous = rows.find(r => r.isCover === 1) ?? null;
      if (cover) {
        await tx.update(mediaAssets).set({ isCover: 0, version: sql`${mediaAssets.version} + 1`, updatedAt: sql`now()` })
          .where(and(inArray(mediaAssets.id, rows.map(r => r.id)), eq(mediaAssets.isCover, 1), ne(mediaAssets.id, id)));
      }
      if ((current.isCover === 1) !== cover) {
        await tx.update(mediaAssets).set({ isCover: cover ? 1 : 0, version: current.version + 1, updatedAt: sql`now()` })
          .where(eq(mediaAssets.id, id));
        await logActivity({
          tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
          entityId: id, description: cover
            ? `تعیین فایل «${current.originalName}» به‌عنوان تصویر شاخص کالای ${target.itemId}`
            : `برداشتن تصویر شاخص «${current.originalName}» از کالای ${target.itemId}`,
          details: { itemId: target.itemId, before: { coverAssetId: previous?.id ?? null }, after: { coverAssetId: cover ? id : null } },
        });
      }
      return ordered(await lockScope(tx, target.sectionId, target.itemId));
    });
  },

  /**
   * Replaces the content of a file with a better version of the same kind. Title, description, tags, order and cover are
   * kept; the earlier original stays on disk and its fingerprint stays in the audit row. The same content is 409
   * `MEDIA_REPLACE_SAME`, content another live file holds 409 `MEDIA_DUPLICATE`.
   */
  async replaceContent(id: number, input: { body: Readable; fileName: string; declaredType: string }, actor: MediaActor): Promise<{ asset: MediaAssetView; warnings: MediaWarning[] }> {
    const mimeType = resolveMediaType(input.fileName, input.declaredType);
    const kind = kindOfType(mimeType);
    const received = await receiveToTemp(input.body);
    let placed = false;
    try {
      await assertContentMatches(received.tempPath, mimeType);
      const facts = kind === 'image' ? await readImageFacts(received.tempPath) : null;
      const warnings = mediaWarnings(kind, received.sizeBytes, facts ? Math.max(facts.width, facts.height) : null);
      const row = await orm.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.MEDIA_FILE_CONTENT}::int, hashtext(${received.sha256}::text))`);
        const before = await lockOwnAsset(tx, id, actor);
        if (before.kind !== kind) {
          throw new ValidationError(before.kind === 'video' ? 'فیلم را فقط با فیلم جایگزین کنید.' : 'تصویر را فقط با تصویر جایگزین کنید.', undefined, 'MEDIA_REPLACE_KIND');
        }
        if (before.sha256 === received.sha256) {
          throw new ConflictError('فایل تازه همان فایل کنونی است.', undefined, 'MEDIA_REPLACE_SAME');
        }
        const [existing] = await tx.select({ id: mediaAssets.id }).from(mediaAssets)
          .where(and(eq(mediaAssets.sha256, received.sha256), eq(mediaAssets.isDeleted, 0), ne(mediaAssets.id, id))).limit(1);
        if (existing) {
          throw new ConflictError(`این فایل قبلاً در کتابخانه بارگذاری شده است (شماره ${existing.id}).`, { assetId: existing.id }, 'MEDIA_DUPLICATE');
        }
        await placeOriginal(received.tempPath, received.sha256, extensionOfType(mimeType));
        placed = true;
        const [after] = await tx.update(mediaAssets).set({
          originalName: input.fileName.trim().slice(0, 255),
          mimeType,
          sizeBytes: received.sizeBytes,
          sha256: received.sha256,
          width: facts?.width ?? null,
          height: facts?.height ?? null,
          durationSeconds: null,
          isLowQuality: warnings.includes('low_quality') ? 1 : 0,
          lightBytes: null,
          thumbBytes: null,
          lightError: '',
          // a cover needs a thumbnail; a replaced video has none until the browser sends its poster
          isCover: kind === 'image' ? before.isCover : 0,
          version: before.version + 1,
          updatedAt: sql`now()`,
        }).where(eq(mediaAssets.id, id)).returning();
        await logActivity({
          tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: MEDIA_AUDIT_ENTITY,
          entityId: id, description: `جایگزینی فایل «${before.originalName}» با «${after.originalName}»`,
          details: { operation: 'replace', before: auditSnapshot(before), after: auditSnapshot(after) },
        });
        return after;
      });
      await refreshImageVariants(row);
      const [fresh] = await orm.select().from(mediaAssets).where(eq(mediaAssets.id, row.id));
      return { asset: assetView(fresh ?? row), warnings };
    } finally {
      if (!placed) await fs.promises.rm(received.tempPath, { force: true });
    }
  },

  /**
   * Uses the light version of a product image as the item's picture (approved plan, PR 3): the light version and the
   * thumbnail are copied into the image uploads folder, so the item list keeps showing them even if the library file is
   * deleted, and the item is saved at the version the page was built from (409 `OCC_CONFLICT`) with a «کالا» audit row.
   */
  async useAsItemImage(id: number, itemVersion: number, actor: Omit<MediaActor, 'canManage'>): Promise<{ itemId: number; image: string; thumbnail: string; version: number }> {
    const [asset] = await orm.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.isDeleted, 0)));
    if (!asset) throw new NotFoundError('فایل یافت نشد.', undefined, 'MEDIA_NOT_FOUND');
    if (asset.itemId === null || asset.kind !== 'image' || asset.lightBytes === null || asset.thumbBytes === null) {
      throw new ValidationError('فقط تصویر یک محصول که نسخه سبک آن ساخته شده عکس کالا می‌شود.', undefined, 'MEDIA_ITEM_IMAGE_INVALID');
    }
    const ext = extensionOfType(asset.mimeType);
    const dir = getImageUploadsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const imageName = `${uuidv4()}.webp`;
    const thumbName = `${uuidv4()}.webp`;
    await fs.promises.copyFile(mediaFilePath(asset.sha256, 'light', ext), path.join(dir, imageName));
    await fs.promises.copyFile(mediaFilePath(asset.sha256, 'thumb', ext), path.join(dir, thumbName));
    try {
      return await orm.transaction(async (tx) => {
        const [before] = await tx.select().from(items).where(and(eq(items.id, asset.itemId!), eq(items.isDeleted, 0))).for('update');
        if (!before) throw new NotFoundError('محصول یافت نشد.', undefined, 'MEDIA_PRODUCT_NOT_FOUND');
        if (before.version !== itemVersion) {
          throw new ConflictError('این محصول را کاربر دیگری تغییر داده؛ صفحه را دوباره باز کنید.', undefined, 'OCC_CONFLICT');
        }
        const image = `/uploads/${imageName}`;
        const thumbnail = `/uploads/${thumbName}`;
        const [after] = await tx.update(items).set({ image, thumbnail, version: before.version + 1 })
          .where(and(eq(items.id, before.id), eq(items.version, before.version))).returning({ version: items.version });
        await logActivity({
          tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: ITEM_AUDIT_ENTITY,
          entityId: before.id, description: `عکس کالای «${before.name}» (${before.code}) از کتابخانه تصاویر (فایل ${asset.id})`,
          details: {
            before: { image: before.image ?? '', thumbnail: before.thumbnail ?? '' },
            after: { image, thumbnail },
            changes: { image: { from: before.image ?? '', to: image }, thumbnail: { from: before.thumbnail ?? '', to: thumbnail } },
            mediaAssetId: asset.id,
          },
        });
        return { itemId: before.id, image, thumbnail, version: after.version };
      });
    } catch (err) {
      await Promise.all([imageName, thumbName].map(name => fs.promises.rm(path.join(dir, name), { force: true })));
      throw err;
    }
  },
};
