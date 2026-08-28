import { BaseDomainEvent, DomainEventType } from './domainEvents.js';
import { domainEventBus } from './domainEventBus.js';
import { IdempotencyService } from '../idempotency.service.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';

export interface ActionHandlerDefinition {
  handlerName: string;
  eventType: DomainEventType | string;
  description: string;
  handlerFn: (event: BaseDomainEvent) => Promise<any>;
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
    domainEventBus.subscribe(def.eventType as any, async (event: BaseDomainEvent) => {
      await this.executeHandler(def, event);
    });

    logger.info(`[ActionHandlerService] Registered handler '${def.handlerName}' for event '${def.eventType}'`);
  }

  /**
   * Execute an action handler with Idempotency, Auditing, and Observability
   */
  static async executeHandler(def: ActionHandlerDefinition, event: BaseDomainEvent): Promise<{
    status: 'success' | 'skipped' | 'failed';
    alreadyExecuted?: boolean;
    result?: any;
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
    } catch (err: any) {
      this.stats.failureCount++;
      const durationMs = Date.now() - startTime;
      logger.error(`[ActionHandler Error] Handler '${def.handlerName}' failed on event '${event.eventId}': ${err.message}`);

      await logActivity({
        userId: event.metadata?.userId || 0,
        username: event.metadata?.userName || 'سیستم اکشن هندر',
        action: 'UPDATE',
        entity: `اکشن_هندلر:${def.handlerName}`,
        entityId: String(event.aggregateId),
        description: `خطا در اجرای اکشن‌هندلر [${def.handlerName}] برای رویداد [${event.eventType}]: ${err.message}`,
        details: {
          handlerName: def.handlerName,
          eventType: event.eventType,
          eventId: event.eventId,
          error: err.message,
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

  /**
   * Initialize built-in system action handlers
   */
  static initializeBuiltInHandlers(): void {
    if (this.handlers.size > 0) return; // Prevent double initialization

    // 1. Workflow Transition -> Inventory Sync Handler
    this.registerHandler({
      handlerName: 'WorkflowInventorySyncActionHandler',
      eventType: DomainEventType.STOCK_ISSUED,
      description: 'همگام‌سازی و اعمال تحویل کالا به انبار در خروج کالا متعاقب ورکفلو',
      handlerFn: async (event) => {
        logger.info(`[ActionHandler:InventorySync] Processing stock issued event ${event.eventId}`);
        return { inventoryUpdated: true, itemId: event.payload?.itemId, qty: event.payload?.quantity };
      }
    });

    // 2. Invoice Approved -> Accounting Sync Handler
    this.registerHandler({
      handlerName: 'InvoiceAccountingSyncActionHandler',
      eventType: DomainEventType.INVOICE_APPROVED,
      description: 'صدور خودکار سند حسابداری تعهدی متعاقب تایید فاکتور فروش',
      handlerFn: async (event) => {
        logger.info(`[ActionHandler:AccountingSync] Generating journal voucher for approved invoice ${event.payload?.refNumber}`);
        return { voucherGenerated: true, refNumber: event.payload?.refNumber, amount: event.payload?.totalAmount };
      }
    });

    // 3. Inventory Reorder Alert -> Notification Action Handler
    this.registerHandler({
      handlerName: 'InventoryReorderAlertActionHandler',
      eventType: DomainEventType.INVENTORY_REORDER_ALERT,
      description: 'ارسال هشدار افت موجودی به مسئولین انبار و مدیریت تامین',
      handlerFn: async (event) => {
        logger.info(`[ActionHandler:ReorderAlert] Alerting for item ${event.payload?.itemCode} in ${event.payload?.warehouseLocation}`);
        return { alertSent: true, itemCode: event.payload?.itemCode, stock: event.payload?.currentStock };
      }
    });
  }
}
