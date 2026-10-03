import type { DbExecutor } from '../../db/drizzle.js';

export type DbClient = DbExecutor;

export interface GetDocumentsFilter {
  type?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  offset?: number;
  isExport?: boolean;
  projectId?: number | string;
}

export interface DocumentLineItemInput {
  itemId: number | string;
  quantity: number | string;
  // v7.0.68 (P2-6): مبلغ می‌تواند رشته باشد (ورودی API) تا رقم‌های اعشار بدون عبور از double ذخیره شوند
  unit_price?: number | string;
  unitPrice?: number | string;
  price?: number | string;
  discount?: number | string;
  location?: string;
  targetLoc?: string;
  physical_stock?: number;
  unit?: string;
  system_stock?: number;
}

export interface CreateDocumentInput {
  docType?: string;
  type?: string;
  refNumber?: string;
  date?: string;
  items: DocumentLineItemInput[];
  user?: string;
  inOut?: 'in' | 'out';
  buyer_name?: string;
  buyerName?: string;
  buyer_city?: string;
  buyerCity?: string;
  buyer_phone?: string;
  buyerPhone?: string;
  buyer_address?: string;
  buyerAddress?: string;
  status?: string;
  notes?: string;
  location?: string;
  currency?: string;
  skipVoucherSync?: boolean;
  strict?: boolean;
  externalTx?: DbClient;
  vat_percent?: number;
  vatPercent?: number;
  vat_amount?: number;
  vatAmount?: number;
  /** v7.0.63 (TD-198): نرخ تسعیر سند غیرریالی */
  exchangeRate?: number | string | null;
  exchange_rate?: number | string | null;
  attachments?: unknown[];
  projectId?: number | string | null;
  project_id?: number | string | null;
  excludeDocumentId?: number | string | null;
  /** v7.0.81 (TD-230): فاکتور فروش اصلی سند برگشت از فروش */
  returnOfDocumentId?: number | string | null;
  return_of_document_id?: number | string | null;
  /** v7.0.103 (TD-191): هزینه ارسال و کارمزد فاکتور فروش (فقط مسیر سرویس، مانند سفارش ووکامرس) */
  serviceChargeAmount?: number | string | null;
}

export interface UpdateDocumentInput {
  refNumber?: string;
  date?: string;
  user?: string;
  buyer_name?: string;
  buyerName?: string;
  buyer_city?: string;
  buyerCity?: string;
  buyer_phone?: string;
  buyerPhone?: string;
  buyer_address?: string;
  buyerAddress?: string;
  status?: string;
  notes?: string;
  location?: string;
  currency?: string;
  attachments?: unknown[];
  items?: DocumentLineItemInput[];
  /** v7.0.32 (TD-197): مالیات ساختاریافته اسناد فروش */
  vatPercent?: number | string | null;
  vat_percent?: number | string | null;
  vatAmount?: number | string | null;
  vat_amount?: number | string | null;
  /** v7.0.63 (TD-198): نرخ تسعیر سند غیرریالی */
  exchangeRate?: number | string | null;
  exchange_rate?: number | string | null;
  expectedVersion?: number;
  version?: number;
}

export interface FormattedDocumentItem {
  document_id: number;
  item_id: number;
  quantity: number;
  unit_price: number;
  unitPrice?: number;
  discount: number;
  location: string;
  name: string | null;
  item_name?: string | null;
  itemName?: string | null;
  code: string | null;
  unit: string | null;
  category: string | null;
  variance?: number;
  system_stock?: number;
}

export interface FormattedDocument {
  id: number;
  refNumber: string;
  ref_number: string;
  type: string;
  date: string;
  user: string | null;
  status: string | null;
  notes: string | null;
  buyerName: string | null;
  buyer_name: string | null;
  buyerCity: string | null;
  buyer_city: string | null;
  buyerPhone: string | null;
  buyer_phone: string | null;
  buyerAddress: string | null;
  buyer_address: string | null;
  currency: string | null;
  exchangeRate?: number | null;
  /** v7.0.81 (TD-230): فاکتور فروش اصلی سند برگشت از فروش */
  returnOfDocumentId?: number | null;
  version?: number | null;
  isDeleted?: number | null;
  projectId?: number | null;
  project_id?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedBy?: string | null;
  itemsCount: number;
  totalQuantity: number;
  totalAmount: number;
  total_amount?: number;
  /** v7.0.32 (TD-197): مالیات ساختاریافته و مبلغ قابل وصول (جمع خالص اقلام + مالیات) */
  vatPercent?: number;
  vat_percent?: number;
  vatAmount?: number;
  vat_amount?: number;
  /** v7.0.103 (TD-191): هزینه ارسال و کارمزد فاکتور */
  serviceChargeAmount?: number;
  service_charge_amount?: number;
  payableAmount?: number;
  payable_amount?: number;
  totalDiscount: number;
  grossAmount: number;
  paidAmount?: number;
  remainingAmount?: number;
  settlementStatus?: 'unpaid' | 'partially_paid' | 'fully_paid';
  settlements?: Array<{
    id: number;
    transactionNumber: string;
    type: string;
    method: string;
    amount: number;
    date: string;
    status: string | null;
    trackingNumber?: string | null;
    bankAccountId?: number | null;
    description?: string | null;
  }>;
  items: FormattedDocumentItem[];
}

export interface PaginatedDocumentsResult {
  data: FormattedDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
