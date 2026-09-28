import { eq, and } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { transfers, activityLogs } from '../db/schema.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { systemNowUtcIso } from '../lib/businessClock.js';
import { BadRequestError, NotFoundError } from '../errors/customErrors.js';

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
    if (imageUrl && imageUrl.startsWith('data:image')) {
      imageUrl = await uploadBase64ToStorage(imageUrl, 'image');
    }
    if (thumbnailUrl && thumbnailUrl.startsWith('data:image')) {
      thumbnailUrl = await uploadBase64ToStorage(thumbnailUrl, 'thumbnail');
    } else if (!thumbnailUrl && imageUrl) {
      thumbnailUrl = imageUrl;
    }

    const existing = await executor.select().from(transfers).where(and(eq(transfers.code, cleanCode), eq(transfers.isDeleted, 0))).limit(1);
    const now = systemNowUtcIso();
    let savedRecord: typeof transfers.$inferSelect;

    if (existing.length > 0) {
      const [updated] = await executor.update(transfers)
        .set({
          title: input.title !== undefined ? input.title : existing[0].title,
          image: imageUrl,
          thumbnail: thumbnailUrl,
          notes: input.notes !== undefined ? input.notes : existing[0].notes,
          updatedAt: now,
          isDeleted: 0
        })
        .where(eq(transfers.code, cleanCode))
        .returning();
      savedRecord = updated;
    } else {
      const [inserted] = await executor.insert(transfers)
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
        .returning();
      savedRecord = inserted;
    }

    // Log activity if user provided
    if (input.user) {
      try {
        await executor.insert(activityLogs).values({
          userId: input.user.id || null,
          username: input.user.username || 'سیستم',
          userFullName: input.user.full_name || '',
          action: existing.length > 0 ? 'UPDATE' : 'CREATE',
          entity: 'ترنسفر',
          entityId: cleanCode,
          description: `ثبت/ویرایش تصویر و اطلاعات ترنسفر کد ${cleanCode}`,
          details: { code: cleanCode, title: savedRecord.title }
        });
      } catch {
        // Safe logging fallback
      }
    }

    return savedRecord;
  }

  /**
   * Soft deletes a transfer by code (RULE 09 compliant)
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

    const existing = await executor.select().from(transfers).where(and(eq(transfers.code, cleanCode), eq(transfers.isDeleted, 0))).limit(1);
    if (existing.length === 0) {
      throw new NotFoundError('ترنسفر یافت نشد');
    }

    const now = systemNowUtcIso();
    await executor.update(transfers).set({ isDeleted: 1, updatedAt: now }).where(eq(transfers.code, cleanCode));

    if (user) {
      try {
        await executor.insert(activityLogs).values({
          userId: user.id || null,
          username: user.username || 'سیستم',
          userFullName: user.full_name || '',
          action: 'DELETE',
          entity: 'ترنسفر',
          entityId: cleanCode,
          description: `حذف نرم (Soft-Delete) ترنسفر کد ${cleanCode}`,
          details: { code: cleanCode, title: existing[0].title }
        });
      } catch {
        // Safe logging fallback
      }
    }
  }
}
