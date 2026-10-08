import { orm, type DbTransaction } from '../../db/drizzle.js';
import { deadLetterEvents, outboxEvents } from '../../db/schema.js';
import { eq, and, sql, desc, count, inArray, notInArray, type SQL } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { domainEventBus } from './domainEventBus.js';
import { BaseDomainEvent, AggregateType } from './domainEvents.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { lockIdleDeadLetterRows, RESOLVED_STATUS_LABELS, withDeadLetterRowLock } from './deadLetterRowLock.js';
import { deadLetterDeliveryJobId, replayDeliveryDeadLetter, requeueDeliveryDeadLetters } from './deadLetterDelivery.js';

/**
 * TD-245: وضعیت‌های «حل‌شده» صف قرنطینه — رویداد بازپخش‌شده یا صرف‌نظرشده دیگر خطای باز نیست.
 * شمارنده‌های سلامت سیستم، ممیزی یکپارچگی، بازگردانی گروهی به Outbox و پاکسازی همه همین قاعده را می‌خوانند.
 */
export const DLQ_RESOLVED_STATUSES = ['replayed', 'dismissed'] as const;

/** شرط ردیف‌های حل‌نشده DLQ (هر وضعیتی جز replayed / dismissed) */
export function unresolvedDeadLetterCondition(): SQL {
  return notInArray(deadLetterEvents.status, [...DLQ_RESOLVED_STATUSES]);
}

export interface DeadLetterRequeueResult {
  requeuedCount: number;
  dlqIds: number[];
  originalEventIds: string[];
  /** رویدادهایی که ردیف Outbox نداشتند (پاک‌شده) و با همان شناسه دوباره درج شدند */
  reinsertedEventIds: string[];
  before: Array<{ id: number; originalEventId: string; status: string; outboxStatus: string | null }>;
}

