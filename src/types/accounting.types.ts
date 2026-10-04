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
  description?: string | null;
  isSystem?: number | null;
  is_system?: number | null;
  isActive?: number | null;
  is_active?: number | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  createdAt?: string | null;
  // Computed balance for tree/reports
  totalDebit?: number;
  totalCredit?: number;
  balance?: number;
  children?: Account[];
}

export type VoucherType = 'general' | 'opening' | 'closing' | 'sales' | 'purchase' | 'treasury' | 'payroll' | 'adjustment';

export interface FinancialAttachment {
  id: string;
  name: string;
  url: string; // Base64 compressed image data or link
  size?: number;
  type?: string;
  title?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  fileName?: string;
  fileType?: string;
  dataUrl?: string;
}

export type VoucherStatus = 'draft' | 'approved' | 'permanent';

export interface JournalVoucherItem {
  id?: number;
  voucherId?: number;
  voucher_id?: number;
  accountId: number;
  account_id?: number;
  accountCode?: string | null;
  accountName?: string | null;
  accountLevel?: string | null;
  rowOrder?: number;
  row_order?: number;
  detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string | null;
  detailed_type?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string | null;
  detailedId?: number | null;
  detailed_id?: number | null;
  detailedName?: string | null;
  detailed_name?: string | null;
  debit: number;
  credit: number;
  currency?: string | null;
  exchangeRate?: number | null;
  exchange_rate?: number | null;
  description?: string | null;
}

export interface JournalVoucher {
  id: number;
  voucherNumber: number;
  voucher_number?: number;
  manualVoucherNumber?: string | null;
  manual_voucher_number?: string | null;
  date: string;
  voucherType: VoucherType;
  voucher_type?: VoucherType;
  status: VoucherStatus;
  totalDebit: number;
  total_debit?: number;
  totalCredit: number;
  total_credit?: number;
  description: string;
  referenceModule?: 'manual' | 'invoice' | 'payroll' | 'cheque' | 'treasury' | 'inventory' | string | null;
  reference_module?: 'manual' | 'invoice' | 'payroll' | 'cheque' | 'treasury' | 'inventory' | string | null;
  referenceId?: number | null;
  reference_id?: number | null;
  referenceNumber?: string | null;
  reference_number?: string | null;
  /** v7.0.31 (TD-193): سند انبار/فاکتور مبدأ اسناد صادرشده توسط VoucherSync */
  sourceDocumentId?: number | null;
  /** TD-242: فیش حقوقی مبدأ سند صادرشده توسط VoucherSync برای فیش */
  sourcePayrollId?: number | null;
  currency?: string | null;
  createdById?: number | null;
  created_by_id?: number | null;
  createdByUsername?: string | null;
  created_by_username?: string | null;
  approvedById?: number | null;
  approved_by_id?: number | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  createdAt?: string | null;
  created_at?: string | null;
  items?: JournalVoucherItem[];
  attachments?: FinancialAttachment[];
}

export type BankAccountType = 'bank' | 'cash' | 'pos' | 'petty_cash';

export interface BankAccount {
  id: number;
  code: string;
  title: string;
  type: BankAccountType;
  bankName?: string | null;
  bank_name?: string | null;
  accountNumber?: string | null;
  account_number?: string | null;
  shebaNumber?: string | null;
  sheba_number?: string | null;
  cardNumber?: string | null;
  card_number?: string | null;
  branch?: string | null;
  initialBalance?: number | null;
  initial_balance?: number | null;
  currentBalance?: number | null;
  current_balance?: number | null;
  ledgerBalance?: number;
  treasuryBalance?: number;
  totalDebit?: number;
  totalCredit?: number;
  discrepancy?: number;
  syncStatus?: 'synced' | 'discrepant' | 'unlinked';
  currency?: string | null;
  accountId?: number | null;
  account_id?: number | null;
  accountName?: string | null;
  accountCode?: string | null;
  isActive?: number | null;
  is_active?: number | null;
  notes?: string | null;
  createdAt?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  version?: number | null;
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
  description?: string;
  voucherNumber?: number;
}

export interface Cheque {
  id: number;
  type: ChequeType;
  chequeNumber: string;
  cheque_number?: string;
  sayadNumber?: string | null;
  sayad_number?: string | null;
  bankName: string;
  bank_name?: string;
  branch?: string | null;
  issueDate: string;
  issue_date?: string;
  dueDate: string;
  due_date?: string;
  amount: number;
  currency?: string | null;
  partyType?: 'customer' | 'personnel' | 'supplier' | 'other' | string | null;
  party_type?: 'customer' | 'personnel' | 'supplier' | 'other' | string | null;
  partyId?: number | null;
  party_id?: number | null;
  partyName: string;
  party_name?: string;
  status: ChequeStatus;
  drawerName?: string | null;
  drawer_name?: string | null;
  payeeName?: string | null;
  payee_name?: string | null;
  bankAccountId?: number | null;
  bank_account_id?: number | null;
  bankAccountTitle?: string | null;
  voucherId?: number | null;
  voucher_id?: number | null;
  description?: string | null;
  statusHistory?: ChequeStatusHistory[];
  status_history?: ChequeStatusHistory[];
  attachments?: FinancialAttachment[];
  createdAt?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
}

