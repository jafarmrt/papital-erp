import { workflowEventBus } from './workflowEventBus.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { WorkflowEventPayload } from './contracts/workflowDomainContracts.js';
import { logger } from '../../middleware/logger.js';

export class WorkflowEventPublisher {
  /**
   * Publish workflow transition completed event to both local bus and domain event bus
   */
  static async publishTransitionCompleted(payload: WorkflowEventPayload): Promise<void> {
    try {
      // 1. Local Workflow Event Bus dispatch
      workflowEventBus.emit('TRANSITION_COMPLETED', payload);

      // 2. Central Domain Event Bus dispatch
      const event = domainEventBus.createEvent(
        DomainEventType.WORKFLOW_TRANSITIONED,
        (payload.entityType as any) || 'workflow_instance',
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: any) {
      logger.warn(`[WorkflowEventPublisher] Failed to publish transition event: ${err.message}`);
    }
  }

  /**
   * Publish workflow completed event
   */
  static async publishWorkflowCompleted(payload: WorkflowEventPayload): Promise<void> {
    try {
      workflowEventBus.emit('WORKFLOW_COMPLETED', payload);

      const event = domainEventBus.createEvent(
        'WORKFLOW_COMPLETED',
        (payload.entityType as any) || 'workflow_instance',
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: any) {
      logger.warn(`[WorkflowEventPublisher] Failed to publish workflow completed event: ${err.message}`);
    }
  }

  /**
   * Publish workflow rejected event
   */
  static async publishWorkflowRejected(payload: WorkflowEventPayload): Promise<void> {
    try {
      workflowEventBus.emit('WORKFLOW_REJECTED', payload);

      const event = domainEventBus.createEvent(
        'WORKFLOW_REJECTED',
        (payload.entityType as any) || 'workflow_instance',
        String(payload.entityId || payload.instanceId),
        payload,
        { userId: payload.performedBy, username: payload.performedByName }
      );
      await domainEventBus.publish(event);
    } catch (err: any) {
      logger.warn(`[WorkflowEventPublisher] Failed to publish workflow rejected event: ${err.message}`);
    }
  }
}
