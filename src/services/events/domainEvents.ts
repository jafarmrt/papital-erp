/**
 * Standard Domain Events Definition (Phase 11 - Event Architecture)
 * Enterprise ERP Domain Event Specifications
 */

import { getRequestContext } from '../../lib/requestContext.js';

export enum DomainEventType {
  // 1. Invoices & Sales
  INVOICE_CREATED = 'InvoiceCreated',
  INVOICE_APPROVED = 'InvoiceApproved',
  INVOICE_CANCELLED = 'InvoiceCancelled',
  // v10.0.229 (TD-931): ابطال فاکتور یا پیش‌فاکتور فروش
  INVOICE_VOIDED = 'InvoiceVoided',

  // 2. Purchases & Procurement
  PURCHASE_CREATED = 'PurchaseCreated',
  PURCHASE_APPROVED = 'PurchaseApproved',
  PURCHASE_RECEIVED = 'PurchaseReceived',

  // 3. Inventory & Warehousing
  STOCK_RECEIVED = 'StockReceived',
  STOCK_ISSUED = 'StockIssued',
  STOCK_TRANSFERRED = 'StockTransferred',
  STOCK_ADJUSTED = 'StockAdjusted',
  INVENTORY_REORDER_ALERT = 'InventoryReorderAlert',

  // 4. Financial & Treasury
  PAYMENT_APPROVED = 'PaymentApproved',
  TREASURY_TRANSACTION_APPROVED = 'TreasuryTransactionApproved',
  CHEQUE_STATUS_CHANGED = 'ChequeStatusChanged',
  // OBS-R2-13 (ت۴۰ بند ۱۱): تأیید و پرداخت فیش حقوق
  PAYROLL_APPROVED = 'PayrollApproved',
  PAYROLL_PAID = 'PayrollPaid',
  VOUCHER_POSTED = 'VoucherPosted',

  // 5. Workflow Engine
  WORKFLOW_TRANSITIONED = 'WorkflowTransitioned',
  WORKFLOW_APPROVAL_PROGRESS = 'WorkflowApprovalProgress',
  WORKFLOW_COMPLETED = 'WorkflowCompleted',
  WORKFLOW_REJECTED = 'WorkflowRejected',

  // 6. Production & Projects
  PROJECT_CREATED = 'ProjectCreated',
  PROJECT_STAGE_COMPLETED = 'ProjectStageCompleted',
  PROJECT_COMPLETED = 'ProjectCompleted',

  // 7. Catalog & Pricing
  ITEM_PRICE_UPDATED = 'ItemPriceUpdated',
  ITEM_STOCK_MODIFIED = 'ItemStockModified',

  // 8. CRM & Customers
  CUSTOMER_CREATED = 'CustomerCreated',
  CUSTOMER_UPDATED = 'CustomerUpdated',
}

export interface DomainEventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: number;
  userName?: string;
  userRole?: string;
  ipAddress?: string;
  timestamp: string;
  isSimulation?: boolean;
  idempotencyKey?: string;
  replayedAt?: string;
  /** OBS-R2-16: trace id of the request that recorded the event (`activity_logs.trace_id` of its audit rows) */
  requestId?: string;
  [key: string]: unknown;
}

export type AggregateType = 'Document' | 'Item' | 'Workflow' | 'Treasury' | 'Cheque' | 'Payroll' | 'Project' | 'Customer' | 'Voucher' | 'WooCommerce';

export interface BaseDomainEvent<T = unknown> {
  eventId: string;
  eventType: DomainEventType | string;
  aggregateType: AggregateType;
  aggregateId: string;
  payload: T;
  metadata: DomainEventMetadata;
  occurredAt: string;
}

// -------------------------------------------------------------
// Typed Domain Event Payloads
// -------------------------------------------------------------

/**
 * v9.0.407 (TD-713, B15-11): the amounts of a sales or purchase document event, read from the stored document in the
 * transaction that records the event (`documentEventAmounts`): totalAmount is the payable amount in the document's own
 * currency (net of active lines + VAT + service charge, AGENTS §6), totalAmountIrr the same in rials at the document's
 * rate (null for a foreign document without any rate). The invoice event used to carry no amount at all.
 */
export interface DocumentEventAmounts {
  totalAmount: number;
  netAmount: number;
  vatAmount: number;
  serviceChargeAmount: number;
  totalAmountIrr: number | null;
}

export interface InvoiceEventPayload extends DocumentEventAmounts {
  documentId: number;
  refNumber: string;
  docType: 'invoice' | 'proforma';
  buyerName?: string;
  currency: string;
  itemCount: number;
  status: string;
}

export interface PurchaseEventPayload extends DocumentEventAmounts {
  documentId: number;
  refNumber: string;
  supplierName?: string;
  currency: string;
  itemCount: number;
  status: string;
}

export interface StockMovementEventPayload {
  itemId: number;
  itemCode: string;
  itemName: string;
  movementType: 'in' | 'out' | 'transfer' | 'audit' | 'adjust';
  quantity: number;
  unitPrice?: number;
  warehouseLocation: string;
  previousStock: number;
  newStock: number;
  referenceDocType?: string;
  referenceDocNumber?: string;
}

export interface TreasuryEventPayload {
  transactionId?: number;
  chequeId?: number;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'cheque_pass' | 'cheque_return';
  amount: number;
  currency: string;
  accountId?: number;
  accountName?: string;
  description?: string;
  sayadNumber?: string;
}

