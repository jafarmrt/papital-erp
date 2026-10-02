import type {
  InventoryReorderAlertPayload,
  InvoiceEventPayload,
  PurchaseEventPayload,
  StockMovementEventPayload,
  TreasuryEventPayload,
  WorkflowEventPayload,
} from '../services/events/domainEvents';

/**
 * v7.0.90 (TD-085 بند ۳): فهرست فیلدهای هر رویداد دامنه برای ویرایشگر قوانین رویداد (RuleEditorModal)، تا کاربر
 * فیلد شرط و متغیر متن را انتخاب کند و `payload.x` را حدس نزند. برچسب‌ها با نوع payload هم‌گام‌اند
 * (Record<keyof Payload, string>): کلید تازه در payload بدون برچسب، typecheck را می‌شکند.
 */
export interface EventFieldOption {
  /** مسیر در رویداد، مثل payload.totalAmount */
  path: string;
  label: string;
}

const INVOICE_LABELS: Record<keyof InvoiceEventPayload, string> = {
  documentId: 'شناسه سند',
  refNumber: 'شماره فاکتور',
  docType: 'نوع سند',
  buyerName: 'نام خریدار',
  totalAmount: 'مبلغ کل',
  currency: 'ارز',
  itemCount: 'تعداد اقلام',
  status: 'وضعیت سند',
};

const PURCHASE_LABELS: Record<keyof PurchaseEventPayload, string> = {
  documentId: 'شناسه سند',
  refNumber: 'شماره فاکتور خرید',
  supplierName: 'نام تامین‌کننده',
  totalAmount: 'مبلغ کل',
  currency: 'ارز',
  itemCount: 'تعداد اقلام',
  status: 'وضعیت سند',
};

const STOCK_LABELS: Record<keyof StockMovementEventPayload, string> = {
  itemId: 'شناسه کالا',
  itemCode: 'کد کالا',
  itemName: 'نام کالا',
  movementType: 'نوع گردش',
  quantity: 'مقدار',
  unitPrice: 'بهای واحد',
  warehouseLocation: 'انبار',
  previousStock: 'موجودی قبلی',
  newStock: 'موجودی جدید',
  referenceDocType: 'نوع سند مرجع',
  referenceDocNumber: 'شماره سند مرجع',
};

const TREASURY_LABELS: Record<keyof TreasuryEventPayload, string> = {
  transactionId: 'شناسه تراکنش',
  chequeId: 'شناسه چک',
  type: 'نوع تراکنش',
  amount: 'مبلغ',
  currency: 'ارز',
  accountId: 'شناسه حساب',
  accountName: 'نام حساب',
  description: 'شرح',
  sayadNumber: 'شماره صیادی',
};

const WORKFLOW_LABELS: Record<keyof WorkflowEventPayload, string> = {
  instanceId: 'شناسه فرایند',
  workflowCode: 'کد ورکفلو',
  entityType: 'نوع رکورد',
  entityId: 'شناسه رکورد',
  fromStateKey: 'کلید مرحله قبلی',
  toStateKey: 'کلید مرحله جدید',
  actionKey: 'کلید اقدام',
  actionTitle: 'عنوان اقدام',
  approvalRuleType: 'نوع قاعده تایید',
  collectedSignatures: 'امضاهای ثبت‌شده',
  requiredThreshold: 'امضاهای لازم',
  isCompleted: 'پایان یافته',
  isRejected: 'رد شده',
  comment: 'توضیح اقدام',
};

const REORDER_LABELS: Record<keyof InventoryReorderAlertPayload, string> = {
  itemId: 'شناسه کالا',
  itemCode: 'کد کالا',
  itemName: 'نام کالا',
  currentStock: 'موجودی فعلی',
  reorderPoint: 'نقطه سفارش',
  warehouseLocation: 'انبار',
  alertMessage: 'متن هشدار',
};

const PAYLOAD_LABELS_BY_EVENT: Record<string, Record<string, string>> = {
  InvoiceCreated: INVOICE_LABELS,
  InvoiceApproved: INVOICE_LABELS,
  InvoiceCancelled: INVOICE_LABELS,
  PurchaseCreated: PURCHASE_LABELS,
  PurchaseApproved: PURCHASE_LABELS,
  PurchaseReceived: PURCHASE_LABELS,
  StockReceived: STOCK_LABELS,
  StockIssued: STOCK_LABELS,
  StockTransferred: STOCK_LABELS,
  StockAdjusted: STOCK_LABELS,
  ItemStockModified: STOCK_LABELS,
  InventoryReorderAlert: REORDER_LABELS,
  PaymentApproved: TREASURY_LABELS,
  TreasuryTransactionApproved: TREASURY_LABELS,
  ChequeStatusChanged: TREASURY_LABELS,
  WorkflowTransitioned: WORKFLOW_LABELS,
  WorkflowApprovalProgress: WORKFLOW_LABELS,
  WorkflowCompleted: WORKFLOW_LABELS,
  WorkflowRejected: WORKFLOW_LABELS,
};

/** فیلدهای پوشش رویداد که در همه رویدادها هست */
export const COMMON_EVENT_FIELDS: EventFieldOption[] = [
  { path: 'eventType', label: 'نوع رویداد' },
  { path: 'aggregateType', label: 'نوع رکورد' },
  { path: 'aggregateId', label: 'شناسه رکورد' },
  { path: 'metadata.userName', label: 'کاربر انجام‌دهنده' },
];

/** فیلدهای payload رویداد (برای رویداد ناشناخته یا «*» خالی) و سپس فیلدهای مشترک */
export function eventFieldOptions(eventType: string): EventFieldOption[] {
  const labels = PAYLOAD_LABELS_BY_EVENT[eventType] ?? {};
  const payloadFields = Object.entries(labels).map(([key, label]) => ({ path: `payload.${key}`, label }));
  return [...payloadFields, ...COMMON_EVENT_FIELDS];
}
