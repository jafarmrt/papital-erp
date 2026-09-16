import type { FinancialAttachment } from './accounting.types';

export interface ProjectStage {
  id: number;
  project_id: number;
  stage_order: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  start_date?: string;
  end_date?: string;
  assigned_personnel: string[];
  required_resources: string[];
  progress_percent: number;
  notes?: string;
  completed_at?: string;
  completed_skus_count?: number;
  completedSkusCount?: number;
  applicable_skus_count?: number;
  applicableSkusCount?: number;
}

export interface ProjectProductItem {
  id: string; // unique ID within project e.g. "prod-1"
  item_id?: number | null;
  itemId?: number | null;
  item_code: string;
  itemCode?: string;
  item_name: string;
  itemName?: string;
  customer_code: string; // کد مشتری
  customerCode?: string;
  quantity: number;
  unit: string;
  needs_assembly: boolean; // آیا نیاز به مرحله مونتاژ دارد یا خیر
  needsAssembly?: boolean;
  notes?: string;
}

export interface ProductInventoryRequirement {
  transfer?: {
    isAvailable: boolean; // ترنسفر موجود است یا خیر
    killerQty: number; // مقدار کیلر مورد نیاز
    glazeQty: number; // مقدار گلیز مورد نیاز
    sandpaperQty: number; // تعداد کاغذ سمباده
    notes?: string;
  };
  tile?: {
    isAvailable: boolean; // کاشی موجود است یا خیر
    stockQty: number; // تعداد موجود در انبار
    neededQty: number; // تعداد مورد نیاز تولید/تامین
    tileCode?: string; // کد کاشی
    tileName?: string; // نام کاشی
    notes?: string;
  };
  assemblyMaterials?: Array<{
    id: string;
    itemId?: number | null;
    code: string;
    name: string;
    requiredQty: number;
    unit: string; // واحد شمارش
    notes?: string;
  }>;
  packagingMaterials?: Array<{
    id: string;
    itemId?: number | null;
    code: string;
    name: string;
    requiredQty: number;
    unit: string;
    notes?: string;
  }>;
}

export type InventoryControlCheckType = 'per_item' | 'global';

export interface InventoryControlPresetItem {
  id: string;
  name: string;
  itemCode?: string;
  unit: string;
  isOptional?: boolean;
  notes?: string;
}

export interface InventoryControlPresetSection {
  id: string;
  title: string;
  description?: string;
  checkType: InventoryControlCheckType;
  items: InventoryControlPresetItem[];
  filterType?: 'all' | 'category' | 'item_code';
  allowedCategories?: string[];
  allowedItemCodes?: string[];
}

export interface ProjectInventoryControlItemResult {
  itemId: string;
  name: string;
  itemCode?: string;
  category?: string;
  unit: string;
  warehouseUnit?: string;
  status: 'available' | 'needs_procurement' | 'not_applicable';
  requiredQty?: number;
  stockQty?: number;
  // Unit conversion fields
  convertedQty?: number;
  convertedUnit?: string;
  conversionRate?: number;
  conversionNotes?: string;
  // Fulfillment tracking fields
  fulfilledQty?: number;
  procurementStatus?: 'pending' | 'reserved' | 'in_progress' | 'fulfilled';
  fulfilledAt?: string;
  fulfilledBy?: string;
  notes?: string;
}

export interface ProjectInventoryControlSectionData {
  id: string;
  title: string;
  description?: string;
  checkType: InventoryControlCheckType;
  filterType?: 'all' | 'category' | 'item_code';
  allowedCategories?: string[];
  allowedItemCodes?: string[];
  perItemResults?: Record<string, Record<string, ProjectInventoryControlItemResult>>;
  globalItems?: ProjectInventoryControlItemResult[];
  itemsSchema?: InventoryControlPresetItem[];
}

export interface PurchaseListItem {
  id: string;
  itemCode: string;
  itemName: string;
  category: string;
  totalRequiredQty: number;
  unit: string;
  warehouseStockQty: number;
  warehouseUnit?: string;
  toPurchaseQty: number;
  // Unit conversion fields
  convertedRequiredQty?: number;
  convertedToPurchaseQty?: number;
  convertedUnit?: string;
  conversionRate?: number;
  conversionNotes?: string;
  // Fulfillment tracking fields
  fulfilledQty?: number;
  procurementStatus?: 'pending' | 'reserved' | 'in_progress' | 'fulfilled';
  fulfilledAt?: string;
  fulfilledBy?: string;
  notes?: string;
}

export interface ReservedStockItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  reservedQty: number;
  unit: string;
  originalQty?: number;
  originalUnit?: string;
  reservedAt: string;
}

export interface ProjectInventoryControl {
  sections?: ProjectInventoryControlSectionData[];
  productRequirements?: Record<string, ProductInventoryRequirement>;
  purchaseList?: PurchaseListItem[];
  manualPurchaseItems?: PurchaseListItem[];
  isFinalized?: boolean;
  isReserved?: boolean;
  finalizedAt?: string;
  reservedItems?: ReservedStockItem[];
  materialProgressPercent?: number;
  lastUpdated?: string;
}

export interface TaskAssignmentItem {
  id?: string;
  taskId: number | null;
  taskCode?: string;
  taskTitle: string;
  category?: string;
  assignedPersonnelId: number | null;
  assignedPersonnelName?: string;
  defaultRate?: number;
  quantity: number;
  unit?: string;
  estimatedCost?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
  pieceworkLogId?: number;
  isLoggedToPiecework?: boolean;
}

export interface ProductStageSchedule {
  startDate?: string;
  endDate?: string;
  tasks?: TaskAssignmentItem[];
  taskAssignments?: TaskAssignmentItem[];
}

export interface ProjectStageSchedule {
  startDate?: string;
  endDate?: string;
  notes?: string;
  productSchedules?: Record<string, ProductStageSchedule>;
}

export type ProjectStageSchedulesMap = Record<string, ProjectStageSchedule>;

export interface ProductionProject {
  id: number;
  project_code: string;
  projectCode?: string;
  title: string;
  customer_id?: number;
  customerId?: number;
  customer_name?: string;
  customerName?: string;
  item_id?: number;
  itemId?: number;
  item_code?: string;
  itemCode?: string;
  item_name?: string;
  itemName?: string;
  quantity: number;
  unit: string;
  start_date?: string;
  startDate?: string;
  end_date?: string;
  endDate?: string;
  status: 'planned' | 'in_progress' | 'completed' | 'paused' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  created_by?: string;
  createdBy?: string;
  stages?: ProjectStage[];
  products?: ProjectProductItem[];
  product_items?: ProjectProductItem[];
  productItems?: ProjectProductItem[];
  inventory_control?: ProjectInventoryControl;
  inventoryControl?: ProjectInventoryControl;
  stage_schedules?: ProjectStageSchedulesMap;
  stageSchedules?: ProjectStageSchedulesMap;
  custom_stages?: string[];
  customStages?: string[];
  attachments?: FinancialAttachment[];
  // Joined or calculated fields
  item_image?: string;
  progress_percent?: number;
  total_stages?: number;
  completed_stages?: number;
}