/** OBS-R2-13 (ت۴۰ بند ۱۱): a cheque's status change, recorded in the transaction of the change (`ChequeStatusChanged`) */
export interface ChequeEventPayload {
  chequeId: number;
  chequeNumber: string;
  sayadNumber: string;
  chequeType: 'received' | 'paid';
  previousStatus: string;
  newStatus: string;
  newStatusLabel: string;
  amount: number;
  currency: string;
  dueDate: string;
  actionDate: string;
  bankAccountId: number | null;
  partyType: string;
  partyId: number | null;
  partyName: string;
  voucherIds: number[];
}

/**
 * OBS-R2-13 (ت۴۰ بند ۱۱): a payslip approved (`PayrollApproved`) or paid in full or in part (`PayrollPaid`, one event per
 * payment), recorded in the transaction of the approval or the payment; amounts are in rials.
 */
/**
 * v10.1.62 (OBS-R2-13): a payslip event carries no name and no amount: every «*» webhook, the event screens and the audit
 * log read it, while payslip amounts are for payroll readers only; a subscriber reads the payslip through the API with
 * its own access.
 */
export interface PayrollEventPayload {
  payrollId: number;
  payrollNumber: string;
  personnelId: number;
  startDate: string;
  endDate: string;
  status: string;
  transactionId?: number;
  isFullyPaid?: boolean;
}

export interface WorkflowEventPayload {
  instanceId: number;
  workflowCode: string;
  entityType: string;
  entityId: string;
  fromStateKey: string;
  toStateKey: string;
  actionKey: string;
  actionTitle: string;
  approvalRuleType?: string;
  collectedSignatures?: number;
  requiredThreshold?: number;
  isCompleted?: boolean;
  isRejected?: boolean;
  /** OBS-R2-68: how the step ended; a canceled end is `WorkflowCompleted` with `canceled` */
  outcome?: 'approved' | 'rejected' | 'canceled';
  comment?: string;
}

export interface ProjectStageEventPayload {
  projectId: number;
  projectCode: string;
  projectName: string;
  stageId: number;
  stageName: string;
  stageOrder: number;
  completedQuantity?: number;
}

export interface ItemPriceEventPayload {
  itemId: number;
  itemCode: string;
  itemName: string;
  priceLevel: string;
  oldPrice?: number;
  newPrice: number;
  currency: string;
}

export interface InventoryReorderAlertPayload {
  itemId: number;
  itemCode: string;
  itemName: string;
  currentStock: number;
  /** v10.0.43 (TD-937): موجودی کل منهای رزروها، همان سنجه صفحه هشدار نقطه سفارش */
  freeStock: number;
  reorderPoint: number;
  warehouseLocation: string;
  alertMessage: string;
}

// -------------------------------------------------------------
// Helper Factory & Validation for Domain Event Contract (Subphase 8.1)
// -------------------------------------------------------------

export function validateDomainEvent(event: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['رویداد غیرمعتبر یا خالی است (Event is empty or null)'] };
  }

  const rec = event as Record<string, unknown>;

  if (!rec.eventId || typeof rec.eventId !== 'string') {
    errors.push('شناسه رویداد (eventId) الزامی و باید رشته باشد.');
  }

  if (!rec.eventType || typeof rec.eventType !== 'string') {
    errors.push('نوع رویداد (eventType) الزامی و باید رشته باشد.');
  }

  if (!rec.aggregateType || typeof rec.aggregateType !== 'string') {
    errors.push('نوع موجودیت (aggregateType) الزامی و باید رشته باشد.');
  }

  if (rec.aggregateId === undefined || rec.aggregateId === null || typeof String(rec.aggregateId) !== 'string') {
    errors.push('شناسه موجودیت (aggregateId) الزامی است.');
  }

  if (!rec.occurredAt || typeof rec.occurredAt !== 'string' || isNaN(Date.parse(rec.occurredAt))) {
    errors.push('زمان وقوع رویداد (occurredAt) باید فرمت ایزو معتبر داشته باشد.');
  }

  const metadata = rec.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object') {
    errors.push('متاداده رویداد (metadata) الزامی است.');
  } else if (!metadata.timestamp || typeof metadata.timestamp !== 'string') {
    errors.push('برچسب زمانی در متاداده (metadata.timestamp) الزامی است.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function createDomainEvent<T = unknown>(params: {
  eventType: DomainEventType | string;
  aggregateType: BaseDomainEvent['aggregateType'];
  aggregateId: string | number;
  payload: T;
  metadata?: Partial<DomainEventMetadata>;
  eventId?: string;
  occurredAt?: string;
}): BaseDomainEvent<T> {
  const now = params.occurredAt || new Date().toISOString();
  const eventId = params.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  // OBS-R2-16: an event recorded during a request carries that request's trace and correlation ids, so its background
  // handlers (outbox worker, delivery jobs) and the audit rows they write can be found from the request
  const origin = getRequestContext();

  const event: BaseDomainEvent<T> = {
    eventId,
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: String(params.aggregateId),
    payload: params.payload,
    metadata: {
      timestamp: now,
      userName: params.metadata?.userName || 'سیستم ERP',
      correlationId: params.metadata?.correlationId || origin?.correlationId || eventId,
      ...(origin?.requestId ? { requestId: origin.requestId } : {}),
      ...params.metadata
    },
    occurredAt: now
  };

  const validation = validateDomainEvent(event);
  if (!validation.valid) {
    throw new Error(`قرارداد رویداد دامنه نامعتبر است: ${validation.errors.join(' | ')}`);
  }

  return event;
}
