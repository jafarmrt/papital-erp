/**
 * Standard Domain Events Definition (Phase 11 - Event Architecture)
 * Enterprise ERP Domain Event Specifications
 */

export enum DomainEventType {
  // 1. Invoices & Sales
  INVOICE_CREATED = 'InvoiceCreated',
  INVOICE_APPROVED = 'InvoiceApproved',
  INVOICE_CANCELLED = 'InvoiceCancelled',

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
  [key: string]: unknown;
}

export type AggregateType = 'Document' | 'Item' | 'Workflow' | 'Treasury' | 'Project' | 'Customer' | 'Voucher' | 'WooCommerce';

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

export interface InvoiceEventPayload {
  documentId: number;
  refNumber: string;
  docType: 'invoice' | 'proforma';
  buyerName?: string;
  totalAmount?: number;
  currency: string;
  itemCount: number;
  status: string;
}

export interface PurchaseEventPayload {
  documentId: number;
  refNumber: string;
  supplierName?: string;
  totalAmount?: number;
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

  const event: BaseDomainEvent<T> = {
    eventId,
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: String(params.aggregateId),
    payload: params.payload,
    metadata: {
      timestamp: now,
      userName: params.metadata?.userName || 'سیستم ERP',
      correlationId: params.metadata?.correlationId || eventId,
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
