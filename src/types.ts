export interface Item {
  id: number;
  type: 'product' | 'raw_material';
  name: string;
  code: string;
  current_stock: number;
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  reorder_point?: number;
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  color?: string;
  weight?: number;
  material?: string;
  size?: string;
}

export interface PendingMaterial {
  id: number;
  code: string;
  name: string;
  unit: string;
  category?: string;
  type?: string;
  projectId?: number;
  project_id?: number;
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

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: string;
  avatar_url?: string;
  mustResetPassword?: boolean | number;
  must_reset_password?: boolean | number;
}

export interface AuthUserPayload {
  id: number;
  username: string;
  role: string;
  fullName?: string;
  full_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  csrfToken?: string;
  mustResetPassword?: boolean | number;
  must_reset_password?: boolean | number;
  permissions?: string[];
}

export interface PermissionItem {
  key: string;
  title: string;
  description: string;
}

export interface PermissionCategory {
  category: string;
  permissions: PermissionItem[];
}

export interface Role {
  id: number;
  name: string;
  code: string;
  description: string;
  permissions: string[];
  isSystem: number;
}

export interface Changelog {
  id: number;
  version: string;
  date: string;
  features: string;
  fixes: string;
}

export interface Category {
  id: number;
  name: string;
  prefix: string;
  type: string;
  defaultUnit?: string;
  default_unit?: string;
}

export interface ContactPerson {
  id?: string;
  name: string;
  role?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface Customer {
  id: number;
  name: string;
  contactName?: string;
  country?: string;
  province?: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
  partyType?: 'customer' | 'supplier' | 'both';
  party_type?: 'customer' | 'supplier' | 'both';
  supplierCategory?: string;
  supplier_category?: string;
  bankInfo?: {
    bankName?: string;
    accountNumber?: string;
    shaba?: string;
    cardNumber?: string;
  };
  bank_info?: {
    bankName?: string;
    accountNumber?: string;
    shaba?: string;
    cardNumber?: string;
  };
  contacts?: ContactPerson[];
  currency?: string;
}

export interface ItemPrice {
  id: number;
  item_id: number;
  title: string;
  price: number;
  currency: string;
}

export interface ActivityLog {
  id: number;
  userId?: number;
  username: string;
  userFullName?: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  details?: any;
  ipAddress?: string;
  timestamp: string;
}

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
  // Joined or calculated fields
  item_image?: string;
  progress_percent?: number;
  total_stages?: number;
  completed_stages?: number;
}

export interface DailyWorkLog {
  id: number;
  user_id: number;
  userId?: number;
  username: string;
  user_full_name?: string;
  userFullName?: string;
  date: string;
  start_time: string;
  startTime?: string;
  end_time: string;
  endTime?: string;
  work_hours: number;
  workHours?: number;
  work_mode: 'onsite' | 'remote';
  workMode?: 'onsite' | 'remote';
  title: string;
  content: string;
  project_id?: number;
  projectId?: number;
  project_name?: string;
  projectName?: string;
  tags?: string[];
  mentions?: number[]; // array of user IDs
  visibility: 'public' | 'managers' | 'mentioned_only' | 'custom' | 'private';
  allowed_users?: number[]; // user IDs allowed
  allowedUsers?: number[];
  status?: 'submitted' | 'reviewed';
  manager_notes?: string;
  managerNotes?: string;
  created_at?: string;
  createdAt?: string;
}

export interface AppNotification {
  id: number;
  user_id: number;
  userId?: number;
  sender_id?: number;
  senderId?: number;
  sender_name?: string;
  senderName?: string;
  type: 'mention' | 'work_log_review' | 'system';
  title: string;
  message: string;
  link?: string;
  is_read: number;
  isRead?: number;
  created_at?: string;
  createdAt?: string;
}

