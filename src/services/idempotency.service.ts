import { eq, and, sql, lt, isNull } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { idempotencyKeys } from '../db/schema.js';
import { logger } from '../middleware/logger.js';

export interface AcquireKeyOptions {
  key?: string;
  scope?: string;
  requestMethod?: string;
  requestPath?: string;
  requestPayload?: unknown;
  requestBody?: unknown;
  userId?: number;
  ttlSeconds?: number;
  lockTimeoutSeconds?: number;
}

export type AcquireResult =
  | { state: 'acquired'; action: 'PROCESS_NEW' }
  | { state: 'cached'; action: 'RETURN_CACHED'; responseStatus: number; statusCode: number; responseBody: unknown }
  | { state: 'in_flight'; action: 'IN_PROGRESS'; lockedUntil: string };

export class IdempotencyService {
  /**
   * Attempts to acquire an idempotency key.
   * If already completed, returns cached response.
   * If in-flight and not expired, indicates concurrent execution.
   */
  static async acquireKey(key: string, options: AcquireKeyOptions = {}): Promise<AcquireResult> {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return { state: 'acquired', action: 'PROCESS_NEW' };
    }

    const cleanKey = key.trim();
    const scope = options.scope || 'global';
    const lockTimeoutSec = options.lockTimeoutSeconds || 60; // 60s lock
    const ttlSec = options.ttlSeconds || 86400; // 24 hours retention
    const now = new Date();
    const nowIso = now.toISOString();
    const lockedUntil = new Date(now.getTime() + lockTimeoutSec * 1000).toISOString();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();

