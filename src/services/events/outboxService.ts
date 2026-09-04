import { orm, pool, type DbExecutor } from '../../db/drizzle.js';
import { outboxEvents } from '../../db/schema.js';
import { eq, and, or, lte, sql, desc, type SQL } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { BaseDomainEvent, AggregateType } from './domainEvents.js';
import { domainEventBus } from './domainEventBus.js';
import { DeadLetterQueueService } from './deadLetterQueueService.js';
import { observeOutboxProcessing } from '../../middleware/metrics.js';

export interface OutboxQueryFilters {
  status?: string;
  eventType?: string;
  aggregateType?: string;
  limit?: number;
  offset?: number;
}

export class OutboxService {
  private static isWorkerRunning = false;
  private static workerIntervalId: NodeJS.Timeout | null = null;
  private static recoveryIntervalId: NodeJS.Timeout | null = null;
  private static isProcessingBatch = false;
  private static readonly MAX_RETRIES = 5;

  /**
   * Alias for saveToOutbox for backwards compatibility
   */
  static async recordEvent<T = unknown>(tx: DbExecutor, event: BaseDomainEvent<T>): Promise<void> {
    return this.saveToOutbox(tx, event);
  }

  /**
   * Alias for processPendingBatch for backwards compatibility
   */
  static async processPendingEvents(batchSize: number = 25) {
    return this.processPendingBatch(batchSize);
  }

