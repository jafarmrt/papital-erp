import { orm } from '../../db/drizzle.js';
import { deadLetterEvents, outboxEvents } from '../../db/schema.js';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { domainEventBus } from './domainEventBus.js';
import { BaseDomainEvent } from './domainEvents.js';

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
   * Alias methods for backwards compatibility
   */
  static async getDLQItems(status?: string) {
    const res = await this.getEvents({ status, limit: 100 });
    return res.data;
  }

  static async replayItem(id: number, adjustedPayload?: any) {
    return this.replayEvent(id, adjustedPayload);
  }

  static async dismissItem(id: number) {
    return this.dismissEvent(id);
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
    payload?: any;
    metadata?: any;
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
    } catch (err: any) {
      logger.error(`[DLQ Move Error] Failed to quarantine event ${params.originalEventId}: ${err.message}`);
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
    } catch (err: any) {
      logger.error(`[DLQ Stats Error] ${err.message}`);
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

      const conditions = [];

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
        const searchPattern = `%${filters.search}%`;
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
    } catch (err: any) {
      logger.error(`[DLQ Get Events Error] ${err.message}`);
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
  static async editPayload(id: number, newPayload: any, userId?: number) {
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
  static async replayEvent(id: number, updatedPayload?: any, userId?: number): Promise<{ success: boolean; message: string; event: any }> {
    const record = await this.getById(id);
    if (!record) {
      throw new Error(`رکورد با شناسه ${id} در صف DLQ یافت نشد.`);
    }

    const payload = updatedPayload || record.payload;
    const nowIso = new Date().toISOString();

    try {
      // 1. Construct DomainEvent
      const domainEvent: BaseDomainEvent = {
        eventId: record.originalEventId,
        eventType: record.eventType as any,
        aggregateType: record.aggregateType as any,
        aggregateId: record.aggregateId,
        payload: payload || {},
        metadata: {
          ...(record.metadata as any || {}),
          replayedAt: nowIso,
          replayedBy: userId || 'admin',
          isReplay: true
        },
        occurredAt: record.quarantinedAt || nowIso
      };

      // 2. Publish to DomainEventBus directly
      await domainEventBus.publish(domainEvent);

      // 3. Mark DLQ as replayed
      const [updatedDlq] = await orm
        .update(deadLetterEvents)
        .set({
          status: 'replayed',
          payload: payload,
          resolvedAt: nowIso,
          resolvedBy: userId || null,
          resolutionNotes: `بازپخش موفق در تاریخ ${nowIso} توسط کاربر ${userId || 'مدیر'}`
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
    } catch (err: any) {
      logger.error(`[DLQ Replay Error] Failed to replay event #${id}: ${err.message}`);
      
      // Update failure log
      await orm
        .update(deadLetterEvents)
        .set({
          failureReason: `شکست در بازپخش: ${err.message}`,
          errorStack: err.stack || '',
          retryCount: (record.retryCount || 0) + 1
        })
        .where(eq(deadLetterEvents.id, id));

      throw new Error(`خطا در بازپخش رویداد: ${err.message}`);
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
      } catch (err: any) {
        failed++;
        errors.push(`شناسه ${id}: ${err.message}`);
      }
    }

    return { total: ids.length, succeeded, failed, errors };
  }

  /**
   * Dismiss a quarantined DLQ event (ignoring it from alert metrics).
   */
  static async dismissEvent(id: number, userId?: number, notes?: string) {
    const record = await this.getById(id);
    if (!record) {
      throw new Error(`رکورد با شناسه ${id} در صف DLQ یافت نشد.`);
    }

    const [updated] = await orm
      .update(deadLetterEvents)
      .set({
        status: 'dismissed',
        resolvedAt: new Date().toISOString(),
        resolvedBy: userId || null,
        resolutionNotes: notes || 'صرف‌نظر شده توسط کاربر مدیر'
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    logger.info(`[DLQ] Dismissed event #${id} by user ${userId || 'system'}`);
    return updated;
  }

  /**
   * Purge resolved or dismissed DLQ items.
   */
  static async purgeResolved() {
    const deleted = await orm
      .delete(deadLetterEvents)
      .where(
        sql`${deadLetterEvents.status} IN ('replayed', 'dismissed')`
      )
      .returning();

    logger.info(`[DLQ] Purged ${deleted.length} resolved/dismissed records from Dead Letter Queue.`);
    return { purgedCount: deleted.length };
  }
}