export interface TreasuryTransaction {
  id: number;
  transactionNumber: string;
  transaction_number?: string;
  type: 'receipt' | 'payment';
  date: string;
  method: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
  amount: number;
  currency?: string | null;
  exchangeRate?: number | null;
  exchange_rate?: number | null;
  bankAccountId?: number | null;
  bank_account_id?: number | null;
  bankAccountTitle?: string | null;
  partyType?: 'customer' | 'personnel' | 'supplier' | 'other' | string | null;
  party_type?: 'customer' | 'personnel' | 'supplier' | 'other' | string | null;
  partyId?: number | null;
  party_id?: number | null;
  partyName: string;
  party_name?: string;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  voucherId?: number | null;
  voucher_id?: number | null;
  chequeId?: number | null;
  cheque_id?: number | null;
  documentId?: number | null;
  document_id?: number | null;
  payrollId?: number | null;
  payroll_id?: number | null;
  // V1.4.0: ابطال با سند معکوس
  reversalOfId?: number | null;
  reversal_of_id?: number | null;
  // V1.5.0: هویت ثبت‌کننده
  createdById?: number | null;
  created_by_id?: number | null;
  creatorName?: string | null;
  // V1.6.0: آشتی‌سنجی بانکی
  reconciled?: number | null;
  reconciledAt?: string | null;
  reconciledBatch?: string | null;
  purpose?: string | null;
  description?: string | null;
  status?: 'completed' | 'voided' | 'cancelled' | string | null;
  attachments?: FinancialAttachment[];
  createdAt?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
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

export interface DetailedPartyLedgerItem {
  rowNumber: number;
  voucherId: number;
  voucherNumber: number;
  manualVoucherNumber?: string;
  date: string;
  description: string;
  accountCode: string;
  accountName: string;
  detailedName?: string;
  detailedType?: string;
  currency: string;
  debit: number;
  credit: number;
  runningBalance: number;
  balanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
  isOpening?: boolean;
}

export interface DetailedPartyLedgerResult {
  party: {
    id?: number;
    name: string;
    partyType: string;
    phone?: string;
    code?: string;
    city?: string;
  } | null;
  openingBalance: number;
  openingBalanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
  finalBalanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
  netStatusText: string;
  items: DetailedPartyLedgerItem[];
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
  /**
   * v8.0.2 (TD-252، تصمیم مالک محصول): اسناد حسابداری پیش‌نویسِ همین سال مالی. تا وقتی هستند بستن سال رد می‌شود؛
   * باید تأیید یا حذف شوند (فهرست حداکثر FISCAL_CLOSING_DRAFT_LIST_LIMIT سند، تعداد کل در draftVoucherCount).
   */
  draftVouchers?: FiscalClosingDraftVoucher[];
  draftVoucherCount?: number;
}

export interface FiscalClosingDraftVoucher {
  id: number;
  voucherNumber: number;
  date: string;
  totalDebit: number;
  description: string;
  sourceDocumentId: number | null;
}

export interface FiscalYearClosingResult {
  success: boolean;
  message: string;
  year: number | string;
  netProfit: number;
  closingVouchers: JournalVoucher[];
}

export type HealthCheckStatus = 'healthy' | 'warning' | 'error';

export interface HealthCheckIssueItem {
  id: number | string;
  code?: string;
  title: string;
  subtitle?: string;
  amount?: number;
  date?: string;
  discrepancy?: number;
  details?: string;
  linkType?: 'voucher' | 'document' | 'cheque' | 'account' | 'bank_account' | 'item';
  linkId?: number | string;
}

export interface HealthCheckTestResult {
  id: string;
  category: 'vouchers' | 'accounts' | 'inventory' | 'documents' | 'treasury' | 'system';
  title: string;
  description: string;
  status: HealthCheckStatus;
  scoreImpact: number;
  count: number;
  message: string;
  quickFixHint?: string;
  quickFixAction?: 'sync_vouchers' | 'recalculate_banks' | 'open_vouchers' | 'open_treasury' | 'open_documents';
  items?: HealthCheckIssueItem[];
  metrics?: Record<string, number | string | boolean>;
}

export interface FinancialHealthReport {
  overallScore: number;
  healthGrade: string;
  healthStatus: HealthCheckStatus;
  scannedAt: string;
  scannedAtJalali: string;
  scanDurationMs: number;
  scannedStats: {
    totalVouchers: number;
    totalVoucherItems: number;
    totalAccounts: number;
    totalDocuments: number;
    totalCheques: number;
    totalItems: number;
  };
  summary: {
    healthyTestsCount: number;
    warningTestsCount: number;
    errorTestsCount: number;
    totalIssuesCount: number;
  };
  tests: HealthCheckTestResult[];
}
