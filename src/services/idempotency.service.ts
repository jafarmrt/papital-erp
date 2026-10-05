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
  userId?: number | null;
  ttlSeconds?: number;
  lockTimeoutSeconds?: number;
}

export type AcquireResult =
  | { state: 'acquired'; action: 'PROCESS_NEW' }
  | { state: 'cached'; action: 'RETURN_CACHED'; responseStatus: number; statusCode: number; responseBody: unknown }
  | { state: 'in_flight'; action: 'IN_PROGRESS'; lockedUntil: string }
  | { state: 'mismatch'; action: 'KEY_REUSED' };

/** روش، مسیر و بدنه درخواستی که کلید برایش گرفته می‌شود (هر کدام که فراخواننده داده باشد سنجیده می‌شود) */
interface KeyRequest {
  method: string | null;
  path: string | null;
  payload: unknown;
}

/** JSON با کلیدهای مرتب: بدنه ذخیره‌شده در jsonb (ترتیب کلیدها را نگه نمی‌دارد) با بدنه تازه هم‌سنجی‌پذیر می‌شود */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * v8.0.79 (TD-329): کلیدی که با روش، مسیر یا بدنه دیگری ثبت شده برای این درخواست به کار نمی‌رود (پیش‌تر همان کلید با
 * مبلغ دیگر یا روی مسیر «انتقال» پاسخ ذخیره‌شده «دریافت» را می‌گرفت و اجرا نمی‌شد). فقط آنچه هر دو طرف دارند سنجیده می‌شود.
 */
function sameRequest(record: typeof idempotencyKeys.$inferSelect, req: KeyRequest): boolean {
  if (req.method && record.requestMethod && req.method.toUpperCase() !== record.requestMethod.toUpperCase()) return false;
  if (req.path && record.requestPath && req.path !== record.requestPath) return false;
  if (req.payload !== undefined && req.payload !== null && record.requestPayload !== null && record.requestPayload !== undefined) {
    return canonicalJson(req.payload) === canonicalJson(record.requestPayload);
  }
  return true;
}

export class IdempotencyService {
  /**
   * Helper to construct WHERE conditions for idempotency records
   */
  private static buildKeyCondition(cleanKey: string, scope?: string, userId?: number | null) {
    const conditions = [eq(idempotencyKeys.key, cleanKey)];
    if (scope !== undefined && scope !== null) {
      conditions.push(eq(idempotencyKeys.scope, scope));
    }
    if (userId !== undefined) {
      if (userId === null) {
        conditions.push(isNull(idempotencyKeys.createdById));
      } else {
        conditions.push(eq(idempotencyKeys.createdById, userId));
      }
    }
    return and(...conditions);
  }

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
    const userId = options.userId !== undefined && options.userId !== null ? options.userId : null;
    const lockTimeoutSec = options.lockTimeoutSeconds || 60; // 60s lock
    const ttlSec = options.ttlSeconds || 86400; // 24 hours retention
    const now = new Date();
    const nowIso = now.toISOString();
    const lockedUntil = new Date(now.getTime() + lockTimeoutSec * 1000).toISOString();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();
    const keyRequest: KeyRequest = {
      method: options.requestMethod || null,
      path: options.requestPath || null,
      payload: options.requestPayload ?? options.requestBody,
    };

