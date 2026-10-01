import { domainEventBus } from './domainEventBus.js';
import { 
  DomainEventType, 
  BaseDomainEvent, 
  InvoiceEventPayload, 
  PurchaseEventPayload, 
  StockMovementEventPayload, 
  WorkflowEventPayload,
  TreasuryEventPayload 
} from './domainEvents.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { EventActionEngineService } from './eventActionEngineService.js';
import { WebhookSubscriptionService } from './webhookSubscriptionService.js';
import { ActionHandlerService } from './actionHandlerService.js';

/**
 * Register core system listeners for enterprise domain events
 */
export function registerDomainEventHandlers(): void {
  logger.info('[DomainEventHandlers] Registering domain event subscribers...');

  // v7.0.25 (TD-183 / audit P1-1): هر هندلر نام پایدار دارد و خطا را (پس از لاگ) دوباره پرتاب می‌کند تا
  // Outbox بتواند شکست را تشخیص داده و فقط همان هندلر را با backoff دوباره اجرا کند. در مسیر `publish`
  // (غیر Outbox) پوشش گذرگاه همچنان خطا را می‌گیرد و فقط لاگ می‌کند (AGENTS.md §15).

  // Initialize Subphase 8.3 Idempotent Action Handlers
  ActionHandlerService.initializeBuiltInHandlers();

  // -------------------------------------------------------------
  // 0. Auto Action & Rule Engine (Phase 13)
  // -------------------------------------------------------------
  domainEventBus.subscribeAll(async (event: BaseDomainEvent) => {
    try {
      await EventActionEngineService.processEvent(event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[EventActionEngine Dispatch Error] ${errMsg}`);
      throw err;
    }
  }, 'event-action-engine');

  // -------------------------------------------------------------
  // 0.1 External Webhook Subscriptions Dispatcher (Phase 14)
  // -------------------------------------------------------------
  domainEventBus.subscribeAll(async (event: BaseDomainEvent) => {
    try {
      await WebhookSubscriptionService.dispatchDomainEventToSubscribers(event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[WebhookSubscription Dispatch Error] ${errMsg}`);
      throw err;
    }
  }, 'webhook-subscriptions');

  // -------------------------------------------------------------
  // 1. Central Audit Trail for all Domain Events
  // -------------------------------------------------------------
  domainEventBus.subscribeAll(async (event: BaseDomainEvent) => {
    try {
      // Avoid logging audit if it's already an internal telemetry ping
      if (event.eventType === DomainEventType.INVENTORY_REORDER_ALERT) return;

      let description = `رویداد دامنه‌ای [${event.eventType}] بر روی ${event.aggregateType} شناسه ${event.aggregateId}`;
      if (event.eventType === DomainEventType.INVOICE_APPROVED) {
        const payload = event.payload as InvoiceEventPayload;
        description = `تایید نهایی فاکتور فروش شماره ${payload.refNumber} به مبلغ ${payload.totalAmount?.toLocaleString('fa-IR')} ${payload.currency}`;
      } else if (event.eventType === DomainEventType.PURCHASE_APPROVED) {
        const payload = event.payload as PurchaseEventPayload;
        description = `تایید فاکتور خرید / ورودی انبار شماره ${payload.refNumber}`;
      } else if (event.eventType === DomainEventType.STOCK_RECEIVED) {
        const payload = event.payload as StockMovementEventPayload;
        description = `ورود کالا [${payload.itemCode} - ${payload.itemName}] به انبار ${payload.warehouseLocation} به مقدار ${payload.quantity} (موجودی جدید: ${payload.newStock})`;
      } else if (event.eventType === DomainEventType.STOCK_ISSUED) {
        const payload = event.payload as StockMovementEventPayload;
        description = `خروج کالا [${payload.itemCode} - ${payload.itemName}] از انبار ${payload.warehouseLocation} به مقدار ${payload.quantity} (موجودی جدید: ${payload.newStock})`;
      } else if (event.eventType === DomainEventType.WORKFLOW_TRANSITIONED) {
        const payload = event.payload as WorkflowEventPayload;
        description = `تغییر وضعیت فرآیند (${payload.workflowCode}) بر روی ${payload.entityType} شماره ${payload.entityId}: ${payload.fromStateKey} ➔ ${payload.toStateKey} [${payload.actionTitle}]`;
      } else if (event.eventType === DomainEventType.TREASURY_TRANSACTION_APPROVED) {
        const payload = event.payload as TreasuryEventPayload;
        description = `تراکنش خزانه‌داری (${payload.type}) به مبلغ ${payload.amount?.toLocaleString('fa-IR')} ${payload.currency} ثبت و تایید شد`;
      }

      await logActivity({
        userId: event.metadata.userId || 0,
        username: event.metadata.userName || 'سیستم دامنه',
        action: 'UPDATE',
        entity: `دامنه:${event.aggregateType}`,
        entityId: event.aggregateId,
        description,
        details: {
          eventType: event.eventType,
          eventId: event.eventId,
          payload: event.payload,
          metadata: event.metadata
        }
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Audit Domain Event] Failed to write audit log: ${errMsg}`);
      throw err;
    }
  }, 'domain-audit-log');

  // -------------------------------------------------------------
  // 2. Stock Issued -> Reorder Threshold & Inventory Integrity Monitor
  // -------------------------------------------------------------
  domainEventBus.subscribe<StockMovementEventPayload>(DomainEventType.STOCK_ISSUED, async (event) => {
    try {
      const { itemId, itemCode, itemName, newStock, warehouseLocation } = event.payload;

      // Check item's minimum stock threshold / reorder point
      const [item] = await orm.select().from(items).where(eq(items.id, itemId));
      const threshold = item?.reorderPoint || 0;
      if (item && threshold > 0 && newStock <= threshold) {
        logger.warn(`[Inventory Alert] Item ${itemCode} (${itemName}) in ${warehouseLocation} dropped to ${newStock} (Reorder Point: ${threshold})`);

        await domainEventBus.publishEvent(
          DomainEventType.INVENTORY_REORDER_ALERT,
          'Item',
          String(itemId),
          {
            itemId,
            itemCode,
            itemName,
            currentStock: newStock,
            reorderPoint: threshold,
            warehouseLocation,
            alertMessage: `موجودی کالای ${itemName} (${itemCode}) به نقطه سفارش مجدد (${threshold}) رسیده است.`
          },
          { correlationId: event.eventId }
        );
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Inventory Reorder Check] Error checking reorderPoint: ${errMsg}`);
      throw err;
    }
  }, 'stock-reorder-monitor');

  // -------------------------------------------------------------
  // 3. Purchase Approved -> Warehouse Notification / Auto Inflow
  // -------------------------------------------------------------
  domainEventBus.subscribe<PurchaseEventPayload>(DomainEventType.PURCHASE_APPROVED, async (event) => {
    try {
      logger.info(`[Purchase Handler] Purchase #${event.payload.refNumber} approved. Total items: ${event.payload.itemCount}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Purchase Handler] Error: ${errMsg}`);
      throw err;
    }
  }, 'purchase-approved-log');

  // -------------------------------------------------------------
  // 4. Invoice Approved -> Order Notification
  // -------------------------------------------------------------
  domainEventBus.subscribe<InvoiceEventPayload>(DomainEventType.INVOICE_APPROVED, async (event) => {
    try {
      logger.info(`[Invoice Handler] Sales invoice #${event.payload.refNumber} approved for buyer: ${event.payload.buyerName}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Invoice Handler] Error: ${errMsg}`);
      throw err;
    }
  }, 'invoice-approved-log');
}
