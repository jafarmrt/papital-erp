import { BaseDomainEvent, DomainEventType } from './domainEvents.js';
import { domainEventBus } from './domainEventBus.js';
import { IdempotencyService } from '../idempotency.service.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';

export interface ActionHandlerDefinition {
  handlerName: string;
  eventType: DomainEventType | string;
  description: string;
  handlerFn: (event: BaseDomainEvent) => Promise<unknown>;
}

export interface ActionHandlerExecutionStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  skippedIdempotentCount: number;
  registeredHandlersCount: number;
  handlers: Array<{
    handlerName: string;
    eventType: string;
    description: string;
    executionCount: number;
  }>;
}

export class ActionHandlerService {
  private static handlers: Map<string, ActionHandlerDefinition> = new Map();
  private static stats = {
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    skippedIdempotentCount: 0
  };
  private static handlerExecutionCounts: Map<string, number> = new Map();

  /**
   * Register a new idempotent action handler
   */
  static registerHandler(def: ActionHandlerDefinition): void {
    const key = `${def.handlerName}:${def.eventType}`;
    this.handlers.set(key, def);
    if (!this.handlerExecutionCounts.has(def.handlerName)) {
      this.handlerExecutionCounts.set(def.handlerName, 0);
    }

    // Subscribe to domain event bus
    domainEventBus.subscribe(def.eventType, async (event: BaseDomainEvent) => {
      await this.executeHandler(def, event);
    }, `action-handler:${def.handlerName}`);

    logger.info(`[ActionHandlerService] Registered handler '${def.handlerName}' for event '${def.eventType}'`);
  }

  /**
   * Execute an action handler with Idempotency, Auditing, and Observability
   */
  static async executeHandler(def: ActionHandlerDefinition, event: BaseDomainEvent): Promise<{
    status: 'success' | 'skipped' | 'failed';
    alreadyExecuted?: boolean;
    result?: unknown;
    error?: string;
    durationMs: number;
  }> {
    const startTime = Date.now();
    this.stats.totalExecutions++;

    // Idempotency key incorporating handlerName and unique eventId
    const idempotencyKey = `act_hdlr_${def.handlerName}_${event.eventId}`;

    try {
      // 1. Idempotency Acquire Check
      const acq = await IdempotencyService.acquireKey(idempotencyKey, {
        scope: 'action_handler',
        requestMethod: 'EVENT_DISPATCH',
        requestPath: `${def.handlerName}/${event.eventType}`,
        requestPayload: { eventId: event.eventId, aggregateId: event.aggregateId }
      });

      if (acq.state === 'cached') {
        this.stats.skippedIdempotentCount++;
        logger.info(`[ActionHandler] Idempotent skip for handler '${def.handlerName}' on event '${event.eventId}'`);
        return {
          status: 'skipped',
          alreadyExecuted: true,
          result: acq.responseBody,
          durationMs: Date.now() - startTime
        };
      }

      // 2. Execute Handler Business Logic
      const result = await def.handlerFn(event);

      // Increment execution counter
      const currentCount = this.handlerExecutionCounts.get(def.handlerName) || 0;
      this.handlerExecutionCounts.set(def.handlerName, currentCount + 1);

      // 3. Mark Idempotency as completed
      await IdempotencyService.saveResponse(idempotencyKey, 200, {
        handlerName: def.handlerName,
        eventId: event.eventId,
        executedAt: new Date().toISOString(),
        result
      });

      this.stats.successCount++;

      // 4. Audit Trail Entry
      await logActivity({
        userId: event.metadata?.userId || 0,
        username: event.metadata?.userName || 'سیستم اکشن هندر',
        action: 'UPDATE',
        entity: `اکشن_هندلر:${def.handlerName}`,
        entityId: String(event.aggregateId),
        description: `اجرای موفق اکشن‌هندلر [${def.handlerName}] برای رویداد [${event.eventType}]`,
        details: {
          handlerName: def.handlerName,
          eventType: event.eventType,
          eventId: event.eventId,
          durationMs: Date.now() - startTime,
          result
        }
      });

      return {
        status: 'success',
        result,
        durationMs: Date.now() - startTime
      };
    } catch (err: unknown) {
      this.stats.failureCount++;
      const durationMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[ActionHandler Error] Handler '${def.handlerName}' failed on event '${event.eventId}': ${errMsg}`);

      await logActivity({
        userId: event.metadata?.userId || 0,
        username: event.metadata?.userName || 'سیستم اکشن هندر',
        action: 'UPDATE',
        entity: `اکشن_هندلر:${def.handlerName}`,
        entityId: String(event.aggregateId),
        description: `خطا در اجرای اکشن‌هندلر [${def.handlerName}] برای رویداد [${event.eventType}]: ${errMsg}`,
        details: {
          handlerName: def.handlerName,
          eventType: event.eventType,
          eventId: event.eventId,
          error: errMsg,
          durationMs
        }
      });

      throw err;
    }
  }

  /**
   * Retrieve stats and registered handler telemetry (Observability)
   */
  static getActionHandlerStats(): ActionHandlerExecutionStats {
    const handlersList = Array.from(this.handlers.values()).map(h => ({
      handlerName: h.handlerName,
      eventType: String(h.eventType),
      description: h.description,
      executionCount: this.handlerExecutionCounts.get(h.handlerName) || 0
    }));

    return {
      totalExecutions: this.stats.totalExecutions,
      successCount: this.stats.successCount,
      failureCount: this.stats.failureCount,
      skippedIdempotentCount: this.stats.skippedIdempotentCount,
      registeredHandlersCount: this.handlers.size,
      handlers: handlersList
    };
  }

  // v9.0.363 (TD-714، B15-12، تصمیم ت۴ الف): سه handler نمایشی (همگام‌سازی انبار، سند حسابداری فاکتور، هشدار کسری) حذف شدند؛
  // کاری جز لاگ نمی‌کردند ولی ممیزی «اجرای موفق» با `voucherGenerated: true` و برای هر رویداد ردیف idempotency می‌نوشتند.
  // سند حسابداری را VoucherSync در تراکنش خود سند صادر می‌کند و هشدار کسری را قانون اعلان موتور اقدام‌ها می‌فرستد.
}
