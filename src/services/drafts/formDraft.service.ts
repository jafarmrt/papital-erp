import { orm } from '../../db/drizzle.js';
import { formDrafts } from '../../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { ValidationError } from '../../errors/customErrors.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { DRAFT_EXPIRY_DAYS, isValidDraftExpiryDays } from '../../lib/drafts/draftRules.js';

/**
 * v9.0.295 (TD-676، B16-12): پیش‌نویس زنده هنوز منقضی نشده است. ردیف قدیمی بی `expires_at` تا ۳۰ روز پس از آخرین ذخیره
 * زنده است. زمان‌های سرور UTC و بی منطقه ذخیره می‌شوند (AGENTS §22)، پس با `now()` به UTC مقایسه می‌شوند.
 */
const liveDraft = sql`COALESCE(${formDrafts.expiresAt}, ${formDrafts.updatedAt} + make_interval(days => ${DRAFT_EXPIRY_DAYS.default})) > (now() AT TIME ZONE 'UTC')`;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaveDraftInput {
  userId?: number | null;
  username?: string;
  sessionId?: string;
  entityType: 'invoice' | 'voucher' | 'document' | 'project' | 'cheque' | 'treasury' | string;
  draftKey?: string;
  payload: Record<string, unknown>;
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
      expiresInDays = DRAFT_EXPIRY_DAYS.default
    } = input;

    if (!entityType) {
      throw new ValidationError('نوع پیش‌نویس الزامی است', undefined, 'DRAFT_ENTITY_TYPE_REQUIRED');
    }

    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('محتوای پیش‌نویس معتبر نیست', undefined, 'DRAFT_PAYLOAD_INVALID');
    }

    if (!isValidDraftExpiryDays(expiresInDays)) {
      throw new ValidationError(`ماندگاری پیش‌نویس باید عدد صحیحی از ۱ تا ۹۰ روز باشد`, undefined, 'DRAFT_EXPIRY_INVALID');
    }
    const expiresAtIso = new Date(Date.now() + expiresInDays * DAY_MS).toISOString();

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

    let results: (typeof formDrafts.$inferSelect)[] = [];
    if (userId) {
      results = await orm.select()
        .from(formDrafts)
        .where(
          and(
            eq(formDrafts.userId, userId),
            sql`${formDrafts.entityType} = ${entityType}::text`,
            sql`${formDrafts.draftKey} = ${draftKey}::text`,
            eq(formDrafts.isDeleted, 0),
            liveDraft
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
            eq(formDrafts.isDeleted, 0),
            liveDraft
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

    const conditions = [eq(formDrafts.isDeleted, 0), liveDraft];

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
   * v9.0.295 (TD-676): soft-deletes every draft that is no longer live; returns the number of drafts removed.
   */
  static async cleanupExpiredDrafts(): Promise<number> {
    const removed = await orm.update(formDrafts)
      .set({ isDeleted: 1 })
      .where(and(eq(formDrafts.isDeleted, 0), sql`NOT (${liveDraft})`))
      .returning({ id: formDrafts.id });
    return removed.length;
  }

  /** One cleanup at a time across processes (advisory lock 91031); a concurrent run returns null. */
  static async runCleanupExclusive(): Promise<number | null> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.FORM_DRAFT_CLEANUP, () => this.cleanupExpiredDrafts());
    return outcome.acquired ? outcome.result : null;
  }

  private static cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private static runCleanupInBackground(): void {
    this.runCleanupExclusive()
      .then((count) => {
        if (count) logger.info(`[Form drafts] Soft-deleted ${count} expired draft(s)`);
      })
      .catch((err: unknown) => logger.error(`[Form drafts] Expired draft cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Daily cleanup of expired drafts: once at start, then every `intervalMs`. */
  static startCleanup(intervalMs: number = DAY_MS): void {
    if (this.cleanupTimer) return;
    this.runCleanupInBackground();
    this.cleanupTimer = setInterval(() => this.runCleanupInBackground(), intervalMs);
    logger.info(`[Form drafts] Expired draft cleanup started with interval ${intervalMs}ms`);
  }

  static stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
