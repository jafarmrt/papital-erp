import { orm, pool } from '../../db/drizzle.js';
import { formDrafts, users } from '../../db/schema.js';
import { eq, and, sql, desc, lt } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';

export interface SaveDraftInput {
  userId?: number | null;
  username?: string;
  sessionId?: string;
  entityType: 'invoice' | 'voucher' | 'document' | 'project' | 'cheque' | 'treasury' | string;
  draftKey?: string;
  payload: Record<string, any>;
  summary?: string;
  expiresInDays?: number;
}

export interface DraftSummary {
  id: number;
  userId?: number | null;
  username?: string;
  sessionId?: string;
  entityType: string;
  draftKey: string;
  summary?: string;
  updatedAt?: string;
  createdAt?: string;
  expiresAt?: string;
}

export class FormDraftService {
  /**
   * Save or update a server-backed form draft.
   * Performs an atomic upsert based on (userId/sessionId, entityType, draftKey).
   */
  static async saveDraft(input: SaveDraftInput) {
    const {
      userId = null,
      username = '',
      sessionId = '',
      entityType,
      draftKey = 'default',
      payload,
      summary = '',
      expiresInDays = 30
    } = input;

    if (!entityType) {
      throw new Error('entityType الزامی است');
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('محتوای پیش‌نویس (payload) معتبر نیست');
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    const expiresAtIso = expiresAt.toISOString();

    // Check if an existing active draft exists
    let existing;
    if (userId) {
      existing = await orm.select()
        .from(formDrafts)
        .where(
          and(
            eq(formDrafts.userId, userId),
            sql`${formDrafts.entityType} = ${entityType}::text`,
            sql`${formDrafts.draftKey} = ${draftKey}::text`,
            eq(formDrafts.isDeleted, 0)
          )
        )
        .limit(1);
    } else if (sessionId) {
      existing = await orm.select()
        .from(formDrafts)
        .where(
          and(
            sql`${formDrafts.sessionId} = ${sessionId}::text`,
            sql`${formDrafts.entityType} = ${entityType}::text`,
            sql`${formDrafts.draftKey} = ${draftKey}::text`,
            eq(formDrafts.isDeleted, 0)
          )
        )
        .limit(1);
    }

    if (existing && existing.length > 0) {
      const draftId = existing[0].id;
      const [updated] = await orm.update(formDrafts)
        .set({
          payload,
          summary: summary || existing[0].summary,
          username: username || existing[0].username,
          sessionId: sessionId || existing[0].sessionId,
          updatedAt: new Date().toISOString(),
          expiresAt: expiresAtIso
        })
        .where(eq(formDrafts.id, draftId))
        .returning();

      return {
        success: true,
        action: 'updated',
        draft: updated
      };
    } else {
      const [inserted] = await orm.insert(formDrafts)
        .values({
          userId: userId || null,
          username,
          sessionId,
          entityType,
          draftKey,
          payload,
          summary,
          expiresAt: expiresAtIso,
          isDeleted: 0
        })
        .returning();

      return {
        success: true,
        action: 'created',
        draft: inserted
      };
    }
  }

  /**
   * Retrieve the active draft for a user/session and entityType.
   */
  static async getDraft(entityType: string, draftKey: string = 'default', userId?: number | null, sessionId?: string) {
    if (!userId && !sessionId) {
      return null;
    }

    let results = [];
    if (userId) {
      results = await orm.select()
        .from(formDrafts)
        .where(
          and(
            eq(formDrafts.userId, userId),
            sql`${formDrafts.entityType} = ${entityType}::text`,
            sql`${formDrafts.draftKey} = ${draftKey}::text`,
            eq(formDrafts.isDeleted, 0)
          )
        )
        .orderBy(desc(formDrafts.updatedAt))
        .limit(1);
    } else if (sessionId) {
      results = await orm.select()
        .from(formDrafts)
        .where(
          and(
            sql`${formDrafts.sessionId} = ${sessionId}::text`,
            sql`${formDrafts.entityType} = ${entityType}::text`,
            sql`${formDrafts.draftKey} = ${draftKey}::text`,
            eq(formDrafts.isDeleted, 0)
          )
        )
        .orderBy(desc(formDrafts.updatedAt))
        .limit(1);
    }

    return results.length > 0 ? results[0] : null;
  }

  /**
   * List all drafts for a user (or by entityType).
   */
  static async listUserDrafts(userId?: number | null, sessionId?: string, entityType?: string) {
    if (!userId && !sessionId) {
      return [];
    }

    const conditions = [eq(formDrafts.isDeleted, 0)];

    if (userId) {
      conditions.push(eq(formDrafts.userId, userId));
    } else if (sessionId) {
      conditions.push(sql`${formDrafts.sessionId} = ${sessionId}::text`);
    }

    if (entityType) {
      conditions.push(sql`${formDrafts.entityType} = ${entityType}::text`);
    }

    const drafts = await orm.select({
      id: formDrafts.id,
      userId: formDrafts.userId,
      username: formDrafts.username,
      sessionId: formDrafts.sessionId,
      entityType: formDrafts.entityType,
      draftKey: formDrafts.draftKey,
      summary: formDrafts.summary,
      updatedAt: formDrafts.updatedAt,
      createdAt: formDrafts.createdAt,
      expiresAt: formDrafts.expiresAt
    })
      .from(formDrafts)
      .where(and(...conditions))
      .orderBy(desc(formDrafts.updatedAt))
      .limit(50);

    return drafts;
  }

  /**
   * Delete / discard a specific draft by key or ID.
   */
  static async deleteDraft(entityType: string, draftKey: string = 'default', userId?: number | null, sessionId?: string) {
    const conditions = [
      sql`${formDrafts.entityType} = ${entityType}::text`,
      sql`${formDrafts.draftKey} = ${draftKey}::text`,
      eq(formDrafts.isDeleted, 0)
    ];

    if (userId) {
      conditions.push(eq(formDrafts.userId, userId));
    } else if (sessionId) {
      conditions.push(sql`${formDrafts.sessionId} = ${sessionId}::text`);
    } else {
      return { success: false, message: 'شناسه کاربر یا سشن نامشخص است' };
    }

    await orm.update(formDrafts)
      .set({ isDeleted: 1, updatedAt: new Date().toISOString() })
      .where(and(...conditions));

    return { success: true };
  }

  /**
   * Delete a draft by direct numeric ID
   */
  static async deleteDraftById(id: number, userId?: number | null) {
    const conditions = [eq(formDrafts.id, id)];
    if (userId) {
      conditions.push(eq(formDrafts.userId, userId));
    }

    await orm.update(formDrafts)
      .set({ isDeleted: 1, updatedAt: new Date().toISOString() })
      .where(and(...conditions));

    return { success: true };
  }

  /**
   * Clean up expired drafts
   */
  static async cleanupExpiredDrafts() {
    try {
      const now = new Date().toISOString();
      const res = await orm.update(formDrafts)
        .set({ isDeleted: 1 })
        .where(
          and(
            eq(formDrafts.isDeleted, 0),
            lt(formDrafts.expiresAt, now)
          )
        );
      return res;
    } catch (e: any) {
      logger.error('Error cleaning up expired drafts:', e);
    }
  }
}
