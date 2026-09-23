import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts, bankAccounts, treasuryTransactions, journalVouchers, journalVoucherItems } from '../../../db/schema.js';
import { eq, asc, and, or } from 'drizzle-orm';
import type { BankAccount } from '../../../types.js';
import { NotFoundError, BusinessLogicError, ValidationError } from '../../../errors/customErrors.js';
import { AccountMappingService } from '../accountMapping.service.js';
import { VoucherService } from '../voucher.service.js';
import { businessTodayJalaliDash } from '../../../lib/businessClock.js';
import type { JournalVoucher } from '../../../types.js';

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

    // V2.0.0: حساب‌هایی که سند افتتاحیه دارند — مانده اولیه در دفتر ثبت شده و
    // نباید در محاسبه ledgerBalance دوباره اضافه شود (جلوگیری از دوبرابرشماری)
    const openingVoucherBanks = new Set<number>();
    const openingVouchers = await orm.select({
      referenceId: journalVouchers.referenceId,
    })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.referenceModule, 'treasury_opening'),
      eq(journalVouchers.isDeleted, 0)
    ));
    for (const ov of openingVouchers) {
      if (ov.referenceId) openingVoucherBanks.add(Number(ov.referenceId));
    }

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
      // V2.0.0: اگر سند افتتاحیه برای این حساب صادر شده، مانده اولیه داخل دفتر است
      // و دیگر به ledgerBalance اضافه نمی‌شود (حساب‌های قدیمیِ بدون سند با فرمول قدیمی)
      const hasOpeningVoucher = openingVoucherBanks.has(b.id);
      const ledgerBalance = (hasOpeningVoucher ? 0 : initBal) + totalDebit - totalCredit;
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
    accounts: BankAccount[];
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

  /**
   * V4.0.37: تولید خودکار کد یکتا و استاندارد حساب خزانه بر اساس نوع (BANK-01, CASH-01, POS-01)
   */
  static async generateNextAccountCode(type: 'bank' | 'cash' | 'pos' | 'petty_cash', tx?: DbExecutor): Promise<string> {
    const executor = tx || orm;
    const existing = await executor
      .select({ code: bankAccounts.code })
      .from(bankAccounts);

    const prefix = type === 'cash' || type === 'petty_cash' ? 'CASH' : type === 'pos' ? 'POS' : 'BANK';
    let maxNum = 0;
    const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');

    for (const row of existing) {
      if (!row.code) continue;
      const match = row.code.trim().match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const nextNum = maxNum + 1;
    return `${prefix}-${String(nextNum).padStart(2, '0')}`;
  }

  static async createBankAccount(data: {
    code?: string;
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
    userId?: number;
    username?: string;
    strict?: boolean;
  }, externalTx?: DbExecutor): Promise<BankAccount> {
    const initialBal = Number(data.initialBalance) || 0;
    const isStrict = data.strict !== false;

    // V4.0.5 (F-3 / TD-093): قانون صریح — اگر موجودی اولیه غیرصفر باشد، انتساب به سرفصل معین حسابداری برای صدور سند افتتاحیه الزامی است
    if (initialBal !== 0 && !data.accountId && isStrict) {
      throw new ValidationError('برای ثبت حساب بانکی یا صندوق با موجودی اولیه غیرصفر، انتخاب سرفصل معین حسابداری الزامی است.');
    }

    const run = async (tx: DbExecutor) => {
      let finalCode = data.code?.trim();
      if (!finalCode) {
        finalCode = await BankAccountService.generateNextAccountCode(data.type, tx);
      }

      const [inserted] = await tx.insert(bankAccounts).values({
        code: finalCode,
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

      // V2.0.0: سند افتتاحیه موجودی اولیه — DR معین بانک / CR سرمایه اولیه (4001)
      // ورکفلو شرطی: اگر تعریف workflow فعال برای «bank_account» باشد، سند پس از تأیید نهایی صادر می‌شود
      if (initialBal !== 0) {
        const { WorkflowEngineService } = await import('../../workflow/workflowEngineService.js');
        const wfInstance = await WorkflowEngineService.maybeStartWorkflow({
          entityType: 'bank_account',
          entityId: String(inserted.id),
          userId: data.userId,
          userName: data.username
        });
        if (!wfInstance) {
          await this.issueTreasuryOpeningVoucher(inserted.id, {
            userId: data.userId,
            username: data.username,
            tx,
            strict: isStrict
          });
        }
      }

      return {
        ...inserted,
        type: inserted.type as BankAccount['type'],
      };
    };

    if (externalTx) {
      return run(externalTx);
    }
    return orm.transaction(run);
  }

  /**
   * V2.0.0: سند افتتاحیه موجودی اولیه حساب خزانه — اتمیک و idempotent
   * DR معین بانک (linked account) / CR سرمایه اولیه (4001)
   */
  static async issueTreasuryOpeningVoucher(bankId: number, params: {
    userId?: number;
    username?: string;
    tx?: DbExecutor;
    strict?: boolean;
  } = {}): Promise<JournalVoucher | null> {
    const executor = params.tx || orm;
    const isStrict = params.strict !== false;
    const [bank] = await executor.select().from(bankAccounts).where(eq(bankAccounts.id, bankId));
    if (!bank || bank.isDeleted === 1) {
      if (isStrict) throw new NotFoundError(`حساب بانکی یا صندوق با شناسه ${bankId} یافت نشد.`);
      return null;
    }

    const initialBal = Number(bank.initialBalance) || 0;
    if (initialBal === 0) return null; // بدون مانده — سند نیاز ندارد
    if (!bank.accountId) {
      if (isStrict) {
        throw new ValidationError(`حساب «${bank.title}» دارای موجودی اولیه است اما به سرفصل معین حسابداری متصل نشده است.`);
      }
      return null;
    }

    // idempotency: سند افتتاحیه قبلی؟
    const [existing] = await executor.select({ id: journalVouchers.id })
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'treasury_opening'),
        eq(journalVouchers.referenceId, bankId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existing) return VoucherService.getJournalVoucherById(existing.id, params.tx);

    const capitalAcc = await AccountMappingService.getOpeningCapitalAccount(params.tx);
    if (!capitalAcc) {
      throw new ValidationError('حساب «سرمایه اولیه» (4001) برای صدور سند افتتاحیه یافت نشد — از تنظیمات ← تنظیمات حسابداری پیکربندی کنید.');
    }

    const amount = Math.abs(initialBal);
    const isDebitBank = initialBal > 0; // موجودی مثبت = بدهکار بانک

    const created = await VoucherService.createJournalVoucher({
      date: await businessTodayJalaliDash(),
      voucherType: 'opening',
      status: 'draft',
      description: `سند افتتاحیه موجودی اولیه ${bank.title} (${bank.type === 'bank' ? 'حساب بانکی' : 'صندوق'})`,
      referenceModule: 'treasury_opening',
      referenceId: bankId,
      referenceNumber: bank.code,
      currency: bank.currency || 'IRR',
      userId: params.userId,
      username: params.username,
      items: [
        {
          accountId: bank.accountId,
          detailedType: 'bank_account',
          detailedId: bank.id,
          detailedName: bank.title,
          debit: isDebitBank ? amount : 0,
          credit: isDebitBank ? 0 : amount,
          currency: bank.currency || 'IRR',
          description: `موجودی اولیه ${bank.title}`
        },
        {
          accountId: capitalAcc.id,
          detailedType: 'other',
          detailedName: 'سرمایه اولیه',
          debit: isDebitBank ? 0 : amount,
          credit: isDebitBank ? amount : 0,
          currency: bank.currency || 'IRR',
          description: `ثبت موجودی اولیه ${bank.title} در سرمایه`
        }
      ]
    }, params.tx);

    if (!created && isStrict) {
      throw new ValidationError(`صدور سند افتتاحیه برای حساب «${bank.title}» ناموفق بود.`);
    }

    return created;
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
    initialBalance: number;
    accountId: number | null;
    isActive: number;
    notes: string;
    userId?: number;
    username?: string;
    strict?: boolean;
  }>, externalTx?: DbExecutor): Promise<BankAccount> {
    const isStrict = data.strict !== false;

    const run = async (tx: DbExecutor) => {
      const [existing] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, id));
      if (!existing) throw new NotFoundError('حساب بانکی یا صندوق یافت نشد');

      const [updated] = await tx.update(bankAccounts).set({
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

      // V2.0.0: تغییر موجودی اولیه → سند اصلاحی مابه‌التفاوت (فقط برای حساب‌های کدینگ‌شده)
      if (data.initialBalance !== undefined) {
        const newInitial = Number(data.initialBalance) || 0;
        const oldInitial = Number(existing.initialBalance) || 0;
        const delta = Math.round((newInitial - oldInitial) * 10000) / 10000;
        // اصلاح currentBalance با دلتا
        if (delta !== 0) {
          const newCur = Math.round(((Number(updated.currentBalance) || 0) + delta) * 10000) / 10000;
          await tx.update(bankAccounts).set({ currentBalance: newCur, initialBalance: newInitial }).where(eq(bankAccounts.id, id));
        }
        if (delta !== 0) {
          if (!updated.accountId && isStrict) {
            throw new ValidationError('برای به‌روزرسانی موجودی اولیه حساب خزانه، اتصال به سرفصل معین حسابداری الزامی است.');
          }

          if (updated.accountId) {
            const [openingVoucher] = await tx.select({ id: journalVouchers.id })
              .from(journalVouchers)
              .where(and(
                eq(journalVouchers.referenceModule, 'treasury_opening'),
                eq(journalVouchers.referenceId, id),
                eq(journalVouchers.isDeleted, 0)
              ));
            if (openingVoucher) {
              // سند افتتاحیه قبلی موجود است → سند اصلاحی مابه‌التفاوت
              const capitalAcc = await AccountMappingService.getOpeningCapitalAccount(tx);
              if (!capitalAcc) {
                throw new ValidationError('حساب «سرمایه اولیه» (4001) برای اصلاح سند افتتاحیه یافت نشد — از تنظیمات حسابداری پیکربندی کنید.');
              }
              const amount = Math.abs(delta);
              const adjVoucher = await VoucherService.createJournalVoucher({
                date: await businessTodayJalaliDash(),
                voucherType: 'adjustment',
                status: 'draft',
                description: `اصلاح موجودی اولیه ${updated.title} (${delta > 0 ? '+' : ''}${delta})`,
                referenceModule: 'treasury_opening',
                referenceId: id,
                referenceNumber: updated.code,
                currency: updated.currency || 'IRR',
                userId: data.userId,
                username: data.username,
                items: [
                  {
                    accountId: updated.accountId!,
                    detailedType: 'bank_account',
                    detailedId: id,
                    detailedName: updated.title,
                    debit: delta > 0 ? amount : 0,
                    credit: delta > 0 ? 0 : amount,
                    currency: updated.currency || 'IRR',
                    description: `اصلاح موجودی اولیه ${updated.title}`
                  },
                  {
                    accountId: capitalAcc.id,
                    detailedType: 'other',
                    detailedName: 'سرمایه اولیه',
                    debit: delta > 0 ? 0 : amount,
                    credit: delta > 0 ? amount : 0,
                    currency: updated.currency || 'IRR',
                    description: `اصلاح سهم سرمایه بابت موجودی اولیه ${updated.title}`
                  }
                ]
              }, tx);

              if (!adjVoucher && isStrict) {
                throw new ValidationError(`ثبت سند اصلاحی موجودی اولیه برای حساب «${updated.title}» ناموفق بود.`);
              }
            } else if (newInitial !== 0) {
              // حساب قدیمی بدون سند افتتاحیه → اکنون سند افتتاحیه صادر کن
              await this.issueTreasuryOpeningVoucher(id, {
                userId: data.userId,
                username: data.username,
                tx,
                strict: isStrict
              });
            }
          }
        }
      }

      return {
        ...updated,
        type: updated.type as BankAccount['type'],
      };
    };

    if (externalTx) {
      return run(externalTx);
    }
    return orm.transaction(run);
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