    try {
      // 1. Try INSERT ON CONFLICT DO NOTHING (atomic check-and-insert on triple unique index)
      const inserted = await orm
        .insert(idempotencyKeys)
        .values({
          key: cleanKey,
          scope,
          status: 'processing',
          requestMethod: options.requestMethod || null,
          requestPath: options.requestPath || null,
          requestPayload: options.requestPayload || options.requestBody || null,
          createdById: userId,
          lockedAt: nowIso,
          lockedUntil,
          createdAt: nowIso,
          expiresAt
        })
        .onConflictDoNothing({ target: [idempotencyKeys.createdById, idempotencyKeys.scope, idempotencyKeys.key] })
        .returning();

      if (inserted.length > 0) {
        return { state: 'acquired', action: 'PROCESS_NEW' };
      }

      // 2. Record already exists (conflict occurred) -> fetch existing record for this (user, scope, key)
      const existing = await orm
        .select()
        .from(idempotencyKeys)
        .where(this.buildKeyCondition(cleanKey, scope, userId))
        .limit(1);

      if (existing.length > 0) {
        return this.handleExistingKey(existing[0], cleanKey, lockedUntil, nowIso, keyRequest);
      }

      return { state: 'acquired', action: 'PROCESS_NEW' };
    } catch (error: unknown) {
      const errObj = error as { code?: string; message?: string } | undefined;
      if (errObj?.code === '23505' || errObj?.message?.includes('unique constraint') || errObj?.message?.includes('duplicate key')) {
        const existing = await orm
          .select()
          .from(idempotencyKeys)
          .where(this.buildKeyCondition(cleanKey, scope, userId))
          .limit(1);
        if (existing.length > 0) {
          return this.handleExistingKey(existing[0], cleanKey, lockedUntil, nowIso, keyRequest);
        }
      }
      logger.error(`[Idempotency] Error in acquireKey for '${cleanKey}' [scope: ${scope}, user: ${userId}]:`, error);
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
    nowIso: string,
    keyRequest: KeyRequest
  ): Promise<AcquireResult> {
    if (record.status !== 'failed' && !sameRequest(record, keyRequest)) {
      logger.warn(`[Idempotency] Key '${record.key}' reused for a different request (${keyRequest.method ?? '-'} ${keyRequest.path ?? '-'})`);
      return { state: 'mismatch', action: 'KEY_REUSED' };
    }

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
      return this.reacquireWithOcc(record, cleanKey, newLockedUntil, nowIso, keyRequest);
    }

