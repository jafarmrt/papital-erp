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
  isDeleted?: number;
  is_deleted?: number;
  createdAt?: string;
  created_at?: string;
  items?: JournalVoucherItem[];
  attachments?: FinancialAttachment[];
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
  description?: string;
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
  attachments?: FinancialAttachment[];
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
  payrollId?: number | null;
  payroll_id?: number | null;
  // V1.4.0: ابطال با سند معکوس
  reversalOfId?: number | null;
  reversal_of_id?: number | null;
  // V1.5.0: هویت ثبت‌کننده
  createdById?: number | null;
  created_by_id?: number | null;
  creatorName?: string;
  // V1.6.0: آشتی‌سنجی بانکی
  reconciled?: number;
  reconciledAt?: string;
  reconciledBatch?: string;
  purpose?: string;
  description?: string;
  status?: 'completed' | 'voided' | 'cancelled';
  attachments?: FinancialAttachment[];
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