export interface CRMLead {
  id: number;
  title: string;
  customerId?: number | null;
  customerName?: string;
  phone?: string;
  company?: string;
  source?: string;
  stage: string;
  estimatedValue: number;
  currency: string;
  probability: number;
  assignedTo: string;
  // V10-4.1: لینک رسمی فروشنده به پرسنل
  assignedPersonnelId?: number | null;
  expectedCloseDate?: string;
  notes?: string;
  status: string;
  contacts?: ContactPerson[];
  hasProforma?: number;
  proformaId?: number | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface CRMActivity {
  id: number;
  leadId?: number | null;
  leadTitle?: string;
  customerId?: number | null;
  customerName?: string;
  type: string; // 'call' | 'meeting' | 'email' | 'whatsapp' | 'note' | 'quote' | 'task'
  title: string;
  description?: string;
  result?: string;
  loggedBy?: string;
  activityDate?: string;
  nextFollowUpDate?: string;
  nextFollowUpTask?: string;
  assignedTo?: string;
  // V10-4.1: لینک رسمی مسئول تسک به پرسنل
  assignedPersonnelId?: number | null;
  isFollowUpCompleted: number;
  createdAt?: string;
}

export interface Personnel {
  id: number;
  firstName?: string;
  lastName?: string;
  fullName: string;
  personnelCode?: string;
  userId?: number | null;
  username?: string;
  gender?: string;
  birthDate?: string;
  nationality?: string;
  nationalId?: string;
  phone?: string;
  employmentStatus?: string;
  // V10-4.4: مدل حقوق — 'none' | 'piecework' | 'monthly_fixed' | 'mixed'
  salaryType?: 'none' | 'piecework' | 'monthly_fixed' | 'mixed';
  monthlySalary?: number | string | null;
  jobTitle?: string;
  education?: string;
  endDate?: string;
  terminationReason?: string;
  specializedSkills?: string;
  otherSkills?: string;
  referralSource?: string;
  cardNumber?: string;
  accountNumber?: string;
  shebaNumber?: string;
  bankName?: string;
  nobitexUsername?: string;
  nobitexPassword?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: number;
}

export interface PieceworkTask {
  id: number;
  code: string;
  title: string;
  category?: string;
  defaultRate: number;
  unit: string;
  description?: string;
  isActive?: number;
  createdAt?: string;
  isDeleted?: number;
}

export interface PieceworkPersonnelRate {
  id: number;
  personnelId: number;
  taskId: number;
  customRate: number;
  updatedAt?: string;
}

export interface PieceworkLog {
  id: number;
  personnelId: number;
  personnelName?: string;
  personnelCode?: string;
  taskId: number;
  taskTitle?: string;
  taskCode?: string;
  taskCategory?: string;
  projectId?: number | null;
  projectCode?: string;
  projectTitle?: string;
  unit?: string;
  date: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  notes?: string;
  payrollId?: number | null;
  status?: string;
  createdById?: number;
  createdByUsername?: string;
  createdAt?: string;
}

export interface PieceworkPayroll {
  id: number;
  payrollNumber: string;
  personnelId: number;
  personnelName?: string;
  personnelCode?: string;
  jobTitle?: string;
  cardNumber?: string;
  shebaNumber?: string;
  bankName?: string;
  nobitexUsername?: string;
  startDate: string;
  endDate: string;
  title: string;
  totalPieceworkAmount: number;
  // V10-4.4: سهم حقوق ثابت در فیش (monthly_fixed / mixed)
  totalFixedAmount?: number;
  totalBonuses: number;
  totalDeductions: number;
  netPayable: number;
  status: 'draft' | 'approved' | 'paid';
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  items?: PieceworkLog[];
  createdAt?: string;
  voucherId?: number | null;
  voucherNumber?: number | string | null;
  voucherStatus?: string | null;
  isVoucherSynced?: boolean;
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

// ==========================================
// ACCOUNTING & FINANCIAL TYPES
// ==========================================

export type AccountLevel = 'group' | 'general' | 'subsidiary' | 'detailed';
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cost_of_sales';
export type AccountNature = 'debit' | 'credit' | 'both';

export interface Account {
  id: number;
  code: string;
  name: string;
  level: AccountLevel;
  parentId?: number | null;
  parent_id?: number | null;
  accountType: AccountType;
  account_type?: AccountType;
  nature: AccountNature;
  description?: string;
  isSystem?: number;
  is_system?: number;
  isActive?: number;
  is_active?: number;
  createdAt?: string;
  // Computed balance for tree/reports
  totalDebit?: number;
  totalCredit?: number;
  balance?: number;
  children?: Account[];
}

export type VoucherType = 'general' | 'opening' | 'closing' | 'sales' | 'purchase' | 'treasury' | 'payroll' | 'adjustment';
export type VoucherStatus = 'draft' | 'approved' | 'permanent';

export interface JournalVoucherItem {
  id?: number;
  voucherId?: number;
  voucher_id?: number;
  accountId: number;
  account_id?: number;
  accountCode?: string;
  accountName?: string;
  accountLevel?: string;
  rowOrder?: number;
  row_order?: number;
  detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
  detailed_type?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
  detailedId?: number | null;
  detailed_id?: number | null;
  detailedName?: string;
  detailed_name?: string;
  debit: number;
  credit: number;
  currency?: string;
  exchangeRate?: number;
  exchange_rate?: number;
  description?: string;
}

export interface JournalVoucher {
  id: number;
  voucherNumber: number;
  voucher_number?: number;
  manualVoucherNumber?: string;
  manual_voucher_number?: string;
  date: string;
  voucherType: VoucherType;
  voucher_type?: VoucherType;
  status: VoucherStatus;
  totalDebit: number;
  total_debit?: number;
  totalCredit: number;
  total_credit?: number;
  description: string;
  referenceModule?: 'manual' | 'invoice' | 'payroll' | 'cheque' | 'treasury' | 'inventory' | string;
  reference_module?: 'manual' | 'invoice' | 'payroll' | 'cheque' | 'treasury' | 'inventory' | string;
  referenceId?: number | null;
  reference_id?: number | null;
  referenceNumber?: string;
  reference_number?: string;
  currency?: string;
  createdById?: number;
  created_by_id?: number;
  createdByUsername?: string;
  created_by_username?: string;
  approvedById?: number;
  approved_by_id?: number;
  createdAt?: string;
  created_at?: string;
  items?: JournalVoucherItem[];
}

export type BankAccountType = 'bank' | 'cash' | 'pos' | 'petty_cash';

export interface BankAccount {
  id: number;
  code: string;
  title: string;
  type: BankAccountType;
  bankName?: string;
  bank_name?: string;
  accountNumber?: string;
  account_number?: string;
  shebaNumber?: string;
  sheba_number?: string;
  cardNumber?: string;
  card_number?: string;
  branch?: string;
  initialBalance?: number;
  initial_balance?: number;
  currentBalance?: number;
  current_balance?: number;
  ledgerBalance?: number;
  treasuryBalance?: number;
  totalDebit?: number;
  totalCredit?: number;
  discrepancy?: number;
  syncStatus?: 'synced' | 'discrepant' | 'unlinked';
  currency?: string;
  accountId?: number | null;
  account_id?: number | null;
  accountName?: string;
  accountCode?: string;
  isActive?: number;
  is_active?: number;
  notes?: string;
  createdAt?: string;
}

export interface BankReconciliationReport {
  syncedCount: number;
  discrepantCount: number;
  unlinkedCount: number;
  totalCashAndBankLedger: number;
  totalCashAndBankTreasury: number;
  totalDiscrepancy: number;
  accounts: {
    id: number;
    code: string;
    title: string;
    type: BankAccountType;
    accountCode?: string;
    accountName?: string;
    initialBalance: number;
    ledgerBalance: number;
    treasuryBalance: number;
    currentBalance: number;
    totalDebit: number;
    totalCredit: number;
    discrepancy: number;
    syncStatus: 'synced' | 'discrepant' | 'unlinked';
    notes?: string;
  }[];
}

export type ChequeType = 'received' | 'paid';
export type ChequeStatus = 'received' | 'in_treasury' | 'in_collection' | 'passed' | 'bounced' | 'returned' | 'spent' | 'in_safe';

export interface ChequeStatusHistory {
  date: string;
  status: ChequeStatus;
  user: string;
  notes?: string;
  voucherNumber?: number;
}

export interface Cheque {
  id: number;
  type: ChequeType;
  chequeNumber: string;
  cheque_number?: string;
  sayadNumber?: string;
  sayad_number?: string;
  bankName: string;
  bank_name?: string;
  branch?: string;
  issueDate: string;
  issue_date?: string;
  dueDate: string;
  due_date?: string;
  amount: number;
  currency?: string;
  partyType?: 'customer' | 'personnel' | 'supplier' | 'other' | string;
  party_type?: 'customer' | 'personnel' | 'supplier' | 'other' | string;
  partyId?: number | null;
  party_id?: number | null;
  partyName: string;
  party_name?: string;
  status: ChequeStatus;
  drawerName?: string;
  drawer_name?: string;
  payeeName?: string;
  payee_name?: string;
  bankAccountId?: number | null;
  bank_account_id?: number | null;
  bankAccountTitle?: string;
  voucherId?: number | null;
  voucher_id?: number | null;
  description?: string;
  statusHistory?: ChequeStatusHistory[];
  status_history?: ChequeStatusHistory[];
  createdAt?: string;
}

export interface TreasuryTransaction {
  id: number;
  transactionNumber: string;
  transaction_number?: string;
  type: 'receipt' | 'payment';
  date: string;
  method: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
  amount: number;
  currency?: string;
  exchangeRate?: number;
  exchange_rate?: number;
  bankAccountId?: number;
  bank_account_id?: number;
  bankAccountTitle?: string;
  partyType?: 'customer' | 'personnel' | 'supplier' | 'other' | string;
  party_type?: 'customer' | 'personnel' | 'supplier' | 'other' | string;
  partyId?: number | null;
  party_id?: number | null;
  partyName: string;
  party_name?: string;
  trackingNumber?: string;
  tracking_number?: string;
  voucherId?: number | null;
  voucher_id?: number | null;
  chequeId?: number | null;
  cheque_id?: number | null;
  documentId?: number | null;
  document_id?: number | null;
  description?: string;
  status?: 'completed' | 'cancelled';
  createdAt?: string;
}

export interface TrialBalanceRow {
  accountId: number;
  code: string;
  name: string;
  level: AccountLevel;
  parentId?: number | null;
  parentCode?: string;
  parentName?: string;
  accountType: AccountType;
  nature: AccountNature;
  initialDebit?: number;
  initialCredit?: number;
  debitTurnover: number;
  creditTurnover: number;
  totalDebit: number;
  totalCredit: number;
  debitBalance: number;
  creditBalance: number;
  preClosingDebit?: number;
  preClosingCredit?: number;
  closingDebit?: number;
  closingCredit?: number;
}

export interface TrialBalanceReport {
  columns: 2 | 4 | 6 | 8;
  fromDate?: string;
  toDate?: string;
  rows: TrialBalanceRow[];
  totalDebitTurnover: number;
  totalCreditTurnover: number;
  totalDebitBalance: number;
  totalCreditBalance: number;
  isBalanced?: boolean;
  difference?: number;
  sumDebit?: number;
  sumCredit?: number;
  sumClosingDebit?: number;
  sumClosingCredit?: number;
}

export interface IncomeStatementRow {
  accountId?: number;
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatementReport {
  fromDate?: string;
  toDate?: string;
  revenues: IncomeStatementRow[];
  totalRevenues: number;
  costOfGoodsSold: IncomeStatementRow[];
  costOfSales?: IncomeStatementRow[];
  totalCostOfGoodsSold: number;
  totalCostOfSales?: number;
  grossProfit: number;
  operatingExpenses: IncomeStatementRow[];
  expenses?: IncomeStatementRow[];
  totalOperatingExpenses: number;
  totalExpenses?: number;
  operatingProfit: number;
  otherIncomeExpenses: IncomeStatementRow[];
  totalOtherIncomeExpenses: number;
  netProfit: number;
}

export interface BalanceSheetRow {
  accountId?: number;
  code: string;
  name: string;
  amount: number;
}

export interface BalanceSheetSection {
  title: string;
  rows: BalanceSheetRow[];
  totalAmount: number;
}

export interface BalanceSheetReport {
  asOfDate: string;
  currentAssets: BalanceSheetSection;
  nonCurrentAssets: BalanceSheetSection;
  assets?: BalanceSheetRow[];
  totalAssets: number;
  currentLiabilities: BalanceSheetSection;
  nonCurrentLiabilities: BalanceSheetSection;
  liabilities?: BalanceSheetRow[];
  totalLiabilities: number;
  equity: BalanceSheetSection & BalanceSheetRow[];
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  retainedEarnings?: number;
  isBalanced: boolean;
  difference?: number;
}

export interface AccountLedgerRow {
  id: number;
  voucherNumber: number;
  manualVoucherNumber?: string;
  date: string;
  description: string;
  detailedType?: string;
  detailedName?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  balanceType: 'debit' | 'credit' | 'zero';
}

export interface AccountLedgerReport {
  accountId: number;
  accountCode: string;
  accountName: string;
  account?: { code: string; name: string; nature: string };
  detailedName?: string;
  fromDate?: string;
  toDate?: string;
  openingBalance: number;
  openingBalanceType: 'debit' | 'credit' | 'zero';
  rows: AccountLedgerRow[];
  items?: AccountLedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  closingBalanceType: 'debit' | 'credit' | 'zero';
}

export interface FinancialSummaryStats {
  totalCashAndBank: number;
  totalReceivables: number;
  totalPayables: number;
  totalChequesInCollection: number;
  totalChequesReceived: number;
  totalChequesPaid: number;
  totalRevenues: number;
  totalCostOfSales: number;
  totalExpenses: number;
  netProfit: number;
  totalVouchersCount: number;
}

export interface CurrencyFinancialSummary {
  currency: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  vouchersCount: number;
}

export interface FinancialRatiosReport {
  asOfDate?: string;
  currency?: string;
  // Liquidity
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  netWorkingCapital: number;
  // Solvency & Leverage
  debtRatio: number;
  debtToEquityRatio: number;
  equityRatio: number;
  // Profitability
  grossMargin: number;
  operatingMargin: number;
  netProfitMargin: number;
  returnOnAssets: number;
  returnOnEquity: number;
  // Activity & Turnover
  assetTurnover: number;
  receivablesTurnover: number;
  inventoryTurnover: number;
  inventoryTurnoverDays?: number;
  // Key Financial Totals
  totalAssets: number;
  totalCurrentAssets: number;
  totalNonCurrentAssets?: number;
  totalCurrentLiabilities: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  grossProfit?: number;
  operatingProfit?: number;
  netProfit: number;
  cashAndBankBalance: number;
  inventoryBalance: number;
  receivablesBalance: number;
  // Health Assessment Matrix
  status: {
    liquidity: 'excellent' | 'good' | 'warning' | 'danger';
    solvency: 'excellent' | 'good' | 'warning' | 'danger';
    profitability: 'excellent' | 'good' | 'warning' | 'danger';
    efficiency: 'excellent' | 'good' | 'warning' | 'danger';
    overallScore: number;
  };
  currencyBreakdowns?: CurrencyFinancialSummary[];
}

export interface FiscalClosingAccountRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountTitle?: string;
  accountType: string;
  balance: number;
  action: 'debit' | 'credit';
  amount: number;
}

export interface FiscalYearClosingPreview {
  year: number | string;
  closingDate: string;
  openingDateNewYear: string;
  totalRevenues: number;
  totalRevenue?: number;
  totalCostOfSales: number;
  totalExpenses: number;
  totalTemporaryDebit: number;
  totalTemporaryCredit: number;
  netProfit: number;
  isProfit: boolean;
  temporaryAccounts: FiscalClosingAccountRow[];
  permanentAccounts: FiscalClosingAccountRow[];
  summary?: {
    totalRevenue: number;
    totalExpenses: number;
    totalCostOfSales: number;
    netProfit: number;
    isProfit: boolean;
    temporaryCount: number;
    permanentCount: number;
  };
  summaryVouchersPreview: {
    title: string;
    voucherType: VoucherType;
    date: string;
    description: string;
    itemsCount: number;
    totalAmount: number;
  }[];
}

export interface FiscalYearClosingResult {
  success: boolean;
  message: string;
  year: number | string;
  netProfit: number;
  closingVouchers: JournalVoucher[];
}

export interface FairTradePrinciple {
  number: number;
  title: string;
  description: string;
  icon?: any;
  tag: string;
}

export interface CalendarEventItem {
  id: string | number;
  date: string;
  title: string;
  subtitle?: string;
  type: 'crm_followup' | 'crm_close' | 'daily_log' | 'event';
  color?: string;
  raw?: any;
}

export interface DashboardShortcutItem {
  id: string;
  title: string;
  description: string;
  path: string;
  iconName: string;
  category: string;
  permission?: string;
  badge?: string;
  colorTheme: string;
}