    // If previously failed or in any other non-completed status, attempt re-acquire via OCC
    return this.reacquireWithOcc(record, cleanKey, newLockedUntil, nowIso, keyRequest);
  }

  private static async reacquireWithOcc(
    record: typeof idempotencyKeys.$inferSelect,
    cleanKey: string,
    newLockedUntil: string,
    nowIso: string,
    keyRequest: KeyRequest
  ): Promise<AcquireResult> {
    const lockedUntilCond = record.lockedUntil !== null && record.lockedUntil !== undefined
      ? eq(idempotencyKeys.lockedUntil, record.lockedUntil)
      : isNull(idempotencyKeys.lockedUntil);

    const result = await orm
      .update(idempotencyKeys)
      .set({
        lockedUntil: newLockedUntil,
        lockedAt: nowIso,
        status: 'processing',
        ...(keyRequest.method ? { requestMethod: keyRequest.method } : {}),
        ...(keyRequest.path ? { requestPath: keyRequest.path } : {}),
        ...(keyRequest.payload !== undefined && keyRequest.payload !== null ? { requestPayload: keyRequest.payload } : {}),
      })
      .where(and(
        eq(idempotencyKeys.id, record.id),
        eq(idempotencyKeys.status, record.status), // OCC check status
        lockedUntilCond // OCC check lockedUntil
      ))
      .returning();

    if (result.length === 0) {
      // OCC collision: state or lock changed between SELECT and UPDATE -> re-fetch current state by record ID
      logger.info(`[Idempotency] OCC collision for record id ${record.id} / key '${cleanKey}', fetching updated state...`);
      return this.getResponseForRecord(record.id, fallbackLockedUntilHelper(newLockedUntil));
    }

    return { state: 'acquired', action: 'PROCESS_NEW' };
  }

  private static async getResponseForRecord(recordId: number, fallbackLockedUntil: string): Promise<AcquireResult> {
    const reFetched = await orm
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.id, recordId))
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
  static async saveResponse(
    key: string,
    responseStatus: number,
    responseBody: unknown,
    options?: { scope?: string; userId?: number | null }
  ): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();

    try {
      const condition = this.buildKeyCondition(cleanKey, options?.scope, options?.userId);
      await orm
        .update(idempotencyKeys)
        .set({
          status: 'completed',
          responseStatus,
          responseBody: (responseBody as Record<string, unknown>) || {},
          completedAt: new Date().toISOString()
        })
        .where(condition);
      logger.info(`[Idempotency] Saved response for key: ${cleanKey} [scope: ${options?.scope || 'any'}, user: ${options?.userId ?? 'any'}] (status: ${responseStatus})`);
    } catch (error) {
      logger.error(`[Idempotency] Error saving response for key '${cleanKey}':`, error);
    }
  }

  /**
   * Universal complete helper
   */
  static async complete(options: {
    key: string;
    scope?: string;
    userId?: number | null;
    statusCode?: number;
    responseStatus?: number;
    responseBody: unknown;
  }): Promise<void> {
    const status = options.statusCode ?? options.responseStatus ?? 200;
    return this.saveResponse(options.key, status, options.responseBody, {
      scope: options.scope,
      userId: options.userId
    });
  }

  /**
   * v8.0.79 (TD-329): کلید درخواستی که پاسخ ناموفق (۴xx/۵xx) گرفت آزاد می‌شود تا تکرار همان درخواست دوباره اجرا شود
   * (پیش‌تر پاسخ ۴۲۲ «تکمیل‌شده» ذخیره می‌شد و تکرار پس از رفع علت، همان خطای کهنه را می‌گرفت).
   */
  static async releaseKey(key: string, options?: { scope?: string; userId?: number | null }): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();
    try {
      await orm
        .delete(idempotencyKeys)
        .where(and(this.buildKeyCondition(cleanKey, options?.scope, options?.userId), eq(idempotencyKeys.status, 'processing')));
    } catch (error) {
      logger.error(`[Idempotency] Error releasing key '${cleanKey}':`, error);
    }
  }

  /**
   * v8.0.79 (TD-329): پنجره قفل کلید در حال اجرا را از اکنون تمدید می‌کند (میان‌افزار در طول اجرای درخواست آن را
   * پیوسته صدا می‌زند؛ پیش‌تر درخواست طولانی‌تر از پنجره، با تکرار همان کلید دوباره اجرا می‌شد).
   */
  static async extendLock(
    key: string,
    options: { scope?: string; userId?: number | null; lockTimeoutSeconds?: number }
  ): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();
    const lockedUntil = new Date(Date.now() + (options.lockTimeoutSeconds || 60) * 1000).toISOString();
    try {
      await orm
        .update(idempotencyKeys)
        .set({ lockedUntil })
        .where(and(this.buildKeyCondition(cleanKey, options.scope, options.userId), eq(idempotencyKeys.status, 'processing')));
    } catch (error) {
      logger.error(`[Idempotency] Error extending lock of key '${cleanKey}':`, error);
    }
  }

  /**
   * Marks an idempotency key as failed.
   */
  static async markFailed(
    key: string,
    error?: unknown,
    options?: { scope?: string; userId?: number | null }
  ): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim() === '') return;
    const cleanKey = key.trim();

    const errorMessage = error instanceof Error 
      ? error.message 
      : (typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : 'Operation failed');

    try {
      const condition = this.buildKeyCondition(cleanKey, options?.scope, options?.userId);
      await orm
        .update(idempotencyKeys)
        .set({
          status: 'failed',
          responseStatus: 500,
          responseBody: { error: errorMessage },
          completedAt: new Date().toISOString()
        })
        .where(condition);
    } catch (err) {
      logger.error(`[Idempotency] Error marking failed key '${cleanKey}':`, err);
    }
  }

  /**
   * Universal fail helper
   */
  static async fail(options: {
    key: string;
    scope?: string;
    userId?: number | null;
    error?: unknown;
  }): Promise<void> {
    return this.markFailed(options.key, options.error, {
      scope: options.scope,
      userId: options.userId
    });
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

function fallbackLockedUntilHelper(newLockedUntil: string): string {
  return newLockedUntil;
}
