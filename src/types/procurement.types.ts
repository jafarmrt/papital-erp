export interface PurchaseRequisitionItemRow {
  id?: string;
  itemId?: number | null;
  item_id?: number | null;
  itemCode?: string;
  item_code?: string;
  itemName?: string;
  item_name?: string;
  category?: string;
  unit: string;
  requestedQty: number;
  requested_qty?: number;
  orderedQty?: number;
  ordered_qty?: number;
  remainingQty?: number;
  remaining_qty?: number;
  unitPriceEstimate?: number;
  unit_price_estimate?: number;
  currentStock?: number | null;
  current_stock?: number | null;
  targetSupplierId?: number | null;
  target_supplier_id?: number | null;
  targetSupplierName?: string;
  target_supplier_name?: string;
  status?: 'pending' | 'ordered' | 'received' | 'rejected' | 'approved' | 'completed';
  linkedDocumentIds?: number[];
  linked_document_ids?: number[];
  notes?: string;
  closureNote?: string;
  closure_note?: string;
  /** v9.0.268 (TD-690): ردیفی که هنگام صدور سفارش بسته شد؛ دیگر سفارش داده و بی سفارش دریافت نمی‌شود */
  closed?: boolean;
  /** v8.0.38 (TD-289): سفارش‌های بیش از درخواست این ردیف با دلیل ثبت‌شده */
  overOrders?: RequisitionOverOrderRecord[];
}

/** v8.0.38 (TD-289، تصمیم مالک محصول — گزینه ب): سفارش بیش از درخواست با دلیل، کاربر، تاریخ (ISO) و اسناد سفارش */
export interface RequisitionOverOrderRecord {
  quantity: number;
  reason: string;
  user: string;
  date: string;
  documentIds: number[];
}

export type PurchaseRequisitionItem = PurchaseRequisitionItemRow;

export interface PurchaseRequisition {
  id: number;
  code: string;
  title: string;
  projectId?: number | null;
  project_id?: number | null;
  projectCode?: string;
  project_code?: string;
  projectName?: string;
  project_name?: string;
  status: 'pending' | 'under_review' | 'manager_approval' | 'ordered' | 'received' | 'rejected' | 'cancelled' | 'approved' | 'completed' | 'consolidated';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  requiredDate?: string;
  required_date?: string;
  requestedById?: number | null;
  requested_by_id?: number | null;
  requestedByName?: string;
  requested_by_name?: string;
  assignedToId?: number | null;
  assigned_to_id?: number | null;
  assignedToName?: string;
  assigned_to_name?: string;
  workflowInstanceId?: number | null;
  workflow_instance_id?: number | null;
  notes?: string;
  description?: string;
  totalEstimatedAmount?: number;
  total_estimated_amount?: number;
  items: PurchaseRequisitionItemRow[];
  /** v9.0.274 (TD-694): درخواستی که این درخواست در آن تجمیع شد (وضعیت `consolidated`) و کد آن */
  consolidatedIntoId?: number | null;
  consolidatedIntoCode?: string | null;
  /** v9.0.278 (TD-697): شمار سفارش‌های زنده درخواست و سفارش‌های در انتظار تحویل (از سرور، شمرده در SQL) */
  ordersCount?: number;
  pendingDeliveryOrdersCount?: number;
  isDeleted?: number;
  is_deleted?: number;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface ProcurementOrderItem {
  id: number;
  itemId: number;
  itemName: string;
  itemCode?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  location?: string;
}

/** سفارش تدارکات، همان شکل پاسخ `GET /procurement/orders` (`listProcurementOrders`)؛ شماره در refNumber و تأمین‌کننده در supplierName */
export interface ProcurementOrder {
  id: number;
  refNumber: string;
  docType: string;
  status: 'draft' | 'final';
  date: string;
  supplierName: string;
  notes: string;
  requisitionId?: number | null;
  requisitionCode?: string | null;
  projectName?: string | null;
  location?: string;
  totalAmount: number;
  itemsCount: number;
  items: ProcurementOrderItem[];
  user?: string;
}

/** خلاصه میز تدارکات، همان پاسخ `GET /procurement/inbox/summary` (`ProcurementService.getInboxSummary`) */
export interface ProcurementInboxSummary {
  totalRequisitions: number;
  pendingCount: number;
  underReviewCount: number;
  managerApprovalCount: number;
  orderedCount: number;
  receivedCount: number;
  urgentCount: number;
  pendingDeliveryOrdersCount: number;
  deliveredOrdersCount: number;
  totalOrdersCount: number;
}
