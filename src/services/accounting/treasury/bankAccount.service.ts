import { terminateOpenWorkflows } from '../../workflow/workflowTermination.js';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts, bankAccounts, cheques, treasuryTransactions, journalVouchers, journalVoucherItems } from '../../../db/schema.js';
import { eq, asc, and, or, ne } from 'drizzle-orm';
import type { BankAccount } from '../../../types.js';
import { NotFoundError, BusinessLogicError, ValidationError } from '../../../errors/customErrors.js';
import { AccountMappingService } from '../accountMapping.service.js';
import { VoucherService } from '../voucher.service.js';
import { businessTodayJalaliDash } from '../../../lib/businessClock.js';
import type { JournalVoucher } from '../../../types.js';
import { fin } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import { assertNoPendingOpeningApproval, voidBankOpeningVouchers } from './bankOpeningVoucher.js';
import { assertBankCurrencyChangeAllowed, requireTreasuryCurrency } from './bankAccountCurrency.js';
import { assignTreasuryAccountCode, peekNextTreasuryAccountCode, type TreasuryAccountType } from './bankAccountCode.js';

/** گزارش تطبیق مانده حساب‌های خزانه با دفاتر (sync-reconcile و reconciliation-report) */
export interface BankReconciliationReport {
  syncedCount: number;
  discrepantCount: number;
  unlinkedCount: number;
  totalCashAndBankLedger: number;
  totalCashAndBankTreasury: number;
  totalDiscrepancy: number;
  accounts: BankAccount[];
}