  /**
   * Saves a domain event inside an existing Drizzle transaction.
   * This guarantees transactional atomicity between business mutations and outbox persistence.
   */
  static async saveToOutbox<T = unknown>(
    tx: DbExecutor,
    event: BaseDomainEvent<T>
  ): Promise<void> {
    try {
      const dbExecutor = tx || orm;

      await dbExecutor.insert(outboxEvents).values({
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: String(event.aggregateId),
        status: 'pending',
        payload: event.payload || {},
        metadata: event.metadata || {},
        retryCount: 0,
        nextRetryAt: null,
        lastError: '',
        occurredAt: event.occurredAt || new Date().toISOString()
      });

      logger.info(`[Transactional Outbox] Enqueued event ${event.eventType} for ${event.aggregateType}#${event.aggregateId} [EventID: ${event.eventId}]`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Transactional Outbox Save Error] Failed to persist outbox event ${event.eventId}: ${errMsg}`);
      throw err; // Re-throw to abort business transaction if outbox persistence fails
    }
  }

  /**
   * Process a batch of pending or due-for-retry outbox events.
   */
  static async processPendingBatch(batchSize: number = 25): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessingBatch) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessingBatch = true;
    const batchStart = Date.now();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const now = new Date();
      const nowIso = now.toISOString();

      // Fetch pending events or events whose retry backoff has elapsed
      const candidateEvents = await orm
        .select()
        .from(outboxEvents)
        .where(
          or(
            eq(outboxEvents.status, 'pending'),
            and(
              eq(outboxEvents.status, 'failed'),
              lte(outboxEvents.nextRetryAt, nowIso),
              sql`${outboxEvents.retryCount} < ${this.MAX_RETRIES}`
            )
          )
        )
        .orderBy(outboxEvents.id)
        .limit(batchSize);

      if (candidateEvents.length === 0) {
        this.isProcessingBatch = false;
        return { processed: 0, succeeded: 0, failed: 0 };
      }

        for (const rawEvent of candidateEvents) {
          const currentRetry = (rawEvent.retryCount || 0);

          // 1. Atomic Claim Attempt: Mark as 'processing' with conditional check to prevent concurrent worker execution
          const claimed = await orm
            .update(outboxEvents)
            .set({
              status: 'processing',
              lockedAt: nowIso,
              lockedBy: process.env.WORKER_ID || `worker-${process.pid || 1}`
            })
            .where(
              and(
                eq(outboxEvents.id, rawEvent.id),
                or(
                  eq(outboxEvents.status, 'pending'),
                  and(
                    eq(outboxEvents.status, 'failed'),
                    lte(outboxEvents.nextRetryAt, nowIso)
                  )
                )
              )
            )
            .returning({ id: outboxEvents.id });

          if (!claimed || claimed.length === 0) {
            // Event was already claimed by another worker instance in parallel
            continue;
          }

          processed++;

          try {
            // 2. Reconstitute BaseDomainEvent structure
          const domainEvent: BaseDomainEvent = {
            eventId: rawEvent.eventId,
            eventType: rawEvent.eventType,
            aggregateType: rawEvent.aggregateType as AggregateType,
            aggregateId: rawEvent.aggregateId,
            payload: rawEvent.payload || {},
            metadata: ((rawEvent.metadata as Record<string, unknown>) || { timestamp: rawEvent.occurredAt || nowIso }) as unknown as BaseDomainEvent['metadata'],
            occurredAt: rawEvent.occurredAt || nowIso
          };

          // 3. Dispatch to DomainEventBus
          await domainEventBus.publish(domainEvent);

          // 4. Mark as completed
          await orm
            .update(outboxEvents)
            .set({
              status: 'completed',
              processedAt: new Date().toISOString(),
              lastError: null,
              lockedAt: null,
              lockedBy: null
            })
            .where(eq(outboxEvents.id, rawEvent.id));

          succeeded++;
          logger.info(`[Transactional Outbox] Successfully dispatched outbox event #${rawEvent.id} (${rawEvent.eventType})`);
        } catch (err: unknown) {
          failed++;
          const newRetryCount = currentRetry + 1;
          const isFinalFailure = newRetryCount >= this.MAX_RETRIES;
          const errMsg = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? err.stack || '' : '';
          
          // Exponential backoff: 5s, 10s, 20s, 40s, 80s (max 300s)
          const backoffSeconds = Math.min(300, Math.pow(2, newRetryCount) * 5);
          const nextRetryDate = new Date(Date.now() + backoffSeconds * 1000).toISOString();

          await orm
            .update(outboxEvents)
            .set({
              status: isFinalFailure ? 'failed' : 'pending',
              retryCount: newRetryCount,
              nextRetryAt: isFinalFailure ? null : nextRetryDate,
              lastError: errMsg || 'خطای نامشخص در پردازش رویداد',
              processedAt: isFinalFailure ? new Date().toISOString() : null,
              lockedAt: null,
              lockedBy: null
            })
            .where(eq(outboxEvents.id, rawEvent.id));

          if (isFinalFailure) {
            await DeadLetterQueueService.moveToDeadLetter({
              originalEventId: rawEvent.eventId,
              eventType: rawEvent.eventType,
              aggregateType: rawEvent.aggregateType,
              aggregateId: rawEvent.aggregateId,
              source: 'outbox',
              payload: rawEvent.payload,
              metadata: rawEvent.metadata,
              failureReason: `اتمام سقف تلاش‌ها (${this.MAX_RETRIES} تلاش): ${errMsg || 'خطای پردازش'}`,
              errorStack: errStack,
              retryCount: newRetryCount
            }).catch(dlqErr => {
              const dlqErrMsg = dlqErr instanceof Error ? dlqErr.message : String(dlqErr);
              logger.error(`[DLQ Auto Move Error] ${dlqErrMsg}`);
            });
          }

          logger.error(`[Transactional Outbox] Failed to dispatch event #${rawEvent.id} (Attempt ${newRetryCount}/${this.MAX_RETRIES}): ${errMsg}`);
        }
      }
    } catch (globalErr: unknown) {
      const globalErrMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
      logger.error(`[Transactional Outbox Batch Error] ${globalErrMsg}`);
    } finally {
      if (processed > 0) {
        observeOutboxProcessing((Date.now() - batchStart) / 1000);
      }
      this.isProcessingBatch = false;
    }

    return { processed, succeeded, failed };
  }

  /**
   * Start the background Outbox Polling Worker.
   */
  static startOutboxWorker(intervalMs: number = 3000): void {
    if (this.isWorkerRunning) {
      return;
    }

    this.isWorkerRunning = true;
    logger.info(`[Transactional Outbox] Background worker started with interval ${intervalMs}ms`);

    // Jitter for multi-instance safety (0-1000ms delay for interval offset)
    const initialJitter = Math.floor(Math.random() * 1000);

    setTimeout(() => {
      if (!this.isWorkerRunning) return;

      this.workerIntervalId = setInterval(async () => {
        try {
          await OutboxService.processPendingBatch();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Transactional Outbox Worker Error] ${errMsg}`);
        }
      }, intervalMs);

      // Recovery timer for stuck events every 60 seconds (60000ms)
      this.recoveryIntervalId = setInterval(async () => {
        try {
          await OutboxService.recoverStuckEvents();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Transactional Outbox Recovery Error] ${errMsg}`);
        }
      }, 60000);
    }, initialJitter);
  }

  /**
   * Stop the background Outbox Polling Worker.
   */
  static stopOutboxWorker(): void {
    if (this.workerIntervalId) {
      clearInterval(this.workerIntervalId);
      this.workerIntervalId = null;
    }
    if (this.recoveryIntervalId) {
      clearInterval(this.recoveryIntervalId);
      this.recoveryIntervalId = null;
    }
    this.isWorkerRunning = false;
    logger.info('[Transactional Outbox] Background worker stopped');
  }

  /**
   * Scans for outbox events stuck in 'processing' status longer than stuckThresholdMinutes (default 5 minutes)
   * and resets them to 'pending' (or moves to DLQ if max retries reached).
   */
  static async recoverStuckEvents(stuckThresholdMinutes: number = 5): Promise<number> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - stuckThresholdMinutes * 60 * 1000).toISOString();

      const stuckEvents = await orm
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.status, 'processing'),
            or(
              lte(outboxEvents.lockedAt, fiveMinutesAgo),
              and(
                sql`${outboxEvents.lockedAt} IS NULL`,
                lte(outboxEvents.occurredAt, fiveMinutesAgo)
              )
            )
          )
        );

      if (stuckEvents.length === 0) {
        return 0;
      }

      logger.warn(`[Outbox Recovery] Found ${stuckEvents.length} stuck event(s) in 'processing' state older than ${stuckThresholdMinutes}m`);
      let recoveredCount = 0;

      for (const ev of stuckEvents) {
        const newRetryCount = (ev.retryCount || 0) + 1;
        const isFinalFailure = newRetryCount >= this.MAX_RETRIES;

        if (isFinalFailure) {
          await orm
            .update(outboxEvents)
            .set({
              status: 'failed',
              retryCount: newRetryCount,
              lastError: `Max retries exceeded (${this.MAX_RETRIES}) after outbox recovery (stuck in processing)`,
              processedAt: new Date().toISOString(),
              lockedAt: null,
              lockedBy: null
            })
            .where(eq(outboxEvents.id, ev.id));

          await DeadLetterQueueService.moveToDeadLetter({
            originalEventId: ev.eventId,
            eventType: ev.eventType,
            aggregateType: ev.aggregateType,
            aggregateId: ev.aggregateId,
            source: 'outbox',
            payload: ev.payload,
            metadata: ev.metadata,
            failureReason: `Exceeded max retries (${this.MAX_RETRIES}) during outbox stuck recovery`,
            retryCount: newRetryCount
          }).catch(dlqErr => logger.error(`[Outbox Recovery DLQ Error] ${dlqErr.message}`));
        } else {
          await orm
            .update(outboxEvents)
            .set({
              status: 'pending',
              retryCount: newRetryCount,
              lockedAt: null,
              lockedBy: null,
              nextRetryAt: null,
              lastError: `Reset to pending by Outbox Recovery (stuck in processing)`
            })
            .where(eq(outboxEvents.id, ev.id));
        }
        recoveredCount++;
      }

      logger.info(`[Outbox Recovery] Successfully recovered ${recoveredCount} stuck outbox event(s)`);
      return recoveredCount;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Outbox Recovery Error] ${errMsg}`);
      return 0;
    }
  }

  /**
   * Retrieve aggregate statistics for the Outbox pipeline.
   */
  static async getOutboxStats(): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    workerRunning: boolean;
  }> {
    try {
      const stats = await orm
        .select({
          status: outboxEvents.status,
          count: sql<number>`count(*)::int`
        })
        .from(outboxEvents)
        .groupBy(outboxEvents.status);

      const statusMap: Record<string, number> = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      };

      let total = 0;
      for (const row of stats) {
        if (row.status) {
          statusMap[row.status] = Number(row.count) || 0;
          total += Number(row.count) || 0;
        }
      }

      return {
        total,
        pending: statusMap.pending || 0,
        processing: statusMap.processing || 0,
        completed: statusMap.completed || 0,
        failed: statusMap.failed || 0,
        workerRunning: this.isWorkerRunning
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Transactional Outbox Stats Error] ${errMsg}`);
      return {
        total: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        workerRunning: this.isWorkerRunning
      };
    }
  }

  /**
   * Query outbox events with pagination and filters.
   */
  static async getOutboxEvents(filters: OutboxQueryFilters = {}): Promise<{
    events: (typeof outboxEvents.$inferSelect)[];
    total: number;
    page: number;
    limit: number;
  }> {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    let query = orm.select().from(outboxEvents);

    const conditions: (SQL | undefined)[] = [];
    if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(outboxEvents.status, filters.status));
    }
    if (filters.eventType) {
      conditions.push(eq(outboxEvents.eventType, filters.eventType));
    }
    if (filters.aggregateType) {
      conditions.push(eq(outboxEvents.aggregateType, filters.aggregateType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [events, countResult] = await Promise.all([
      orm
        .select()
        .from(outboxEvents)
        .where(whereClause)
        .orderBy(desc(outboxEvents.id))
        .limit(limit)
        .offset(offset),
      orm
        .select({ count: sql<number>`count(*)::int` })
        .from(outboxEvents)
        .where(whereClause)
    ]);

    const total = countResult[0]?.count || 0;

    return {
      events,
      total,
      page: Math.floor(offset / limit) + 1,
      limit
    };
  }

  /**
   * Reset a failed event for immediate retry.
   */
  static async retryFailedEvent(eventId: string): Promise<boolean> {
    const result = await orm
      .update(outboxEvents)
      .set({
        status: 'pending',
        retryCount: 0,
        nextRetryAt: null,
        lastError: null
      })
      .where(eq(outboxEvents.eventId, eventId));

    return true;
  }

  /**
   * Reset all failed events for batch retry.
   */
  static async retryAllFailedEvents(): Promise<number> {
    const result = await orm
      .update(outboxEvents)
      .set({
        status: 'pending',
        retryCount: 0,
        nextRetryAt: null,
        lastError: null
      })
      .where(eq(outboxEvents.status, 'failed'));

    return 1;
  }
}
