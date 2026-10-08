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
  totalAmount: 'مبلغ قابل پرداخت',
  netAmount: 'خالص اقلام',
  vatAmount: 'مالیات بر ارزش افزوده',
  serviceChargeAmount: 'هزینه ارسال و خدمات',
  totalAmountIrr: 'مبلغ قابل پرداخت به ریال',
  currency: 'ارز',
  itemCount: 'تعداد اقلام',
  status: 'وضعیت سند',
};

const PURCHASE_LABELS: Record<keyof PurchaseEventPayload, string> = {
  documentId: 'شناسه سند',
  refNumber: 'شماره فاکتور خرید',
  supplierName: 'نام تامین‌کننده',
  totalAmount: 'مبلغ قابل پرداخت',
  netAmount: 'خالص اقلام',
  vatAmount: 'مالیات بر ارزش افزوده',
  serviceChargeAmount: 'هزینه ارسال و خدمات',
  totalAmountIrr: 'مبلغ قابل پرداخت به ریال',
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
  workflowCode: 'کد گردش کار',
  entityType: 'نوع موجودیت',
  entityId: 'شناسه موجودیت',
  fromStateKey: 'کلید مرحله قبلی',
  toStateKey: 'کلید مرحله جدید',
  actionKey: 'کلید اقدام',
  actionTitle: 'عنوان اقدام',
  approvalRuleType: 'نوع قاعده تأیید',
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

// v9.0.407 (TD-713): fields of the WooCommerce order events (wooOrderSync.service.ts)
const WOO_SYNCED_LABELS: Record<string, string> = {
  wcOrderId: 'شماره سفارش ووکامرس',
  docId: 'شناسه فاکتور',
  refNumber: 'شماره فاکتور',
  buyerName: 'نام خریدار',
  totalAmount: 'مبلغ سفارش',
};

const WOO_VOIDED_LABELS: Record<string, string> = {
  wcOrderId: 'شماره سفارش ووکامرس',
  docId: 'شناسه فاکتور',
  refNumber: 'شماره فاکتور',
  wcStatus: 'وضعیت سفارش در ووکامرس',
};

// v9.0.407 (TD-713): one entry per event type the server publishes (PUBLISHED_EVENT_TYPES); types that nothing publishes
// (InvoiceCancelled, PurchaseReceived, ChequeStatusChanged …) are gone
const PAYLOAD_LABELS_BY_EVENT: Record<string, Record<string, string>> = {
  InvoiceCreated: INVOICE_LABELS,
  InvoiceApproved: INVOICE_LABELS,
  PurchaseCreated: PURCHASE_LABELS,
  PurchaseApproved: PURCHASE_LABELS,
  StockReceived: STOCK_LABELS,
  StockIssued: STOCK_LABELS,
  StockAdjusted: STOCK_LABELS,
  InventoryReorderAlert: REORDER_LABELS,
  TreasuryTransactionApproved: TREASURY_LABELS,
  WorkflowTransitioned: WORKFLOW_LABELS,
  WorkflowCompleted: WORKFLOW_LABELS,
  WorkflowRejected: WORKFLOW_LABELS,
  'woocommerce.order.synced': WOO_SYNCED_LABELS,
  'woocommerce.order.voided': WOO_VOIDED_LABELS,
};

/** فیلدهای پوشش رویداد که در همه رویدادها هست */
export const COMMON_EVENT_FIELDS: EventFieldOption[] = [
  { path: 'eventType', label: 'نوع رویداد' },
  { path: 'aggregateType', label: 'نوع موجودیت' },
  { path: 'aggregateId', label: 'شناسه موجودیت' },
  { path: 'metadata.userName', label: 'کاربر انجام‌دهنده' },
];

/** فیلدهای payload رویداد (برای رویداد ناشناخته یا «*» خالی) و سپس فیلدهای مشترک */
export function eventFieldOptions(eventType: string): EventFieldOption[] {
  const labels = PAYLOAD_LABELS_BY_EVENT[eventType] ?? {};
  const payloadFields = Object.entries(labels).map(([key, label]) => ({ path: `payload.${key}`, label }));
  return [...payloadFields, ...COMMON_EVENT_FIELDS];
}