export class BankAccountService {
  /**
   * v7.0.67 (P2-6): مانده‌ها با Decimal محاسبه می‌شوند؛ خروجی API (getBankAccounts) عدد است.
   *
   * v8.0.74 (TD-340، تصمیم مالک محصول — گزینه الف «از تراکنش‌ها»): مانده جاری هر حساب، مانده خزانه است (مانده اول دوره +
   * تراکنش‌های خزانه + چک‌های وصول‌شده)؛ مانده دفتر کل فقط برای گزارش اختلاف است. پیش‌تر مانده جاری حساب سرفصل‌دار همان
   * مانده دفتر کل بود (بی اسناد پیش‌نویس)، و ردیف سرفصل مشترک چند بانک در مانده دفتری همه آن‌ها شمرده می‌شد.
   */
  private static async computeBankBalances(db: DbExecutor = orm) {
    const rawList = await db.select({
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
    const vItems = await db.select({
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
      // v8.0.15 (TD-270): ردیف حذف نرم‌شده (ویرایش سند پیش‌نویس پیش از تأیید) در مانده دفتری شمرده نمی‌شود
      eq(journalVoucherItems.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ));

    // 2. Fetch all completed treasury transactions
    // v8.0.26 (TD-278): تراکنش‌های پیشین با روش «چک» (و معکوس ابطال آن‌ها) پول حساب را جابه‌جا نکرده‌اند — مانده حساب
    // تغییر نکرد و سندشان اسناد دریافتنی/پرداختنی را گرفت — پس در مانده خزانه حساب شمرده نمی‌شوند.
    const rawTxs = await db.select({
      bankAccountId: treasuryTransactions.bankAccountId,
      type: treasuryTransactions.type,
      amount: treasuryTransactions.amount,
    })
    .from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.isDeleted, 0), ne(treasuryTransactions.method, 'cheque')));

    // v8.0.24 (TD-276): چک وصول‌شده (passed، وضعیت پایانی و غیرقابل حذف) هم پول حساب بانکی را جابه‌جا می‌کند: چک دریافتی
    // به حساب واریز و چک پرداختی از آن برداشت شده است (سند وصول همان حساب را بدهکار/بستانکار می‌کند). پیش‌تر مانده خزانه
    // فقط تراکنش‌های خزانه را می‌شمرد و حساب پس از هر وصول چک «مغایر» نشان داده می‌شد.
    const clearedCheques = await db.select({
      bankAccountId: cheques.bankAccountId,
      type: cheques.type,
      amount: cheques.amount,
    })
    .from(cheques)
    .where(and(eq(cheques.isDeleted, 0), eq(cheques.status, 'passed')));

    // V2.0.0: حساب‌هایی که سند افتتاحیه دارند — مانده اولیه در دفتر ثبت شده و
    // نباید در محاسبه ledgerBalance دوباره اضافه شود (جلوگیری از دوبرابرشماری)
    const openingVoucherBanks = new Set<number>();
    const openingVouchers = await db.select({
      referenceId: journalVouchers.referenceId,
    })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.referenceModule, 'treasury_opening'),
      eq(journalVouchers.isDeleted, 0),
      // v8.0.74 (TD-340): سند افتتاحیه پیش‌نویس در مانده دفتری نیامده است، پس مانده اول دوره هنوز باید افزوده شود
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ));
    for (const ov of openingVouchers) {
      if (ov.referenceId) openingVoucherBanks.add(Number(ov.referenceId));
    }

    return rawList.map(b => {
      const initBal = fin(b.initialBalance);

      // Match journal items for this bank account (deduplicated by item id)
      const matchingItemsMap = new Map<number, typeof vItems[0]>();
      for (const it of vItems) {
        // v8.0.74 (TD-340): ردیفی که تفصیلی بانک دارد فقط مال همان بانک است، حتی اگر چند بانک یک سرفصل داشته باشند
        const taggedBank = it.detailedType === 'bank_account' && it.detailedId ? it.detailedId : null;
        const matchesAccount = Boolean(b.accountId && it.accountId === b.accountId && taggedBank === null);
        const matchesDetailed = taggedBank === b.id;
        if (matchesAccount || matchesDetailed) {
          matchingItemsMap.set(it.id, it);
        }
      }

      let totalDebit = fin(0);
      let totalCredit = fin(0);
      for (const it of matchingItemsMap.values()) {
        totalDebit = totalDebit.add(it.debit);
        totalCredit = totalCredit.add(it.credit);
      }

      // Match treasury transactions
      let receipts = fin(0);
      let payments = fin(0);
      for (const tx of rawTxs) {
        if (tx.bankAccountId === b.id) {
          if (tx.type === 'receipt') {
            receipts = receipts.add(tx.amount);
          } else if (tx.type === 'payment') {
            payments = payments.add(tx.amount);
          }
        }
      }
      for (const chq of clearedCheques) {
        if (chq.bankAccountId === b.id) {
          if (chq.type === 'received') receipts = receipts.add(chq.amount);
          else payments = payments.add(chq.amount);
        }
      }

      const treasuryBalance = initBal.add(receipts).subtract(payments);
      // V2.0.0: اگر سند افتتاحیه برای این حساب صادر شده، مانده اولیه داخل دفتر است
      // و دیگر به ledgerBalance اضافه نمی‌شود (حساب‌های قدیمیِ بدون سند با فرمول قدیمی)
      const hasOpeningVoucher = openingVoucherBanks.has(b.id);
      const ledgerBalance = (hasOpeningVoucher ? fin(0) : initBal).add(totalDebit).subtract(totalCredit);
      const discrepancy = ledgerBalance.subtract(treasuryBalance).abs();
      const hasLedgerRows = !totalDebit.isZero() || !totalCredit.isZero();

      let syncStatus: 'synced' | 'discrepant' | 'unlinked' = 'synced';
      const currentBalance = treasuryBalance;

      if (!b.accountId && !hasLedgerRows) {
        syncStatus = 'unlinked';
      } else if (discrepancy.lessThan(0.01)) {
        syncStatus = 'synced';
      } else {
        syncStatus = 'discrepant';
      }

      return { row: b, initBal, currentBalance, ledgerBalance, treasuryBalance, totalDebit, totalCredit, discrepancy, syncStatus };
    });
  }

  static async getBankAccounts(): Promise<BankAccount[]> {
    return (await this.computeBankBalances()).map(c => this.toBankAccountDto(c));
  }

  // قرارداد API: مبالغ در پاسخ عدد هستند (P2-6)
  private static toBankAccountDto(
    { row: b, initBal, currentBalance, ledgerBalance, treasuryBalance, totalDebit, totalCredit, discrepancy, syncStatus }: Awaited<ReturnType<typeof BankAccountService.computeBankBalances>>[number]
  ): BankAccount {
    return ({
      ...b,
      type: b.type as BankAccount['type'],
      initialBalance: initBal.toNumber(),
      currentBalance: currentBalance.toNumber(),
      ledgerBalance: ledgerBalance.toNumber(),
      treasuryBalance: treasuryBalance.toNumber(),
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      discrepancy: discrepancy.toNumber(),
      syncStatus,
      bank_name: b.bankName || '',
      account_number: b.accountNumber || '',
      sheba_number: b.shebaNumber || '',
      card_number: b.cardNumber || '',
      initial_balance: initBal.toNumber(),
      current_balance: currentBalance.toNumber(),
      account_id: b.accountId,
      account_name: b.accountName || undefined,
      account_code: b.accountCode || undefined,
      is_active: b.isActive ?? 1,
    }) as BankAccount;
  }

  /**
   * گزارش تطبیق مانده حساب‌های خزانه با دفاتر (بدون ذخیره). v7.0.127 (TD-247): جمع کل‌ها با Decimal، نه `+=`
   * اعداد جاوااسکریپت (AGENTS.md §1.8)؛ خروجی API عدد است.
   */
  static async getBankReconciliationReport(): Promise<BankReconciliationReport> {
    return this.summarizeReconciliation(await this.computeBankBalances());
  }

  /**
   * v8.0.74 (TD-340، تصمیم مالک محصول — گزینه الف): «همگام‌سازی مانده بانک‌ها» مانده جاری هر حساب را زیر قفل همه بانک‌ها
   * (به ترتیب شناسه) از مانده اول دوره، تراکنش‌های خزانه و چک‌های وصول‌شده می‌سازد؛ اختلاف با دفتر کل فقط گزارش می‌شود.
   * پیش‌تر بیرون از تراکنش و بی‌قفل، مانده جاری با مانده دفتر کل (بی اسناد پیش‌نویس) بازنویسی می‌شد: پرداخت پیش‌نویس
   * ۳۰۰ مانده ۷۰۰ را ۱۰۰۰ می‌کرد و پرداخت هم‌زمان گم می‌شد.
   */
  static async recalculateAndSyncBankBalances(): Promise<BankReconciliationReport> {
    return await orm.transaction(async (tx) => {
      await tx.select({ id: bankAccounts.id }).from(bankAccounts)
        .where(eq(bankAccounts.isDeleted, 0))
        .orderBy(asc(bankAccounts.id))
        .for('update');
      const computed = await this.computeBankBalances(tx);
      for (const bank of computed) {
        if (fin(bank.row.currentBalance).equals(bank.treasuryBalance)) continue;
        await tx.update(bankAccounts).set({
          currentBalance: money(bank.treasuryBalance)
        }).where(eq(bankAccounts.id, bank.row.id));
      }
      return this.summarizeReconciliation(computed);
    });
  }

  private static summarizeReconciliation(computed: Awaited<ReturnType<typeof BankAccountService.computeBankBalances>>): BankReconciliationReport {
    let syncedCount = 0;
    let discrepantCount = 0;
    let unlinkedCount = 0;
    let totalCashAndBankLedger = fin(0);
    let totalCashAndBankTreasury = fin(0);
    let totalDiscrepancy = fin(0);

    for (const bank of computed) {
      totalCashAndBankLedger = totalCashAndBankLedger.add(bank.ledgerBalance);
      totalCashAndBankTreasury = totalCashAndBankTreasury.add(bank.treasuryBalance);
      totalDiscrepancy = totalDiscrepancy.add(bank.discrepancy);

      if (bank.syncStatus === 'synced') syncedCount++;
      else if (bank.syncStatus === 'discrepant') discrepantCount++;
      else unlinkedCount++;
    }

    const banks = computed.map(c => this.toBankAccountDto(c));
    return {
      syncedCount,
      discrepantCount,
      unlinkedCount,
      totalCashAndBankLedger: totalCashAndBankLedger.toNumber(),
      totalCashAndBankTreasury: totalCashAndBankTreasury.toNumber(),
      totalDiscrepancy: totalDiscrepancy.toNumber(),
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
   * V4.0.37: پیش‌نمایش کد خودکار حساب خزانه بر اساس نوع (BANK-01, CASH-01, POS-01) برای فرم.
   * v8.0.78 (TD-325): کد نهایی هنگام ثبت از شمارنده اتمی گرفته می‌شود (`assignTreasuryAccountCode`).
   */
  static async generateNextAccountCode(type: 'bank' | 'cash' | 'pos' | 'petty_cash'): Promise<string> {
    return peekNextTreasuryAccountCode(type);
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
    const initialBal = money(data.initialBalance);
    const isStrict = data.strict !== false;
    // v9.0.88 (TD-508، ت۵ الف): ارز از فهرست پشتیبانی‌شده (خالی ← ریال)
    const currency = requireTreasuryCurrency(data.currency);

    // V4.0.5 (F-3 / TD-093): قانون صریح — اگر موجودی اولیه غیرصفر باشد، انتساب به سرفصل معین حسابداری برای صدور سند افتتاحیه الزامی است
    if (!initialBal.isZero() && !data.accountId && isStrict) {
      throw new ValidationError('برای ثبت حساب بانکی یا صندوق با موجودی اولیه غیرصفر، انتخاب سرفصل معین حسابداری الزامی است.');
    }

    const run = async (tx: DbExecutor) => {
      // v8.0.78 (TD-325): کد از شمارنده اتمی پیشوند، یا کد دستی یکتا زیر قفل همان شمارنده
      const finalCode = await assignTreasuryAccountCode(tx, data.type, data.code);

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
        currency,
        accountId: data.accountId || null,
        isActive: 1,
        notes: data.notes?.trim() || '',
      }).returning();

      // V2.0.0: سند افتتاحیه موجودی اولیه — DR معین بانک / CR سرمایه اولیه (4001)
      // ورکفلو شرطی: اگر تعریف workflow فعال برای «bank_account» باشد، سند پس از تأیید نهایی صادر می‌شود
      if (!initialBal.isZero()) {
        const { WorkflowEngineService } = await import('../../workflow/workflowEngineService.js');
        const wfInstance = await WorkflowEngineService.maybeStartWorkflow({
          entityType: 'bank_account',
          entityId: String(inserted.id),
          userId: data.userId,
          userName: data.username,
          tx // v8.0.77 (TD-324)
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
      } as BankAccount;
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

    const initialBal = fin(bank.initialBalance);
    if (initialBal.isZero()) return null; // بدون مانده — سند نیاز ندارد
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

    const amount = initialBal.abs();
    const isDebitBank = initialBal.isPositive(); // موجودی مثبت = بدهکار بانک

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
    currency: string;
    accountId: number | null;
    isActive: number;
    notes: string;
    userId?: number;
    username?: string;
    strict?: boolean;
  }>, externalTx?: DbExecutor): Promise<BankAccount> {
    const isStrict = data.strict !== false;

    const run = async (tx: DbExecutor) => {
      // v8.0.78 (TD-325): ردیف بانک FOR UPDATE قفل و تفاوت مانده اول دوره زیر همین قفل حساب می‌شود (پیش‌تر دو ویرایش
      // هم‌زمان ۱۰۰ ← ۱۵۰ هر دو تفاوت ۵۰ را از مقدار کهنه می‌گرفتند و موجودی جاری ۲۰۰ می‌شد)؛ حساب حذف‌شده ویرایش نمی‌شود
      const [existing] = await tx.select().from(bankAccounts)
        .where(and(eq(bankAccounts.id, id), eq(bankAccounts.isDeleted, 0)))
        .for('update');
      if (!existing) throw new NotFoundError('حساب بانکی یا صندوق یافت نشد');
      // v9.0.71 (TD-504، ت۸): تغییر مانده اول دوره در انتظار تأیید گردش‌کار رد می‌شود
      if (data.initialBalance !== undefined && !fin(data.initialBalance).round(4).equals(fin(existing.initialBalance))) {
        await assertNoPendingOpeningApproval(tx, existing);
      }
      // v9.0.88 (TD-508، ت۵ الف): ارز ویرایش می‌شود تا نخستین گردش حساب؛ پس از آن 422 (پیش‌تر بی‌صدا نادیده گرفته می‌شد)
      const newCurrency = data.currency !== undefined ? requireTreasuryCurrency(data.currency) : undefined;
      if (newCurrency) await assertBankCurrencyChangeAllowed(tx, existing, newCurrency);
      const newCode = data.code?.trim();
      if (newCode && newCode.toLowerCase() !== String(existing.code || '').trim().toLowerCase()) {
        await assignTreasuryAccountCode(tx, (data.type || existing.type) as TreasuryAccountType, newCode, id);
      }

      const fields = {
        ...(data.title ? { title: data.title.trim() } : {}),
        ...(newCode ? { code: newCode } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.bankName !== undefined ? { bankName: data.bankName.trim() } : {}),
        ...(data.accountNumber !== undefined ? { accountNumber: data.accountNumber.trim() } : {}),
        ...(data.shebaNumber !== undefined ? { shebaNumber: data.shebaNumber.trim() } : {}),
        ...(data.cardNumber !== undefined ? { cardNumber: data.cardNumber.trim() } : {}),
        ...(data.branch !== undefined ? { branch: data.branch.trim() } : {}),
        ...(newCurrency && newCurrency !== (existing.currency || 'IRR').toUpperCase() ? { currency: newCurrency } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.notes !== undefined ? { notes: data.notes.trim() } : {}),
      };
      // فقط مانده اول دوره: ردیف بی‌تغییر فیلد دیگر (update خالی در drizzle خطاست)
      const [updated] = Object.keys(fields).length > 0
        ? await tx.update(bankAccounts).set(fields).where(eq(bankAccounts.id, id)).returning()
        : [existing];

      // V2.0.0: تغییر موجودی اولیه → سند اصلاحی مابه‌التفاوت (فقط برای حساب‌های کدینگ‌شده)
      if (data.initialBalance !== undefined) {
        const newInitial = fin(data.initialBalance).round(4);
        const oldInitial = fin(existing.initialBalance);
        const delta = newInitial.subtract(oldInitial).round(4);
        // اصلاح currentBalance با دلتا
        if (!delta.isZero()) {
          const newCur = fin(updated.currentBalance).add(delta).round(4);
          await tx.update(bankAccounts).set({ currentBalance: money(newCur), initialBalance: money(newInitial) }).where(eq(bankAccounts.id, id));
        }
        if (!delta.isZero()) {
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
              const amount = delta.abs();
              const isIncrease = delta.isPositive();
              const adjVoucher = await VoucherService.createJournalVoucher({
                date: await businessTodayJalaliDash(),
                voucherType: 'adjustment',
                status: 'draft',
                description: `اصلاح موجودی اولیه ${updated.title} (${isIncrease ? '+' : ''}${delta.toString()})`,
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
                    debit: isIncrease ? amount : 0,
                    credit: isIncrease ? 0 : amount,
                    currency: updated.currency || 'IRR',
                    description: `اصلاح موجودی اولیه ${updated.title}`
                  },
                  {
                    accountId: capitalAcc.id,
                    detailedType: 'other',
                    detailedName: 'سرمایه اولیه',
                    debit: isIncrease ? 0 : amount,
                    credit: isIncrease ? amount : 0,
                    currency: updated.currency || 'IRR',
                    description: `اصلاح سهم سرمایه بابت موجودی اولیه ${updated.title}`
                  }
                ]
              }, tx);

              if (!adjVoucher && isStrict) {
                throw new ValidationError(`ثبت سند اصلاحی موجودی اولیه برای حساب «${updated.title}» ناموفق بود.`);
              }
            } else if (!newInitial.isZero()) {
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
      } as BankAccount;
    };

    if (externalTx) {
      return run(externalTx);
    }
    return orm.transaction(run);
  }

  /**
   * v8.0.78 (TD-325): حذف در تراکنش و زیر قفل ردیف بانک (همان قفلی که ثبت تراکنش خزانه و وصول چک می‌گیرند)؛ تراکنش‌ها و
   * چک‌های حساب زیر همین قفل شمرده می‌شوند. پیش‌تر حذف بی‌قفل بود و حساب در میانه ثبت دریافت با تراکنش فعال حذف می‌شد،
   * و حسابی که چک وصول‌شده یا صادرشده داشت هم حذف می‌شد.
   */
  static async deleteBankAccount(id: number, user?: { userId?: number; username?: string }): Promise<{ success: boolean }> {
    return orm.transaction(async (tx) => {
      const [existing] = await tx.select({ id: bankAccounts.id, code: bankAccounts.code, title: bankAccounts.title }).from(bankAccounts)
        .where(and(eq(bankAccounts.id, id), eq(bankAccounts.isDeleted, 0)))
        .for('update');
      if (!existing) throw new NotFoundError('حساب بانکی یا صندوق یافت نشد');

      const hasTx = await tx.select({ id: treasuryTransactions.id }).from(treasuryTransactions).where(eq(treasuryTransactions.bankAccountId, id)).limit(1);
      if (hasTx.length > 0) {
        throw new BusinessLogicError('برای این حساب بانکی/صندوق تراکنش ثبت شده است و امکان حذف آن وجود ندارد');
      }
      const hasCheque = await tx.select({ id: cheques.id }).from(cheques)
        .where(and(eq(cheques.bankAccountId, id), eq(cheques.isDeleted, 0))).limit(1);
      if (hasCheque.length > 0) {
        throw new BusinessLogicError('برای این حساب بانکی/صندوق چک ثبت شده است و امکان حذف آن وجود ندارد');
      }

      // v9.0.70 (TD-503، ت۹): اسناد مانده اول دوره در همان تراکنش بی‌اثر می‌شوند؛ سند قطعی حذف را رد می‌کند
      await voidBankOpeningVouchers(tx, existing, user);
      await tx.update(bankAccounts).set({ isDeleted: 1 }).where(eq(bankAccounts.id, id));
      // v9.0.40 (TD-447، ت۵): فرایند در جریان حساب حذف‌شده در همان تراکنش بسته می‌شود
      await terminateOpenWorkflows(tx, {
        entityType: 'bank_account', entityId: id, actionKey: 'terminate', actionTitle: 'بستن فرایند با حذف حساب خزانه', comment: 'حذف حساب خزانه',
      });
      return { success: true };
    });
  }
}