    try {
      // 1. Try INSERT ON CONFLICT DO NOTHING (atomic check-and-insert)
      const inserted = await orm
        .insert(idempotencyKeys)
        .values({
          key: cleanKey,
          scope,
          status: 'processing',
          requestMethod: options.requestMethod || null,
          requestPath: options.requestPath || null,
          requestPayload: options.requestPayload || options.requestBody || null,
          createdById: options.userId || null,
          lockedAt: nowIso,
          lockedUntil,
          createdAt: nowIso,
          expiresAt
        })
        .onConflictDoNothing({ target: idempotencyKeys.key })
        .returning();

      if (inserted.length > 0) {
        return { state: 'acquired', action: 'PROCESS_NEW' };
      }

      // 2. Record already exists (conflict occurred) -> fetch existing record
      const existing = await orm
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, cleanKey))
        .limit(1);

      if (existing.length > 0) {
        return this.handleExistingKey(existing[0], cleanKey, lockedUntil, nowIso);
      }

      return { state: 'acquired', action: 'PROCESS_NEW' };
    } catch (error: unknown) {
      const errObj = error as { code?: string; message?: string } | undefined;
      if (errObj?.code === '23505' || errObj?.message?.includes('unique constraint') || errObj?.message?.includes('duplicate key')) {
        const existing = await orm
          .select()
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, cleanKey))
          .limit(1);
        if (existing.length > 0) {
          return this.handleExistingKey(existing[0], cleanKey, lockedUntil, nowIso);
        }
      }
      logger.error(`[Idempotency] Error in acquireKey for '${cleanKey}':`, error);
      throw error;
    }
  }

  /**
   * Universal acquireOrGet helper accepting options object directly
   */
  static async acquireOrGet(options: AcquireKeyOptions & { key: string }): Promise<AcquireResult> {
    return this.acquireKey(options.key, options);
  }

  private static async handleExistingKey(
    record: typeof idempotencyKeys.$inferSelect,
    cleanKey: string,
    newLockedUntil: string,
    nowIso: string
  ): Promise<AcquireResult> {
    if (record.status === 'completed') {
      logger.info(`[Idempotency] Returning cached response for key: ${record.key}`);
      const status = record.responseStatus ?? 200;
      const body = record.responseBody ?? {};
      return {
        state: 'cached',
        action: 'RETURN_CACHED',
        responseStatus: status,
        statusCode: status,
        responseBody: body
      };
    }

    if (record.status === 'processing') {
      // Timezone-safe lock expiry check (Phase 8 fix): the writer stores a UTC
      // wall-clock string into a TIMESTAMP (without tz) column. When the driver
      // hands it back as a local-shifted Date, reconstruct the original UTC
      // instant from its wall-clock parts — otherwise servers off UTC (e.g.
      // UTC+3:30) treat every live lock as expired and OCC re-acquires it,
      // defeating IN_PROGRESS deduplication.
      const rawLock = record.lockedUntil as unknown;
      const lockDate = rawLock instanceof Date ? rawLock : new Date(String(rawLock));
      const lockExpiry = Number.isNaN(lockDate.getTime())
        ? 0
        : Date.UTC(
            lockDate.getFullYear(),
            lockDate.getMonth(),
            lockDate.getDate(),
            lockDate.getHours(),
            lockDate.getMinutes(),
            lockDate.getSeconds(),
            lockDate.getMilliseconds()
          );
      const nowMs = Date.now();

      if (lockExpiry > nowMs) {
        // In-flight and still within lock timeout
        logger.warn(`[Idempotency] Concurrent request detected for in-flight key: ${record.key}`);
        return {
          state: 'in_flight',
          action: 'IN_PROGRESS',
          lockedUntil: record.lockedUntil || newLockedUntil
        };
      }

      // Lock timed out (crash recovery) -> re-acquire using Optimistic Concurrency Control (OCC)
      logger.warn(`[Idempotency] Re-acquiring timed out processing key: ${record.key}`);
      return this.reacquireWithOcc(record, cleanKey, newLockedUntil, nowIso);
    }

    // If previously failed or in any other non-completed status, attempt re-acquire via OCC
    return this.reacquireWithOcc(record, cleanKey, newLockedUntil, nowIso);
  }

  private static async reacquireWithOcc(
    record: typeof idempotencyKeys.$inferSelect,
    cleanKey: string,
    newLockedUntil: string,
    nowIso: string
  ): Promise<AcquireResult> {
    const lockedUntilCond = record.lockedUntil !== null && record.lockedUntil !== undefined
      ? eq(idempotencyKeys.lockedUntil, record.lockedUntil)
      : isNull(idempotencyKeys.lockedUntil);

    const result = await orm
      .update(idempotencyKeys)
      .set({
        lockedUntil: newLockedUntil,
        lockedAt: nowIso,
        status: 'processing'
      })
      .where(and(
        eq(idempotencyKeys.id, record.id),
        eq(idempotencyKeys.status, record.status), // OCC check status
        lockedUntilCond // OCC check lockedUntil
      ))
      .returning();

    if (result.length === 0) {
      // OCC collision: state or lock changed between SELECT and UPDATE -> re-fetch current state
      logger.info(`[Idempotency] OCC collision for key '${cleanKey}', fetching updated state...`);
      return this.getResponseForKey(cleanKey, newLockedUntil);
    }

    return { state: 'acquired', action: 'PROCESS_NEW' };
  }

  private static async getResponseForKey(cleanKey: string, fallbackLockedUntil: string): Promise<AcquireResult> {
    const reFetched = await orm
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, cleanKey))
      .limit(1);

    if (reFetched.length > 0) {
      const fresh = reFetched[0];
      if (fresh.status === 'completed') {
        const status = fresh.responseStatus ?? 200;
        return {
          state: 'cached',
          action: 'RETURN_CACHED',
          responseStatus: status,
          statusCode: status,
          responseBody: fresh.responseBody ?? {}
        };
      }
      if (fresh.status === 'processing') {
        return {
          state: 'in_flight',
          action: 'IN_PROGRESS',
          lockedUntil: fresh.lockedUntil || fallbackLockedUntil
        };
      }
    }

    return { state: 'acquired', action: 'PROCESS_NEW' };
  }

  /**
   * Saves the completed response against the idempotency key.
   */
  static async saveResponse(key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();

    try {
      await orm
        .update(idempotencyKeys)
        .set({
          status: 'completed',
          responseStatus,
          responseBody: (responseBody as Record<string, unknown>) || {},
          completedAt: new Date().toISOString()
        })
        .where(eq(idempotencyKeys.key, cleanKey));
      logger.info(`[Idempotency] Saved response for key: ${cleanKey} (status: ${responseStatus})`);
    } catch (error) {
      logger.error(`[Idempotency] Error saving response for key '${cleanKey}':`, error);
    }
  }

  /**
   * Universal complete helper
   */
  static async complete(options: { key: string; scope?: string; statusCode?: number; responseStatus?: number; responseBody: unknown }): Promise<void> {
    const status = options.statusCode ?? options.responseStatus ?? 200;
    return this.saveResponse(options.key, status, options.responseBody);
  }

  /**
   * Marks an idempotency key as failed.
   */
  static async markFailed(key: string, error?: unknown): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();

    const errorMessage = error instanceof Error 
      ? error.message 
      : (typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : 'Operation failed');

    try {
      await orm
        .update(idempotencyKeys)
        .set({
          status: 'failed',
          responseStatus: 500,
          responseBody: { error: errorMessage },
          completedAt: new Date().toISOString()
        })
        .where(eq(idempotencyKeys.key, cleanKey));
    } catch (err) {
      logger.error(`[Idempotency] Error marking failed key '${cleanKey}':`, err);
    }
  }

  /**
   * Universal fail helper
   */
  static async fail(options: { key: string; error?: unknown }): Promise<void> {
    return this.markFailed(options.key, options.error);
  }

  /**
   * Cleans up expired idempotency keys
   */
  static async cleanupExpired(): Promise<number> {
    try {
      const now = new Date().toISOString();
      await orm
        .delete(idempotencyKeys)
        .where(and(sql`${idempotencyKeys.expiresAt} IS NOT NULL`, lt(idempotencyKeys.expiresAt, now)));
      return 1;
    } catch (err) {
      logger.error('[Idempotency] Error cleaning up expired keys:', err);
      return 0;
    }
  }
}
