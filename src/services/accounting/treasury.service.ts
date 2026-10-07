import { BankAccountService } from './treasury/bankAccount.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { ChequeLifecycleService } from './treasury/chequeLifecycle.service.js';

/**
 * زیرسرویس خزانه (AGENTS.md §11): حساب‌های بانکی و صندوق‌ها، تراکنش‌های خزانه و چرخه چک صیادی.
 * v7.0.114: لایه واسط تکراری حذف شد؛ هر متد مستقیماً به همان متد زیرسرویس خود وصل است (مانند نمای AccountingService)
 * تا نوع پارامترها فقط یک‌جا، در زیرسرویس، تعریف شود.
 */
export class TreasuryService {
  // 1. Bank Accounts & Cash Funds
  static getBankAccounts = BankAccountService.getBankAccounts.bind(BankAccountService);
  static recalculateAndSyncBankBalances = BankAccountService.recalculateAndSyncBankBalances.bind(BankAccountService);
  static getBankReconciliationReport = BankAccountService.getBankReconciliationReport.bind(BankAccountService);
  static generateNextAccountCode = BankAccountService.generateNextAccountCode.bind(BankAccountService);
  static createBankAccount = BankAccountService.createBankAccount.bind(BankAccountService);
  static updateBankAccount = BankAccountService.updateBankAccount.bind(BankAccountService);
  static deleteBankAccount = BankAccountService.deleteBankAccount.bind(BankAccountService);

  // 2. Treasury Transactions
  static getTreasuryTransactions = TreasuryTransactionService.getTreasuryTransactions.bind(TreasuryTransactionService);
  static getTreasuryTransactionPage = TreasuryTransactionService.getTreasuryTransactionPage.bind(TreasuryTransactionService);
  static generateTransactionNumber = TreasuryTransactionService.generateTransactionNumber.bind(TreasuryTransactionService);
  static createTreasuryTransaction = TreasuryTransactionService.createTreasuryTransaction.bind(TreasuryTransactionService);
  static createTreasuryTransfer = TreasuryTransactionService.createTreasuryTransfer.bind(TreasuryTransactionService);
  static voidTreasuryTransaction = TreasuryTransactionService.voidTreasuryTransaction.bind(TreasuryTransactionService);
  static reconcileTransactions = TreasuryTransactionService.reconcileTransactions.bind(TreasuryTransactionService);
  static previewTreasuryVoucher = TreasuryTransactionService.previewTreasuryVoucher.bind(TreasuryTransactionService);

  // 3. Cheques & Sayad Lifecycle
  static getCheques = ChequeLifecycleService.getCheques.bind(ChequeLifecycleService);
  static createCheque = ChequeLifecycleService.createCheque.bind(ChequeLifecycleService);
  static updateChequeStatus = ChequeLifecycleService.updateChequeStatus.bind(ChequeLifecycleService);
  static deleteCheque = ChequeLifecycleService.deleteCheque.bind(ChequeLifecycleService);
}
