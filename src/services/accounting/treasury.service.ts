import { BankAccountService } from './treasury/bankAccount.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { ChequeLifecycleService } from './treasury/chequeLifecycle.service.js';
import type { BankAccount, TreasuryTransaction, Cheque, ChequeStatus } from '../../types.js';
import type { DbExecutor } from '../../db/drizzle.js';

export class TreasuryService {
  // 1. Bank Accounts & Cash Funds
  static async getBankAccounts(): Promise<BankAccount[]> {
    return BankAccountService.getBankAccounts();
  }

  static async recalculateAndSyncBankBalances() {
    return BankAccountService.recalculateAndSyncBankBalances();
  }

  static async createBankAccount(data: {
    code: string;
    title: string;
    type: 'bank' | 'cash' | 'pos' | 'petty_cash';
    bankName?: string;
    accountNumber?: string;
    shebaNumber?: string;
    cardNumber?: string;
    branch?: string;
    initialBalance?: number;
    currency?: string;
    accountId?: number | null;
    notes?: string;
  }): Promise<BankAccount> {
    return BankAccountService.createBankAccount(data);
  }

  static async updateBankAccount(id: number, data: Partial<{
    title: string;
    code: string;
    type: 'bank' | 'cash' | 'pos' | 'petty_cash';
    bankName: string;
    accountNumber: string;
    shebaNumber: string;
    cardNumber: string;
    branch: string;
    accountId: number | null;
    isActive: number;
    notes: string;
  }>): Promise<BankAccount> {
    return BankAccountService.updateBankAccount(id, data);
  }

  static async deleteBankAccount(id: number): Promise<{ success: boolean }> {
    return BankAccountService.deleteBankAccount(id);
  }

  // 2. Treasury Transactions
  static async getTreasuryTransactions(params: {
    type?: 'receipt' | 'payment';
    bankAccountId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<TreasuryTransaction[]> {
    return TreasuryTransactionService.getTreasuryTransactions(params);
  }

  static async generateTransactionNumber(type: 'receipt' | 'payment', tx?: DbExecutor): Promise<string> {
    return TreasuryTransactionService.generateTransactionNumber(type, tx);
  }

  static async createTreasuryTransaction(data: {
    type: 'receipt' | 'payment';
    date: string;
    method: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
    amount: number;
    currency?: string;
    exchangeRate?: number;
    bankAccountId: number;
    partyType?: 'customer' | 'personnel' | 'supplier' | 'other';
    partyId?: number | null;
    partyName: string;
    trackingNumber?: string;
    documentId?: number | null;
    description?: string;
    userId?: number;
    username?: string;
    createVoucher?: boolean;
  }): Promise<TreasuryTransaction> {
    return TreasuryTransactionService.createTreasuryTransaction(data);
  }

  // V1.5.0: انتقال بین‌بانکی/بین‌صندوقی
  static async createTreasuryTransfer(data: {
    date: string;
    amount: number;
    currency?: string;
    fromBankAccountId: number;
    toBankAccountId: number;
    trackingNumber?: string;
    description?: string;
    userId?: number;
    username?: string;
    createVoucher?: boolean;
  }): Promise<{ payment: TreasuryTransaction; receipt: TreasuryTransaction; voucherId: number | null }> {
    return TreasuryTransactionService.createTreasuryTransfer(data);
  }

  // V1.4.0: ابطال تراکنش با سند معکوس (DB-009)
  static async voidTreasuryTransaction(id: number, params: {
    reason: string;
    userId?: number;
    username?: string;
  }): Promise<TreasuryTransaction> {
    return TreasuryTransactionService.voidTreasuryTransaction(id, params);
  }

  // V1.6.0: آشتی‌سنجی بانکی — ثبت گروهی وضعیت تطبیق
  static async reconcileTransactions(params: {
    bankAccountId: number;
    txIds: number[];
    batch: string;
    reconciled: boolean;
    userId?: number;
    username?: string;
  }): Promise<{ success: boolean; updated: number }> {
    return TreasuryTransactionService.reconcileTransactions(params);
  }

  // V1.8.0: پیش‌نمایش سند دوبل (بدون ذخیره‌سازی)
  static async previewTreasuryVoucher(data: {
    type: 'receipt' | 'payment';
    amount: number;
    currency?: string;
    bankAccountId: number;
    partyType?: string;
    purpose?: string;
    partyId?: number | null;
    partyName?: string;
  }) {
    return TreasuryTransactionService.previewTreasuryVoucher(data);
  }

  // 3. Cheques & Sayad Lifecycle
  static async getCheques(params: {
    type?: 'received' | 'paid';
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<Cheque[]> {
    return ChequeLifecycleService.getCheques(params);
  }

  static async createCheque(data: {
    type: 'received' | 'paid';
    chequeNumber: string;
    sayadNumber?: string;
    bankName: string;
    branch?: string;
    issueDate: string;
    dueDate: string;
    amount: number;
    currency?: string;
    partyType?: 'customer' | 'personnel' | 'supplier' | 'other';
    partyId?: number | null;
    partyName: string;
    drawerName?: string;
    payeeName?: string;
    bankAccountId?: number | null;
    description?: string;
    userId?: number;
    username?: string;
    createVoucher?: boolean;
  }): Promise<Cheque> {
    return ChequeLifecycleService.createCheque(data);
  }

  static async updateChequeStatus(id: number, data: {
    status: ChequeStatus;
    actionDate?: string;
    bankAccountId?: number | null;
    notes?: string;
    userId?: number;
    username?: string;
  }): Promise<Cheque> {
    return ChequeLifecycleService.updateChequeStatus(id, data);
  }

  static async deleteCheque(id: number, user?: { userId?: number; username?: string }): Promise<{ success: boolean }> {
    return ChequeLifecycleService.deleteCheque(id, user);
  }
}
