import { DomainEventType, type BaseDomainEvent } from './domainEvents.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * The sample event a rule is tried against (the rule test and the draft evaluation, v9.0.377 TD-712): one payload that
 * carries the fields of the invoice, stock, treasury and workflow events, under the rule's own event type («*» → invoice).
 */
export function ruleSampleEvent(eventType: string): BaseDomainEvent {
  const now = new Date().toISOString();
  return {
    eventId: `test_evt_${Date.now()}`,
    eventType: eventType === '*' ? DomainEventType.INVOICE_APPROVED : eventType,
    aggregateType: 'Document',
    aggregateId: '101',
    payload: {
      documentId: 101,
      refNumber: 'INV-1405-TEST',
      docType: 'invoice',
      buyerName: 'مشتری آزمایشی سیستم',
      // v9.0.382 (TD-713): the amounts a real invoice event carries
      totalAmount: 150000000,
      netAmount: 137614679,
      vatAmount: 12385321,
      serviceChargeAmount: 0,
      totalAmountIrr: 150000000,
      currency: 'IRR',
      itemCount: 3,
      status: 'final',
      itemId: 5,
      itemCode: 'RAW-001',
      itemName: 'سنگ عقیق سیاه',
      currentStock: 12,
      reorderPoint: 20,
      warehouseLocation: 'انبار مرکزی',
      amount: 600000000,
      workflowCode: 'INVOICE_APPROVAL',
      toStateKey: 'PENDING_APPROVAL'
    },
    metadata: {
      userId: 1,
      userName: 'مدیر تستی',
      userRole: SYSTEM_ADMIN_ROLE,
      correlationId: `corr_${Date.now()}`,
      timestamp: now
    },
    occurredAt: now
  };
}
