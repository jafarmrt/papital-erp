import { eq, and } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { transfers } from '../db/schema.js';
import { isDataUrl, uploadBase64ToStorage } from '../lib/storage.js';
import { systemNowUtcIso } from '../lib/businessClock.js';
import { BadRequestError, NotFoundError } from '../errors/customErrors.js';
import { logActivity } from '../lib/auditLogger.js';

export interface SaveTransferInput {
  code: string;
  title?: string;
  image?: string;
  thumbnail?: string;
  notes?: string;
  user?: {
    id?: number;
    username?: string;
    full_name?: string;
  };
}

export class TransferService {
  /**
   * Saves or updates a transfer with optional base64 image processing
   */
  static async saveTransfer(
    input: SaveTransferInput,
    executor: DbExecutor = orm
  ): Promise<typeof transfers.$inferSelect> {
    const rawCode = input.code;
    if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
      throw new BadRequestError('کد ترنسفر الزامی است');
    }

    const cleanCode = rawCode.trim();
    let imageUrl = input.image || '';
    let thumbnailUrl = input.thumbnail || '';

    // Process base64 uploads to storage
    if (isDataUrl(imageUrl)) {
      imageUrl = await uploadBase64ToStorage(imageUrl, 'image');
    }
    if (isDataUrl(thumbnailUrl)) {
      thumbnailUrl = await uploadBase64ToStorage(thumbnailUrl, 'thumbnail');
    } else if (!thumbnailUrl && imageUrl) {
      thumbnailUrl = imageUrl;
    }

    // TD-493: one row per code. A new code is inserted; an existing one (live or soft-deleted) is updated under its
    // row lock, so saving a deleted code revives the same row instead of failing on the unique constraint.
    const save = async (tx: DbExecutor) => {
      const now = systemNowUtcIso();
      const [inserted] = await tx.insert(transfers)
        .values({
          code: cleanCode,
          title: input.title || `ترنسفر کد ${cleanCode}`,
          image: imageUrl,
          thumbnail: thumbnailUrl,
          notes: input.notes || '',
          createdAt: now,
          updatedAt: now,
          isDeleted: 0
        })
        .onConflictDoNothing({ target: transfers.code })
        .returning();
      let savedRecord = inserted;
      let action: 'CREATE' | 'UPDATE' = 'CREATE';
      let before: typeof transfers.$inferSelect | undefined;
      if (!savedRecord) {
        [before] = await tx.select().from(transfers).where(eq(transfers.code, cleanCode)).for('update');
        if (!before) throw new NotFoundError('ترنسفر یافت نشد');
        const revived = before.isDeleted !== 0;
        const [updated] = await tx.update(transfers)
          .set({
            title: input.title !== undefined ? input.title : (revived ? `ترنسفر کد ${cleanCode}` : before.title),
            image: imageUrl,
            thumbnail: thumbnailUrl,
            notes: input.notes !== undefined ? input.notes : (revived ? '' : before.notes),
            updatedAt: now,
            isDeleted: 0
          })
          .where(eq(transfers.id, before.id))
          .returning();
        savedRecord = updated;
        action = revived ? 'CREATE' : 'UPDATE';
      }

      if (input.user) {
        await logActivity({
          tx,
          userId: input.user.id,
          username: input.user.username || 'سیستم',
          userFullName: input.user.full_name || '',
          action,
          entity: 'ترنسفر',
          entityId: cleanCode,
          description: `ثبت/ویرایش تصویر و اطلاعات ترنسفر کد ${cleanCode}`,
          details: { before: before ?? null, after: savedRecord }
        });
      }
      return savedRecord;
    };
    const savedRecord = executor === orm ? await orm.transaction(save) : await save(executor);

    return savedRecord;
  }

  /**
   * Soft deletes a transfer by code (RULE 09 compliant). v10.0.22 (TD-963): the delete and its audit row run in one
   * transaction through `logActivity` (its own when the caller passes none), so an audit insert error refuses the
   * delete instead of being swallowed, and the row carries the request's trace id.
   */
  static async deleteTransfer(
    code: string,
    user?: { id?: number; username?: string; full_name?: string },
    executor: DbExecutor = orm
  ): Promise<void> {
    const cleanCode = String(code).trim();
    if (!cleanCode) {
      throw new BadRequestError('کد ترنسفر الزامی است');
    }

    const run = async (tx: DbExecutor): Promise<void> => {
      const existing = await tx.select().from(transfers)
        .where(and(eq(transfers.code, cleanCode), eq(transfers.isDeleted, 0))).limit(1).for('update');
      if (existing.length === 0) {
        throw new NotFoundError('ترنسفر یافت نشد');
      }

      const now = systemNowUtcIso();
      await tx.update(transfers).set({ isDeleted: 1, updatedAt: now }).where(eq(transfers.code, cleanCode));

      await logActivity({
        tx,
        userId: user?.id,
        username: user?.username,
        userFullName: user?.full_name,
        action: 'DELETE',
        entity: 'ترنسفر',
        entityId: cleanCode,
        description: `حذف نرم (Soft-Delete) ترنسفر کد ${cleanCode}`,
        details: { before: { code: cleanCode, title: existing[0].title } },
      });
    };
    if (executor === orm) await orm.transaction(tx => run(tx));
    else await run(executor);
  }
}
