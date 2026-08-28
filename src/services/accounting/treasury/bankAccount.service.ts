import { orm } from '../../../db/drizzle.js';
import { accounts, bankAccounts, treasuryTransactions, journalVouchers, journalVoucherItems } from '../../../db/schema.js';
import { eq, asc, and, or } from 'drizzle-orm';
import type { BankAccount } from '../../../types.js';
import { NotFoundError, BusinessLogicError } from '../../../errors/customErrors.js';

export class BankAccountService {
  static async getBankAccounts(): Promise<BankAccount[]> {
    const rawList = await orm.select({
      id: bankAccounts.id,
      code: bankAccounts.code,
      title: bankAccounts.title,
      type: bankAccounts.type,
      bankName: bankAccounts.bankName,
      accountNumber: bankAccounts.accountNumber,
      shebaNumber: bankAccounts.shebaNumber,
      cardNumber: bankAccounts.cardNumber,
      branch: bankAccounts.branch,
      initialBalance: bankAccounts.initialBalance,
      currentBalance: bankAccounts.currentBalance,
      currency: bankAccounts.currency,
      accountId: bankAccounts.accountId,
      accountName: accounts.name,
      accountCode: accounts.code,
      isActive: bankAccounts.isActive,
      notes: bankAccounts.notes,
      createdAt: bankAccounts.createdAt,
    })
    .from(bankAccounts)
    .leftJoin(accounts, eq(accounts.id, bankAccounts.accountId))
    .where(eq(bankAccounts.isDeleted, 0))
    .orderBy(asc(bankAccounts.code));

    // 1. Fetch all approved/permanent journal voucher items
    const vItems = await orm.select({
      id: journalVoucherItems.id,
      accountId: journalVoucherItems.accountId,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(
      eq(journalVouchers.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ));

    // 2. Fetch all completed treasury transactions
    const rawTxs = await orm.select({
      bankAccountId: treasuryTransactions.bankAccountId,
      type: treasuryTransactions.type,
      amount: treasuryTransactions.amount,
    })
    .from(treasuryTransactions)
    .where(eq(treasuryTransactions.isDeleted, 0));

    return rawList.map(b => {
      const initBal = Number(b.initialBalance) || 0;

      // Match journal items for this bank account (deduplicated by item id)
      const matchingItemsMap = new Map<number, typeof vItems[0]>();
      for (const it of vItems) {
        const matchesAccount = Boolean(b.accountId && it.accountId === b.accountId);
        const matchesDetailed = Boolean(it.detailedType === 'bank_account' && it.detailedId === b.id);
        if (matchesAccount || matchesDetailed) {
          matchingItemsMap.set(it.id, it);
        }
      }

      let totalDebit = 0;
      let totalCredit = 0;
      for (const it of matchingItemsMap.values()) {
        totalDebit += Number(it.debit) || 0;
        totalCredit += Number(it.credit) || 0;
      }

      // Match treasury transactions
      let receipts = 0;
      let payments = 0;
      for (const tx of rawTxs) {
        if (tx.bankAccountId === b.id) {
          if (tx.type === 'receipt') {
            receipts += Number(tx.amount) || 0;
          } else if (tx.type === 'payment') {
            payments += Number(tx.amount) || 0;
          }
        }
      }

      const treasuryBalance = initBal + receipts - payments;
      const ledgerBalance = initBal + totalDebit - totalCredit;
      const discrepancy = Math.abs(ledgerBalance - treasuryBalance);

      let syncStatus: 'synced' | 'discrepant' | 'unlinked' = 'synced';
      let dynamicCurrentBalance = ledgerBalance;

      if (!b.accountId && totalDebit === 0 && totalCredit === 0) {
        syncStatus = 'unlinked';
        dynamicCurrentBalance = treasuryBalance;
      } else if (discrepancy < 0.01) {
        syncStatus = 'synced';
        dynamicCurrentBalance = ledgerBalance;
      } else {
        syncStatus = 'discrepant';
        dynamicCurrentBalance = (totalDebit > 0 || totalCredit > 0) ? ledgerBalance : treasuryBalance;
      }

      return {
        ...b,
        type: b.type as BankAccount['type'],
        initialBalance: initBal,
        currentBalance: dynamicCurrentBalance,
        ledgerBalance,
        treasuryBalance,
        totalDebit,
        totalCredit,
        discrepancy,
        syncStatus,
        bank_name: b.bankName || '',
        account_number: b.accountNumber || '',
        sheba_number: b.shebaNumber || '',
        card_number: b.cardNumber || '',
        initial_balance: initBal,
        current_balance: dynamicCurrentBalance,
        account_id: b.accountId,
        account_name: b.accountName || undefined,
        account_code: b.accountCode || undefined,
        is_active: b.isActive ?? 1,
      };
    });
  }

  static async recalculateAndSyncBankBalances(): Promise<{
    syncedCount: number;
    discrepantCount: number;
    unlinkedCount: number;
    totalCashAndBankLedger: number;
    totalCashAndBankTreasury: number;
    totalDiscrepancy: number;
    accounts: any[];
  }> {
    const banks = await this.getBankAccounts();
    let syncedCount = 0;
    let discrepantCount = 0;
    let unlinkedCount = 0;
    let totalCashAndBankLedger = 0;
    let totalCashAndBankTreasury = 0;
    let totalDiscrepancy = 0;

    for (const bank of banks) {
      await orm.update(bankAccounts).set({
        currentBalance: bank.currentBalance
      }).where(eq(bankAccounts.id, bank.id));

      totalCashAndBankLedger += (bank.ledgerBalance || 0);
      totalCashAndBankTreasury += (bank.treasuryBalance || 0);
      totalDiscrepancy += (bank.discrepancy || 0);

      if (bank.syncStatus === 'synced') syncedCount++;
      else if (bank.syncStatus === 'discrepant') discrepantCount++;
      else unlinkedCount++;
    }

    return {
      syncedCount,
      discrepantCount,
      unlinkedCount,
      totalCashAndBankLedger,
      totalCashAndBankTreasury,
      totalDiscrepancy,
      accounts: banks.map(b => ({
        id: b.id,
        code: b.code,
        title: b.title,
        type: b.type,
        accountCode: b.accountCode,
        accountName: b.accountName,
        initialBalance: b.initialBalance || 0,
        ledgerBalance: b.ledgerBalance || 0,
        treasuryBalance: b.treasuryBalance || 0,
        currentBalance: b.currentBalance || 0,
        totalDebit: b.totalDebit || 0,
        totalCredit: b.totalCredit || 0,
        discrepancy: b.discrepancy || 0,
        syncStatus: b.syncStatus || 'synced',
        notes: b.notes,
      }))
    };
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
    const initialBal = Number(data.initialBalance) || 0;
    const [inserted] = await orm.insert(bankAccounts).values({
      code: data.code.trim(),
      title: data.title.trim(),
      type: data.type,
      bankName: data.bankName?.trim() || '',
      accountNumber: data.accountNumber?.trim() || '',
      shebaNumber: data.shebaNumber?.trim() || '',
      cardNumber: data.cardNumber?.trim() || '',
      branch: data.branch?.trim() || '',
      initialBalance: initialBal,
      currentBalance: initialBal,
      currency: data.currency || 'IRR',
      accountId: data.accountId || null,
      isActive: 1,
      notes: data.notes?.trim() || '',
    }).returning();

    return {
      ...inserted,
      type: inserted.type as BankAccount['type'],
    };
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
    const [existing] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    if (!existing) throw new NotFoundError('حساب بانکی یا صندوق یافت نشد');

    const [updated] = await orm.update(bankAccounts).set({
      ...(data.title ? { title: data.title.trim() } : {}),
      ...(data.code ? { code: data.code.trim() } : {}),
      ...(data.type ? { type: data.type } : {}),
      ...(data.bankName !== undefined ? { bankName: data.bankName.trim() } : {}),
      ...(data.accountNumber !== undefined ? { accountNumber: data.accountNumber.trim() } : {}),
      ...(data.shebaNumber !== undefined ? { shebaNumber: data.shebaNumber.trim() } : {}),
      ...(data.cardNumber !== undefined ? { cardNumber: data.cardNumber.trim() } : {}),
      ...(data.branch !== undefined ? { branch: data.branch.trim() } : {}),
      ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.notes !== undefined ? { notes: data.notes.trim() } : {}),
    }).where(eq(bankAccounts.id, id)).returning();

    return {
      ...updated,
      type: updated.type as BankAccount['type'],
    };
  }

  static async deleteBankAccount(id: number): Promise<{ success: boolean }> {
    const [existing] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    if (!existing) throw new NotFoundError('حساب بانکی یا صندوق یافت نشد');

    const hasTx = await orm.select().from(treasuryTransactions).where(eq(treasuryTransactions.bankAccountId, id)).limit(1);
    if (hasTx.length > 0) {
      throw new BusinessLogicError('برای این حساب بانکی/صندوق تراکنش ثبت شده است و امکان حذف آن وجود ندارد');
    }

    await orm.update(bankAccounts).set({ isDeleted: 1 }).where(eq(bankAccounts.id, id));
    return { success: true };
  }
}
