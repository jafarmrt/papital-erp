import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, AggregateType } from '../events/domainEvents.js';
import { WorkflowEventPayload } from './contracts/workflowDomainContracts.js';
import { logger } from '../../middleware/logger.js';

function toAggregateType(entityType?: string): AggregateType {
  const normalized = (entityType || '').toLowerCase();
  switch (normalized) {
    case 'document':
    case 'invoice':
    case 'proforma':
      return 'Document';
    case 'item':
      return 'Item';
    case 'treasury':
    case 'cheque':
    case 'bank_account':
      return 'Treasury';
    case 'project':
      return 'Project';
    case 'customer':
      return 'Customer';
    case 'voucher':
    case 'journal_voucher':
      return 'Voucher';
    case 'woocommerce':
      return 'WooCommerce';
    default:
      return 'Workflow';
  }
}

export class WorkflowEventPublisher {
  /**
   * Publish workflow transition completed event to the domain event bus
   */
  static async publishTransitionCompleted(payload: WorkflowEventPayload): Promise<void> {
    try {
      // v9.0.2 (TD-415): گذرگاه درون‌فرایندی workflowEventBus و شنونده‌هایش حذف شد
      const event = domainEventBus.createEvent(
        DomainEventType.WORKFLOW_TRANSITIONED,
        toAggregateType(payload.entityType),
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WorkflowEventPublisher] Failed to publish transition event: ${errMsg}`);
    }
  }

  /**
   * Publish workflow completed event
   */
  static async publishWorkflowCompleted(payload: WorkflowEventPayload): Promise<void> {
    try {
      const event = domainEventBus.createEvent(
        DomainEventType.WORKFLOW_COMPLETED,
        toAggregateType(payload.entityType),
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WorkflowEventPublisher] Failed to publish workflow completed event: ${errMsg}`);
    }
  }

  /**
   * Publish workflow rejected event
   */
  static async publishWorkflowRejected(payload: WorkflowEventPayload): Promise<void> {
    try {
      const event = domainEventBus.createEvent(
        DomainEventType.WORKFLOW_REJECTED,
        toAggregateType(payload.entityType),
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WorkflowEventPublisher] Failed to publish workflow rejected event: ${errMsg}`);
    }
  }
}
