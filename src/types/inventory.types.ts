export interface Item {
  id: number;
  type: 'product' | 'raw_material';
  name: string;
  code: string;
  current_stock: number;
  currentStock?: number;
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  reorder_point?: number;
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  purchase_price?: number;
  sell_price?: number;
  sales_price?: number;
  costPrice?: number;
  cost_price?: number;
  stocks?: any;
  color?: string;
  weight?: number;
  material?: string;
  size?: string;
  canSetOpeningBalance?: boolean;
  can_set_opening_balance?: boolean;
}

export interface PendingMaterial {
  id: number;
  code: string;
  name: string;
  unit: string;
  category?: string;
  type?: string;
  projectId?: number | null;
  project_id?: number | null;
  projectTitle?: string;
  project_title?: string;
  requestedBy?: string;
  requested_by?: string;
  status: 'pending' | 'approved' | 'rejected';
  reorderPoint?: number;
  reorder_point?: number;
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  color?: string;
  weight?: number;
  material?: string;
  size?: string;
  image?: string;
  thumbnail?: string;
  rejectionReason?: string;
  rejection_reason?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Transaction {
  id: number;
  item_id: number;
  type: 'in' | 'out';
  quantity: number;
  date: string;
  document_type: string;
  document_ref: string;
  notes?: string;
  user?: string;
  // joined info
  item_name?: string;
  item_code?: string;
  item_unit?: string;
  item_type?: string;
}

export interface StatInfo {
  totalProducts: number;
  totalMaterials: number;
  lowStock: number;
  recentTx: number;
}

export interface Category {
  id: number;
  name: string;
  prefix: string;
  type: string;
  defaultUnit?: string;
  default_unit?: string;
}

export interface ItemPrice {
  id: number;
  item_id: number;
  title: string;
  price: number;
  currency: string;
}

/**
 * v9.0.89 (TD-485): پاسخ `GET /inventory/integrity-audit` (StockReconciliationService.getIntegrityReport)؛ همین نوع را
 * زبانه «بررسی سلامت و تطبیق موجودی» می‌خواند. پیش‌تر صفحه `report.items` و نام فیلدهای دیگری را می‌خواند که سرور
 * نمی‌فرستاد و جدول همیشه خالی بود.
 */
export type DiscrepancyType =
  | 'scalar_vs_wh_sum'
  | 'scalar_vs_kardex'
  | 'wh_sum_vs_kardex'
  | 'location_vs_kardex_mismatch'
  | 'kardex_negative'
  | 'kardex_wac_mismatch'
  | 'none';

export interface ItemIntegrityAuditResult {
  itemId: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  scalarCurrentStock: number;
  whStocksSum: number;
  kardexNetBalance: number;
  recordedWac: number;
  computedWac: number;
  discrepancies: DiscrepancyType[];
  whBreakdown: Record<string, number>;
  kardexLocBreakdown: Record<string, number>;
  kardexTotalIn: number;
  kardexTotalOut: number;
  hasKardexAnomalies: boolean;
  anomalyDetails: string[];
}

export interface WarehouseReconciliationSummary {
  code: string;
  name: string;
  totalStockJsonb: number;
  totalStockLedger: number;
  variance: number;
  isBalanced: boolean;
}

export interface InventoryIntegrityReport {
  summary: {
    totalItems: number;
    totalItemsChecked: number;
    synchronizedItems: number;
    healthyItemsCount: number;
    discrepancyItems: number;
    discrepantItemsCount: number;
    negativeStockItems: number;
    healthScorePercentage: number;
    totalScalarStock: number;
    totalKardexStock: number;
    totalScalarStockValue: number;
    totalKardexStockValue: number;
    totalInventoryValuationStored: number;
    /** سیاست موجودی منفی؛ همیشه `forbidden` (TD-180) */
    policy: string;
  };
  audits: ItemIntegrityAuditResult[];
  warehouses: WarehouseReconciliationSummary[];
}
