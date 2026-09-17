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
  status: 'pending' | 'under_review' | 'manager_approval' | 'ordered' | 'received' | 'rejected' | 'cancelled' | 'approved' | 'completed';
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

export interface ProcurementOrder {
  id: number;
  refNumber: string;
  orderNumber?: string;
  docType: string;
  status: 'draft' | 'final';
  date: string;
  orderDate?: string;
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