export interface DLQQueryFilters {
  status?: string;
  eventType?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class DeadLetterQueueService {

  /**
   * فیلدهای علامت‌گذاری حل‌شدن یک رویداد DLQ (بازپخش، صرف‌نظر یا بازگردانی به Outbox) — یکسان در همه مسیرها.
   */
  static resolutionFields(status: typeof DLQ_RESOLVED_STATUSES[number], userId: number | undefined, notes: string, nowIso = systemNowUtcIso()) {
    return {
      status,
      resolvedAt: nowIso,
      resolvedBy: userId || null,
      resolutionNotes: notes
    };
  }

  /**
   * Quarantines an event into Dead Letter Queue (DLQ) with detailed diagnostic info.
   */
  static async moveToDeadLetter(params: {
    originalEventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    source?: 'outbox' | 'action_engine' | 'webhook' | 'manual';
    payload?: unknown;
    metadata?: unknown;
    failureReason: string;
    errorStack?: string;
    retryCount?: number;
  }): Promise<typeof deadLetterEvents.$inferSelect> {
    try {
      const source = params.source || 'outbox';
      const retryCount = params.retryCount || 0;
      const nowIso = new Date().toISOString();

      // Check if already exists in DLQ
      const existing = await orm
        .select()
        .from(deadLetterEvents)
        .where(eq(deadLetterEvents.originalEventId, params.originalEventId))
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await orm
          .update(deadLetterEvents)
          .set({
            status: 'quarantined',
            failureReason: params.failureReason,
            errorStack: params.errorStack || existing[0].errorStack,
            retryCount: retryCount,
            payload: params.payload || existing[0].payload,
            metadata: params.metadata || existing[0].metadata,
            quarantinedAt: nowIso
          })
          .where(eq(deadLetterEvents.id, existing[0].id))
          .returning();

        logger.warn(`[DLQ] Updated existing quarantined event #${updated.id} [${params.eventType}] - ${params.failureReason}`);
        return updated;
      }

      const [inserted] = await orm
        .insert(deadLetterEvents)
        .values({
          originalEventId: params.originalEventId,
          eventType: params.eventType,
          aggregateType: params.aggregateType,
          aggregateId: String(params.aggregateId),
          source: source,
          payload: params.payload || {},
          metadata: params.metadata || {},
          failureReason: params.failureReason,
          errorStack: params.errorStack || '',
          retryCount: retryCount,
          status: 'quarantined',
          quarantinedAt: nowIso
        })
        .returning();

      logger.warn(`[DLQ] Quarantined event #${inserted.id} (Original ID: ${params.originalEventId}) into Dead Letter Queue: ${params.failureReason}`);
      return inserted;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[DLQ Move Error] Failed to quarantine event ${params.originalEventId}: ${errMsg}`);
      throw err;
    }
  }

  /**
   * Retrieves summary metrics and counts for the Dead Letter Queue.
   */
  static async getStats() {
    try {
      const allDlq = await orm
        .select({
          status: deadLetterEvents.status,
          source: deadLetterEvents.source,
          eventType: deadLetterEvents.eventType,
          count: count()
        })
        .from(deadLetterEvents)
        .groupBy(deadLetterEvents.status, deadLetterEvents.source, deadLetterEvents.eventType);

      let total = 0;
      let quarantined = 0;
      let replayed = 0;
      let dismissed = 0;
      const byEventType: Record<string, number> = {};
      const bySource: Record<string, number> = {};

      for (const row of allDlq) {
        const rowCount = Number(row.count) || 0;
        total += rowCount;
        if (row.status === 'quarantined') quarantined += rowCount;
        else if (row.status === 'replayed') replayed += rowCount;
        else if (row.status === 'dismissed') dismissed += rowCount;

        if (row.eventType) {
          byEventType[row.eventType] = (byEventType[row.eventType] || 0) + rowCount;
        }
        if (row.source) {
          bySource[row.source] = (bySource[row.source] || 0) + rowCount;
        }
      }

      return {
        total,
        quarantined,
        replayed,
        dismissed,
        byEventType,
        bySource
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[DLQ Stats Error] ${errMsg}`);
      return { total: 0, quarantined: 0, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} };
    }
  }

  /**
   * Fetch paginated DLQ items with dynamic filters.
   */
  static async getEvents(filters: DLQQueryFilters = {}) {
    try {
      const limit = Math.min(filters.limit || 50, 200);
      const offset = filters.offset || 0;

      const conditions: SQL[] = [];

      if (filters.status && filters.status !== 'all') {
        conditions.push(eq(deadLetterEvents.status, filters.status));
      }
      if (filters.eventType && filters.eventType !== 'all') {
        conditions.push(eq(deadLetterEvents.eventType, filters.eventType));
      }
      if (filters.source && filters.source !== 'all') {
        conditions.push(eq(deadLetterEvents.source, filters.source));
      }
      if (filters.search) {
        const searchPattern = containsLikePattern(filters.search);
        conditions.push(
          sql`(${deadLetterEvents.originalEventId} ILIKE ${searchPattern} OR ${deadLetterEvents.eventType} ILIKE ${searchPattern} OR ${deadLetterEvents.aggregateId} ILIKE ${searchPattern} OR ${deadLetterEvents.failureReason} ILIKE ${searchPattern})`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalCountResult] = await orm
        .select({ value: count() })
        .from(deadLetterEvents)
        .where(whereClause);

      const total = Number(totalCountResult?.value) || 0;

      const events = await orm
        .select()
        .from(deadLetterEvents)
        .where(whereClause)
        .orderBy(desc(deadLetterEvents.id))
        .limit(limit)
        .offset(offset);

      return {
        data: events,
        total,
        limit,
        offset
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[DLQ Get Events Error] ${errMsg}`);
      return { data: [], total: 0, limit: 50, offset: 0 };
    }
  }

  /**
   * Fetch single DLQ item by ID.
   */
  static async getById(id: number) {
    const records = await orm
      .select()
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.id, id))
      .limit(1);

    return records[0] || null;
  }

  /**
   * Edit and fix the payload of a quarantined DLQ event before replay.
   */
  static async editPayload(id: number, newPayload: unknown, userId?: number) {
    const record = await this.getById(id);
    if (!record) {
      throw new Error(`رکورد با شناسه ${id} در صف DLQ یافت نشد.`);
    }

    const [updated] = await orm
      .update(deadLetterEvents)
      .set({
        payload: newPayload,
        resolvedBy: userId || null
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    // If corresponding Outbox event exists, sync payload as well
    await orm
      .update(outboxEvents)
      .set({ payload: newPayload })
      .where(eq(outboxEvents.eventId, record.originalEventId));

    logger.info(`[DLQ] Updated payload for event #${id} by user ${userId || 'system'}`);
    return updated;
  }

  /**
   * Replay/Reprocess a single DLQ item.
   */
  static async replayEvent(id: number, updatedPayload?: unknown, userId?: number): Promise<{ success: boolean; message: string; event: typeof deadLetterEvents.$inferSelect }> {
    return withDeadLetterRowLock(id, () => this.replayLocked(id, updatedPayload, userId));
  }

  /**
   * v8.0.75 (TD-342): ردیف زیر قفل و پس از گرفتن آن دوباره خوانده می‌شود؛ رویداد بازپخش‌شده دوباره بازپخش نمی‌شود (پیش‌تر
   * دو بازپخش هم‌زمان یا پشت هم گرداننده‌ها را دو بار اجرا می‌کرد). رویداد صرف‌نظرشده را می‌توان بازپخش کرد.
   */
  private static async replayLocked(id: number, updatedPayload: unknown, userId: number | undefined): Promise<{ success: boolean; message: string; event: typeof deadLetterEvents.$inferSelect }> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundError(`رکورد با شناسه ${id} در صف DLQ یافت نشد.`);
    }
    if (record.status === 'replayed') {
      throw new ConflictError(`رویداد #${id} صف خطا پیش‌تر بازپخش شده است و دوباره بازپخش نمی‌شود.`);
    }

    const payload = updatedPayload || record.payload;
    const nowIso = new Date().toISOString();
    const deliveryJobId = deadLetterDeliveryJobId(record);

    try {
      if (deliveryJobId !== null) {
        // v9.0.365 (TD-705): only the failed delivery runs again, never the event's other deliveries or handlers
        await replayDeliveryDeadLetter(deliveryJobId, payload);
      } else {
        // 1. Construct DomainEvent
        const domainEvent: BaseDomainEvent = {
          eventId: record.originalEventId,
          eventType: record.eventType,
          aggregateType: record.aggregateType as AggregateType,
          aggregateId: record.aggregateId,
          payload: payload || {},
          metadata: {
            ...((record.metadata as Record<string, unknown>) || {}),
            replayedAt: nowIso,
            replayedBy: userId ?? null,
            isReplay: true
          } as unknown as BaseDomainEvent['metadata'],
          occurredAt: record.quarantinedAt || nowIso
        };

        // 2. v7.0.25 (TD-183 / audit P1-1): دیسپچ قابل‌ردیابی — قبلاً publish خطای هندلرها را می‌بلعید و
        // بازپخش همیشه «موفق» گزارش می‌شد. هندلرهایی که قبلاً برای این رویداد موفق شده‌اند دوباره اجرا نمی‌شوند.
        const [outboxRow] = await orm
          .select({ completedHandlers: outboxEvents.completedHandlers })
          .from(outboxEvents)
          .where(eq(outboxEvents.eventId, record.originalEventId));
        const previouslyCompleted = Array.isArray(outboxRow?.completedHandlers) ? outboxRow.completedHandlers : [];
        const dispatch = await domainEventBus.dispatchTracked(domainEvent, previouslyCompleted);
        if (outboxRow) {
          await orm
            .update(outboxEvents)
            .set({ completedHandlers: dispatch.completedHandlers })
            .where(eq(outboxEvents.eventId, record.originalEventId));
        }
        if (dispatch.failures.length > 0) {
          throw new Error(dispatch.failures.map(f => `${f.handler}: ${f.error}`).join(' | '));
        }
      }

      // 3. Mark DLQ as replayed
      const [updatedDlq] = await orm
        .update(deadLetterEvents)
        .set({
          ...this.resolutionFields('replayed', userId, `بازپخش موفق در تاریخ ${nowIso} توسط کاربر ${userId || 'مدیر'}`, nowIso),
          payload: payload
        })
        .where(eq(deadLetterEvents.id, id))
        .returning();

      // 4. Also mark Outbox record as completed if it exists
      await orm
        .update(outboxEvents)
        .set({
          status: 'completed',
          retryCount: record.retryCount,
          lastError: null,
          processedAt: nowIso,
          payload: payload
        })
        .where(eq(outboxEvents.eventId, record.originalEventId));

      logger.info(`[DLQ] Successfully replayed DLQ event #${id} (${record.eventType})`);
      return { success: true, message: 'رویداد با موفقیت بازپخش و در گذرگاه پردازش شد.', event: updatedDlq };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack || '' : '';
      logger.error(`[DLQ Replay Error] Failed to replay event #${id}: ${errMsg}`);
      
      // Update failure log
      await orm
        .update(deadLetterEvents)
        .set({
          failureReason: `شکست در بازپخش: ${errMsg}`,
          errorStack: errStack,
          retryCount: (record.retryCount || 0) + 1
        })
        .where(eq(deadLetterEvents.id, id));

      throw new Error(`خطا در بازپخش رویداد: ${errMsg}`);
    }
  }

  /**
   * Replay a batch of DLQ events.
   */
  static async replayBatch(ids: number[], userId?: number): Promise<{ total: number; succeeded: number; failed: number; errors: string[] }> {
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await this.replayEvent(id, undefined, userId);
        succeeded++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failed++;
        errors.push(`شناسه ${id}: ${errMsg}`);
      }
    }

    return { total: ids.length, succeeded, failed, errors };
  }

  /**
   * Dismiss a quarantined DLQ event (ignoring it from alert metrics).
   */
  static async dismissEvent(id: number, userId?: number, notes?: string) {
    // v8.0.75 (TD-342): زیر قفل همان ردیف — صرف‌نظر هم‌زمان با بازپخش رد می‌شود و رویداد حل‌شده دوباره علامت نمی‌خورد
    return withDeadLetterRowLock(id, async () => {
      const record = await this.getById(id);
      if (!record) {
        throw new NotFoundError(`رکورد با شناسه ${id} در صف DLQ یافت نشد.`);
      }
      const resolvedAs = RESOLVED_STATUS_LABELS[record.status];
      if (resolvedAs) {
        throw new ConflictError(`رویداد #${id} صف خطا پیش‌تر ${resolvedAs} شده است.`);
      }

      const [updated] = await orm
        .update(deadLetterEvents)
        .set(this.resolutionFields('dismissed', userId, notes || 'صرف‌نظر شده توسط کاربر مدیر'))
        .where(eq(deadLetterEvents.id, id))
        .returning();

      logger.info(`[DLQ] Dismissed event #${id} by user ${userId || 'system'}`);
      return updated;
    });
  }

  /**
   * TD-245: بازگردانی همه رویدادهای حل‌نشده DLQ به صف Outbox در تراکنش فراخواننده.
   * ردیف Outbox همان رویداد (شناسه اصلی) به pending با شمارنده صفر برمی‌گردد و completed_handlers آن حفظ می‌شود
   * تا هندلرهای موفق قبلی دوباره اجرا نشوند (TD-183)؛ اگر ردیف Outbox پاک شده باشد با همان شناسه درج می‌شود.
   * ردیف DLQ حذف نمی‌شود و مانند بازپخش با وضعیت replayed علامت می‌خورد؛ شکست دوباره در Outbox همان ردیف را
   * با moveToDeadLetter دوباره قرنطینه می‌کند. ردیف‌های replayed / dismissed دست نمی‌خورند.
   */
  static async requeueUnresolvedToOutbox(tx: DbTransaction, userId?: number): Promise<DeadLetterRequeueResult> {
    const unresolved = await tx
      .select()
      .from(deadLetterEvents)
      .where(unresolvedDeadLetterCondition())
      .orderBy(deadLetterEvents.id)
      .for('update');
    // v8.0.75 (TD-342): ردیفی که هم‌اکنون بازپخش می‌شود (قفل مشورتی‌اش گرفته شده) کنار می‌ماند تا Outbox آن را دوباره
    // اجرا نکند؛ قفل تراکنشی همان کلید ردیف‌های برگزیده را تا پایان این تراکنش از بازپخش دستی هم دور نگه می‌دارد.
    const pending = await lockIdleDeadLetterRows(tx, unresolved);

    if (pending.length === 0) {
      return { requeuedCount: 0, dlqIds: [], originalEventIds: [], reinsertedEventIds: [], before: [] };
    }

    // v9.0.365 (TD-705): a failed integration delivery goes back to its own delivery queue, not to the outbox
    const outboxRows = await requeueDeliveryDeadLetters(tx, pending);

    const eventIds = outboxRows.map(r => r.originalEventId);
    const existingOutbox = eventIds.length === 0 ? [] : await tx
      .select({ eventId: outboxEvents.eventId, status: outboxEvents.status })
      .from(outboxEvents)
      .where(inArray(outboxEvents.eventId, eventIds))
      .for('update');
    const outboxStatusById = new Map(existingOutbox.map(r => [r.eventId, r.status]));

    const nowIso = systemNowUtcIso();
    if (existingOutbox.length > 0) {
      await tx
        .update(outboxEvents)
        .set({ status: 'pending', retryCount: 0, nextRetryAt: null, lastError: null, processedAt: null, lockedAt: null, lockedBy: null })
        .where(inArray(outboxEvents.eventId, existingOutbox.map(r => r.eventId)));
    }

    const missing = outboxRows.filter(r => !outboxStatusById.has(r.originalEventId));
    if (missing.length > 0) {
      await tx.insert(outboxEvents).values(missing.map(r => ({
        eventId: r.originalEventId,
        eventType: r.eventType,
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
        status: 'pending',
        payload: r.payload || {},
        metadata: { ...((r.metadata as Record<string, unknown>) || {}), replayedFromDlq: true },
        retryCount: 0
      })));
    }

    const dlqIds = pending.map(r => r.id);
    await tx
      .update(deadLetterEvents)
      .set(this.resolutionFields('replayed', userId, `بازگردانی به صف Outbox در تاریخ ${nowIso} توسط کاربر ${userId || 'مدیر'}`, nowIso))
      .where(inArray(deadLetterEvents.id, dlqIds));

    logger.info(`[DLQ] Requeued ${pending.length} unresolved DLQ event(s) to the outbox by user ${userId || 'system'}`);
    return {
      requeuedCount: pending.length,
      dlqIds,
      originalEventIds: pending.map(r => r.originalEventId),
      reinsertedEventIds: missing.map(r => r.originalEventId),
      before: pending.map(r => ({ id: r.id, originalEventId: r.originalEventId, status: r.status, outboxStatus: outboxStatusById.get(r.originalEventId) ?? null }))
    };
  }

  /**
   * Purge resolved or dismissed DLQ items.
   */
  static async purgeResolved() {
    const deleted = await orm
      .delete(deadLetterEvents)
      .where(inArray(deadLetterEvents.status, [...DLQ_RESOLVED_STATUSES]))
      .returning();

    logger.info(`[DLQ] Purged ${deleted.length} resolved/dismissed records from Dead Letter Queue.`);
    return { purgedCount: deleted.length };
  }
}
