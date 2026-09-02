import { EventEmitter } from 'events';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { DocumentService } from '../document.service.js';
import { ItemOpeningService } from '../inventory/itemOpening.service.js';
import { BankAccountService } from '../accounting/treasury/bankAccount.service.js';

export interface WorkflowTransitionEventPayload {
  instanceId: number;
  entityType: string;
  entityId: string;
  workflowCode: string;
  fromStateId: number | null;
  fromStateKey: string;
  toStateId: number;
  toStateKey: string;
  actionKey: string;
  actionTitle: string;
  autoActionKey?: string;
  performedBy?: number;
  performedByName?: string;
  comment?: string;
  snapshotData?: Record<string, any>;
}

class WorkflowEventBusEmitter extends EventEmitter {}

export const workflowEventBus = new WorkflowEventBusEmitter();

/**
 * Register core listeners for Workflow events
 */
export function registerWorkflowListeners() {
  logger.info('[WorkflowEventBus] Initializing Workflow Event Bus listeners...');

  // 1. Audit Logger Listener
  workflowEventBus.on('TRANSITION_COMPLETED', async (payload: WorkflowTransitionEventPayload) => {
    try {
      await logActivity({
        userId: payload.performedBy || 0,
        username: payload.performedByName || 'سیستم ورکفلو',
        action: 'UPDATE',
        entity: `ورکفلو (${payload.entityType})`,
        entityId: payload.entityId,
        description: `تغییر وضعیت ورکفلو (${payload.workflowCode}) بر روی ${payload.entityType} شماره ${payload.entityId} از ${payload.fromStateKey} به ${payload.toStateKey}`,
        details: {
          before: { state: payload.fromStateKey },
          after: { state: payload.toStateKey, action: payload.actionKey, comment: payload.comment },
          changes: { instanceId: payload.instanceId, entityId: payload.entityId }
        }
      });
    } catch (err: any) {
      logger.error(`[WorkflowEventBus Audit] Error: ${err.message}`);
    }
  });

  // 2. Bridge to Unified Domain Event Bus (Phase 11 - Event Architecture)
  workflowEventBus.on('TRANSITION_COMPLETED', async (payload: WorkflowTransitionEventPayload) => {
    try {
      const isCompleted = payload.toStateKey === 'approved' || payload.toStateKey === 'final' || payload.toStateKey === 'completed';
      const isRejected = payload.toStateKey === 'rejected' || payload.toStateKey === 'canceled';

      await domainEventBus.publishEvent(
        DomainEventType.WORKFLOW_TRANSITIONED,
        'Workflow',
        String(payload.instanceId),
        {
          instanceId: payload.instanceId,
          workflowCode: payload.workflowCode,
          entityType: payload.entityType,
          entityId: payload.entityId,
          fromStateKey: payload.fromStateKey,
          toStateKey: payload.toStateKey,
          actionKey: payload.actionKey,
          actionTitle: payload.actionTitle,
          isCompleted,
          isRejected,
          comment: payload.comment
        },
        {
          userId: payload.performedBy,
          userName: payload.performedByName
        }
      );

      if (isCompleted) {
        await domainEventBus.publishEvent(
          DomainEventType.WORKFLOW_COMPLETED,
          'Workflow',
          String(payload.instanceId),
          {
            instanceId: payload.instanceId,
            workflowCode: payload.workflowCode,
            entityType: payload.entityType,
            entityId: payload.entityId,
            finalState: payload.toStateKey
          },
          { userId: payload.performedBy, userName: payload.performedByName }
        );
      } else if (isRejected) {
        await domainEventBus.publishEvent(
          DomainEventType.WORKFLOW_REJECTED,
          'Workflow',
          String(payload.instanceId),
          {
            instanceId: payload.instanceId,
            workflowCode: payload.workflowCode,
            entityType: payload.entityType,
            entityId: payload.entityId,
            finalState: payload.toStateKey,
            comment: payload.comment
          },
          { userId: payload.performedBy, userName: payload.performedByName }
        );
      }
    } catch (err: any) {
      logger.error(`[WorkflowEventBus Domain Bridge Error] ${err.message}`);
    }
  });

  // 3. Notification Listener
  workflowEventBus.on('TRANSITION_COMPLETED', async (payload: WorkflowTransitionEventPayload) => {
    try {
      logger.info(`[WorkflowEventBus Notification] Transition completed for entity ${payload.entityType}:${payload.entityId} -> ${payload.toStateKey}`);
    } catch (err: any) {
      logger.error(`[WorkflowEventBus Notification] Error: ${err.message}`);
    }
  });

  // 4. Domain Action Listeners (Inventory / Document Finalization / Accounting)
  workflowEventBus.on('TRANSITION_COMPLETED', async (payload: WorkflowTransitionEventPayload) => {
    try {
      const isApprovedDocument = payload.entityType === 'document' && (payload.toStateKey === 'approved' || payload.autoActionKey === 'POST_INVOICE');
      
      if (isApprovedDocument) {
        const docIdNum = Number(payload.entityId);
        if (!isNaN(docIdNum) && docIdNum > 0 && Number.isInteger(docIdNum)) {
          logger.info(`[WorkflowEventBus AutoAction] Finalizing document #${payload.entityId} and applying warehouse inventory movement...`);
          await DocumentService.finalizeDocument(docIdNum, payload.performedByName || 'تایید خودکار گردش‌کار');
          logger.info(`[WorkflowEventBus AutoAction] Document #${payload.entityId} successfully finalized.`);
        } else {
          logger.info(`[WorkflowEventBus AutoAction] Skipping document finalization for non-numeric/mock entity ID: ${payload.entityId}`);
        }
      } else if (payload.entityType === 'item' && payload.toStateKey === 'approved') {
        // V2.0.0: تأیید نهایی workflow تعریف کالا → صدور سند افتتاحیه موجودی اولیه
        const itemId = Number(payload.entityId);
        if (!isNaN(itemId) && itemId > 0) {
          logger.info(`[WorkflowEventBus AutoAction] Issuing item opening voucher for approved item #${payload.entityId}...`);
          await ItemOpeningService.issueItemOpeningVoucher(itemId, {
            userId: payload.performedBy || undefined,
            username: payload.performedByName || 'تایید خودکار گردش‌کار'
          });
          logger.info(`[WorkflowEventBus AutoAction] Item opening voucher for #${payload.entityId} issued.`);
        }
      } else if (payload.entityType === 'bank_account' && payload.toStateKey === 'approved') {
        // V2.0.0: تأیید نهایی workflow حساب خزانه → صدور سند افتتاحیه موجودی اولیه
        const bankId = Number(payload.entityId);
        if (!isNaN(bankId) && bankId > 0) {
          logger.info(`[WorkflowEventBus AutoAction] Issuing treasury opening voucher for approved bank account #${payload.entityId}...`);
          await BankAccountService.issueTreasuryOpeningVoucher(bankId, {
            userId: payload.performedBy || undefined,
            username: payload.performedByName || 'تایید خودکار گردش‌کار'
          });
          logger.info(`[WorkflowEventBus AutoAction] Treasury opening voucher for #${payload.entityId} issued.`);
        }
      } else if (payload.autoActionKey) {
        logger.info(`[WorkflowEventBus AutoAction] Executing auto action '${payload.autoActionKey}' for ${payload.entityType}:${payload.entityId}`);
      }
    } catch (err: any) {
      logger.error(`[WorkflowEventBus AutoAction] Error: ${err.message}`);
    }
  });
}

