import {
  ChartOfAccountsService,
  VoucherService,
  TreasuryService,
  AccountingReportService,
  VoucherSyncService,
  FiscalYearService,
  AccountMappingService
} from './accounting/index.js';
import type {
  Account,
  JournalVoucher,
  BankAccount,
  Cheque,
  ChequeStatus,
  TreasuryTransaction,
  TrialBalanceRow,
  FinancialSummaryStats,
  FiscalYearClosingPreview,
  FiscalYearClosingResult
} from '../types.js';

export {
  ChartOfAccountsService,
  VoucherService,
  TreasuryService,
  AccountingReportService,
  VoucherSyncService,
  FiscalYearService,
  AccountMappingService
};

/**
 * AccountingService Facade
 * Provides a unified backwards-compatible entry point for all modular accounting subservices.
 */
export class AccountingService {
  // ================= Chart of Accounts =================
  static seedStandardAccounts = ChartOfAccountsService.seedStandardAccounts.bind(ChartOfAccountsService);
  static getAllAccounts = ChartOfAccountsService.getAllAccounts.bind(ChartOfAccountsService);
  static getAccountsTree = ChartOfAccountsService.getAccountsTree.bind(ChartOfAccountsService);
  static createAccount = ChartOfAccountsService.createAccount.bind(ChartOfAccountsService);
  static updateAccount = ChartOfAccountsService.updateAccount.bind(ChartOfAccountsService);
  static deleteAccount = ChartOfAccountsService.deleteAccount.bind(ChartOfAccountsService);

  // ================= Account Mappings & Concepts =================
  static getAccountMappings = AccountMappingService.getMappings.bind(AccountMappingService);
  static saveAccountMappings = AccountMappingService.saveMappings.bind(AccountMappingService);
  static resolveConceptualAccount = AccountMappingService.resolveAccount.bind(AccountMappingService);

  // ================= Journal Vouchers =================
  static getNextVoucherNumber = VoucherService.getNextVoucherNumber.bind(VoucherService);
  static getJournalVouchers = VoucherService.getJournalVouchers.bind(VoucherService);
  static getJournalVoucherById = VoucherService.getJournalVoucherById.bind(VoucherService);
  static createJournalVoucher = VoucherService.createJournalVoucher.bind(VoucherService);
  static updateJournalVoucher = VoucherService.updateJournalVoucher.bind(VoucherService);
  static deleteJournalVoucher = VoucherService.deleteJournalVoucher.bind(VoucherService);
  static reverseVoucher = VoucherService.reverseVoucher.bind(VoucherService);
  static correctVoucher = VoucherService.correctVoucher.bind(VoucherService);
  static repostVoucher = VoucherService.repostVoucher.bind(VoucherService);
  static finalizeJournalVoucher = VoucherService.finalizeJournalVoucher.bind(VoucherService);
  static finalizeJournalVouchers = VoucherService.finalizeJournalVouchers.bind(VoucherService);
  static setVoucherStatus = VoucherService.setVoucherStatus.bind(VoucherService);
  static checkFiscalPeriodOpen = VoucherService.checkFiscalPeriodOpen.bind(VoucherService);
  static isPeriodClosed = VoucherService.isPeriodClosed.bind(VoucherService);

  // ================= Treasury & Bank Accounts =================
  static getBankAccounts = TreasuryService.getBankAccounts.bind(TreasuryService);
  static recalculateAndSyncBankBalances = TreasuryService.recalculateAndSyncBankBalances.bind(TreasuryService);
  static createBankAccount = TreasuryService.createBankAccount.bind(TreasuryService);
  static updateBankAccount = TreasuryService.updateBankAccount.bind(TreasuryService);
  static deleteBankAccount = TreasuryService.deleteBankAccount.bind(TreasuryService);
  static getTreasuryTransactions = TreasuryService.getTreasuryTransactions.bind(TreasuryService);
  static generateTransactionNumber = TreasuryService.generateTransactionNumber.bind(TreasuryService);
  static createTreasuryTransaction = TreasuryService.createTreasuryTransaction.bind(TreasuryService);
  static voidTreasuryTransaction = TreasuryService.voidTreasuryTransaction.bind(TreasuryService);
  static createTreasuryTransfer = TreasuryService.createTreasuryTransfer.bind(TreasuryService);

  // ================= Cheques Management =================
  static getCheques = TreasuryService.getCheques.bind(TreasuryService);
  static createCheque = TreasuryService.createCheque.bind(TreasuryService);
  static updateChequeStatus = TreasuryService.updateChequeStatus.bind(TreasuryService);
  static deleteCheque = TreasuryService.deleteCheque.bind(TreasuryService);

  // ================= Financial & Accounting Reports =================
  static getTrialBalance = AccountingReportService.getTrialBalance.bind(AccountingReportService);
  static getDetailedAccountCard = AccountingReportService.getDetailedAccountCard.bind(AccountingReportService);
  static getJournalBook = AccountingReportService.getJournalBook.bind(AccountingReportService);
  static getFinancialRatios = AccountingReportService.getFinancialRatios.bind(AccountingReportService);
  static getIncomeStatement = AccountingReportService.getIncomeStatement.bind(AccountingReportService);
  static getBalanceSheet = AccountingReportService.getBalanceSheet.bind(AccountingReportService);
  static getMultiCurrencySummary = AccountingReportService.getMultiCurrencySummary.bind(AccountingReportService);
  static getFinancialOverviewStats = AccountingReportService.getFinancialOverviewStats.bind(AccountingReportService);

  // ================= Voucher Auto-Sync Engine =================
  static autoCreateVoucherForInvoice = VoucherSyncService.autoCreateVoucherForInvoice.bind(VoucherSyncService);
  static autoCreateVoucherForPayroll = VoucherSyncService.autoCreateVoucherForPayroll.bind(VoucherSyncService);
  static syncSalesInvoiceVoucher = VoucherSyncService.syncSalesInvoiceVoucher.bind(VoucherSyncService);
  static syncPurchaseInvoiceVoucher = VoucherSyncService.syncPurchaseInvoiceVoucher.bind(VoucherSyncService);
  static syncWarehouseDocumentVoucher = VoucherSyncService.syncWarehouseDocumentVoucher.bind(VoucherSyncService);
  static syncAllInvoiceVouchers = VoucherSyncService.syncAllInvoiceVouchers.bind(VoucherSyncService);

  // ================= Fiscal Year Closing =================
  static getFiscalYearClosingPreview = FiscalYearService.getFiscalYearClosingPreview.bind(FiscalYearService);
  static executeFiscalYearClosing = FiscalYearService.executeFiscalYearClosing.bind(FiscalYearService);
}
