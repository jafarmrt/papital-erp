import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions, users, accounts } from '../../../db/schema.js';
import { eq, desc, and, sql, gte, lte, inArray, asc } from 'drizzle-orm';
import { AccountMappingService } from '../accountMapping.service.js';
import { ChartOfAccountsService } from '../chartOfAccounts.service.js';
import { VoucherService } from '../voucher.service.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { DomainEventType } from '../../events/domainEvents.js';
import { OutboxService } from '../../events/outboxService.js';
import { fin } from '../../../lib/financialDecimal.js';
import type { TreasuryTransaction, Account } from '../../../types.js';
import { NotFoundError, ValidationError, ConflictError, BusinessLogicError } from '../../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../../lib/businessClock.js';

export class TreasuryTransactionService {
  static async generateTransactionNumber(type: 'receipt' | 'payment', tx?: DbExecutor): Promise<string> {
    const executor = tx || orm;
    const result = await executor.execute(sql`SELECT nextval('treasury_tx_number_seq') AS num`);
    const seqNum = Number(result.rows?.[0]?.num);
    const prefix = type === 'receipt' ? 'REC' : 'PAY';
    return `${prefix}-${String(seqNum).padStart(6, '0')}`;
  }

  /**
   * V1.8.0: انتخاب طرف حساب متقابل — منطق مشترک بین ثبت و پیش‌نمایش سند
   * purpose برای پرسنل: 'settlement' (تسویه حقوق → 3201) | 'advance' (مساعده → 1301)
   */
  static async resolveContraAccount(
    partyType: string,
    purpose: string | undefined,
    tx?: DbExecutor
  ): Promise<{ account: Account | null; fallbackGeneralId: number | null; conceptLabel: string }> {
    let account: Account | null = null;
    let conceptLabel = '';

    if (partyType === 'customer') {
      account = await AccountMappingService.getTradeReceivablesAccount(tx);
      conceptLabel = 'حساب‌های دریافتنی تجاری';
    } else if (partyType === 'supplier') {
      account = await AccountMappingService.getTradePayablesAccount(tx);
      conceptLabel = 'حساب‌های پرداختنی تجاری';
    } else if (partyType === 'personnel') {
      if (purpose === 'advance') {
        account = await AccountMappingService.getEmployeeAdvanceAccount(tx);
        conceptLabel = 'مساعده و وام پرسنل';
      } else {
        account = await AccountMappingService.getWagesPayableAccount(tx);
        conceptLabel = 'حقوق و دستمزد پرداختنی';
      }
    } else {
      account = (await AccountMappingService.getTradeReceivablesAccount(tx))
        || (await AccountMappingService.getTradePayablesAccount(tx));
      conceptLabel = 'حساب‌های دریافتنی/پرداختنی';
    }

    // Fallback به معین عمومی (مثل 12 برای 1201) اگر تفصیلی یافت نشد
    let fallbackGeneralId: number | null = null;
    if (!account) {
      const allAccs = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
      const code = purpose === 'advance' && partyType === 'personnel'
        ? (await AccountMappingService.getMappings(tx)).employeeAdvanceAccountCode
        : (partyType === 'customer' ? (await AccountMappingService.getMappings(tx)).tradeReceivablesAccountCode
          : partyType === 'supplier' ? (await AccountMappingService.getMappings(tx)).tradePayablesAccountCode
            : partyType === 'personnel' ? (await AccountMappingService.getMappings(tx)).wagesPayableAccountCode : '');
      const generalCode = code.slice(0, 2);
      const general = allAccs.find(a => a.code === generalCode);
      fallbackGeneralId = general?.id || null;
    }

    return { account, fallbackGeneralId, conceptLabel };
  }

  /**
   * V1.8.0: پیش‌نمایش سند دوبل ثبت دریافت/پرداخت — بدون هیچ ذخیره‌سازی
   * برای پنل پیش‌نمایش زنده در فرم ثبت وجه + هشدارهای شفافیت
   */
  static async previewTreasuryVoucher(data: {
    type: 'receipt' | 'payment';
    amount: number;
    currency?: string;
    bankAccountId: number;
    partyType?: string;
    purpose?: string;
    partyId?: number | null;
    partyName?: string;
  }): Promise<{
    debit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null;
    credit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null;
    warnings: string[];
    contraConceptLabel: string;
  }> {
    const amount = Number(data.amount) || 0;
    const warnings: string[] = [];

    const [bank] = await orm.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, data.bankAccountId), eq(bankAccounts.isDeleted, 0)));
    if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');

    if (!bank.accountId) {
      warnings.push('این حساب بانکی/صندوق به چارت حساب‌ها متصل نیست — سند دوبل صادر نخواهد شد. از ویرایش حساب، کدینگ معین را متصل کنید.');
    }

    if (bank.currency && (data.currency || bank.currency) !== bank.currency) {
      warnings.push(`ارز تراکنش با ارز حساب «${bank.title}» (${bank.currency}) هم‌خوانی ندارد`);
    }

    const contra = await this.resolveContraAccount(data.partyType || 'other', data.purpose);
    const contraAccountId = contra?.account?.id || contra?.fallbackGeneralId || null;
    if (!contraAccountId) {
      warnings.push(`حساب معین «${contra.conceptLabel}» در چارت یافت نشد — سند صادر نخواهد شد (از تنظیمات ← تنظیمات حسابداری پیکربندی کنید)`);
    }

    if (amount <= 0) {
      warnings.push('مبلغ باید بزرگ‌تر از صفر باشد');
    }

    let debit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null = null;
    let credit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null = null;
    if (amount > 0 && bank.accountId && contraAccountId) {
      const accById = new Map((await orm.select().from(accounts).where(eq(accounts.isDeleted, 0))).map(a => [a.id, a]));
      const debitAcc = accById.get(data.type === 'receipt' ? bank.accountId : contraAccountId);
      const creditAcc = accById.get(data.type === 'receipt' ? contraAccountId : bank.accountId);
      const isReceipt = data.type === 'receipt';

      debit = {
        accountId: debitAcc?.id || 0,
        accountCode: debitAcc?.code || '',
        accountName: debitAcc?.name || '',
        detailedName: isReceipt ? bank.title : (data.partyName || 'طرف حساب'),
        amount,
      };
      credit = {
        accountId: creditAcc?.id || 0,
        accountCode: creditAcc?.code || '',
        accountName: creditAcc?.name || '',
        detailedName: isReceipt ? (data.partyName || 'طرف حساب') : bank.title,
        amount,
      };
    }

    return { debit, credit, warnings, contraConceptLabel: contra.conceptLabel };
  }

  static async getTreasuryTransactions(params: {
    type?: 'receipt' | 'payment';
    bankAccountId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<TreasuryTransaction[]> {
    const conditions = [eq(treasuryTransactions.isDeleted, 0)];

    if (params.type) {
      conditions.push(eq(treasuryTransactions.type, params.type));
    }
    if (params.bankAccountId) {
      conditions.push(eq(treasuryTransactions.bankAccountId, params.bankAccountId));
    }
    if (params.startDate) {
      conditions.push(gte(treasuryTransactions.date, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(treasuryTransactions.date, params.endDate));
    }

    const rawList = await orm.select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      type: treasuryTransactions.type,
      date: treasuryTransactions.date,
      method: treasuryTransactions.method,
      amount: treasuryTransactions.amount,
      currency: treasuryTransactions.currency,
      exchangeRate: treasuryTransactions.exchangeRate,
      bankAccountId: treasuryTransactions.bankAccountId,
      bankAccountTitle: bankAccounts.title,
      partyType: treasuryTransactions.partyType,
      partyId: treasuryTransactions.partyId,
      partyName: treasuryTransactions.partyName,
      trackingNumber: treasuryTransactions.trackingNumber,
      voucherId: treasuryTransactions.voucherId,
      chequeId: treasuryTransactions.chequeId,
      documentId: treasuryTransactions.documentId,
      payrollId: treasuryTransactions.payrollId,
      reversalOfId: treasuryTransactions.reversalOfId,
      // V1.6.0: وضعیت آشتی‌سنجی بانکی
      reconciled: treasuryTransactions.reconciled,
      reconciledAt: treasuryTransactions.reconciledAt,
      reconciledBatch: treasuryTransactions.reconciledBatch,
      // V1.5.0: هویت ثبت‌کننده (یک موجودیت کاربر)
      createdById: treasuryTransactions.createdById,
      creatorName: users.fullName,
      description: treasuryTransactions.description,
      status: treasuryTransactions.status,
      createdAt: treasuryTransactions.createdAt,
    })
    .from(treasuryTransactions)
    .leftJoin(bankAccounts, eq(bankAccounts.id, treasuryTransactions.bankAccountId))
    .leftJoin(users, eq(users.id, treasuryTransactions.createdById))
    .where(and(...conditions))
    .orderBy(desc(treasuryTransactions.date), desc(treasuryTransactions.id));

    return rawList.map(t => ({
      ...t,
      type: t.type as 'receipt' | 'payment',
      method: t.method as TreasuryTransaction['method'],
      partyType: t.partyType as TreasuryTransaction['partyType'],
      status: t.status as TreasuryTransaction['status'],
      transaction_number: t.transactionNumber,
      bank_account_id: t.bankAccountId || undefined,
      party_type: t.partyType as TreasuryTransaction['partyType'],
      party_id: t.partyId,
      party_name: t.partyName,
      tracking_number: t.trackingNumber || '',
      voucher_id: t.voucherId,
      cheque_id: t.chequeId,
      document_id: t.documentId,
    }));
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
    // V1.8.0: انگیزه پرداخت به پرسنل — 'settlement' (تسویه حقوق) | 'advance' (مساعده)
    purpose?: string;
  }): Promise<TreasuryTransaction> {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ تراکنش باید بزرگتر از صفر باشد');

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      ]);
      // V1.4.0: قفل حساب با فیلتر isDeleted — ثبت وجه در حساب حذف‌شده ممنوع
      const [bank] = await txEngine.select().from(bankAccounts)
        .where(and(eq(bankAccounts.id, data.bankAccountId), eq(bankAccounts.isDeleted, 0)))
        .for('update');
      if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');

      // V1.4.0: گارد هم‌ارزی ارز — تراکنش باید هم‌ارز با حساب باشد تا مانده‌ها معنادار بمانند
      const txCurrency = data.currency || bank.currency || 'IRR';
      if (bank.currency && txCurrency !== bank.currency) {
        throw new ValidationError(`ارز تراکنش (${txCurrency}) با ارز حساب «${bank.title}» (${bank.currency}) هم‌خوانی ندارد. تراکنش هم‌ارز ثبت کنید.`);
      }

      const txNum = await this.generateTransactionNumber(data.type, txEngine);

      // V9-1.3: محاسبه موجودی بانک با FinancialDecimal — حذف خطای شناور float
      const currentBal = Number(bank.currentBalance) || 0;
      const newBal = data.type === 'receipt'
        ? fin(currentBal).add(amount).round(4).toNumber()
        : fin(currentBal).subtract(amount).round(4).toNumber();
      // V1.4.0: سیاست مانده منفی ممنوع — پرداخت بیش از مانده رد می‌شود
      if (newBal < 0) {
        throw new ValidationError(`مانده حساب «${bank.title}» کافی نیست (مانده فعلی: ${currentBal.toLocaleString('fa-IR')})`);
      }
      await txEngine.update(bankAccounts).set({ currentBalance: newBal }).where(eq(bankAccounts.id, data.bankAccountId));

      let voucherId: number | null = null;
      if (data.createVoucher !== false) {
        if (!bank.accountId) {
          throw new ValidationError('حساب معین مرتبط در چارت حساب‌ها برای این حساب بانکی/صندوق تعریف نشده است');
        }

        // V1.8.0: طرف حساب متقابل از منطق مشترک (مپینگ + purpose)
        const contra = await this.resolveContraAccount(data.partyType || 'other', data.purpose, txEngine);
        const contraAccountId = contra?.account?.id || contra?.fallbackGeneralId || null;

        if (!contraAccountId) {
          throw new NotFoundError('حساب معین طرف حساب در چارت حساب‌ها یافت نشد (آن را از تنظیمات ← تنظیمات حسابداری پیکربندی کنید)');
        }

        const descText = data.description || `${data.type === 'receipt' ? 'دریافت' : 'پرداخت'} ${data.method === 'cash' ? 'نقدی' : data.method === 'pos' ? 'کارتخوان' : 'حواله بانکی'} از/به ${data.partyName}`;
        
        const debitAccountId = data.type === 'receipt' ? bank.accountId : contraAccountId;
        const creditAccountId = data.type === 'receipt' ? contraAccountId : bank.accountId;

        const v = await VoucherService.createJournalVoucher({
          date: data.date,
          voucherType: 'treasury',
          description: descText,
          referenceModule: 'treasury',
          referenceNumber: txNum,
          currency: data.currency || bank.currency || 'IRR',
          userId: data.userId,
          username: data.username,
          items: [
            {
              accountId: debitAccountId,
              detailedType: data.type === 'receipt' ? 'bank_account' : (data.partyType || 'other'),
              detailedId: data.type === 'receipt' ? bank.id : data.partyId,
              detailedName: data.type === 'receipt' ? bank.title : data.partyName,
              debit: amount,
              credit: 0,
              currency: data.currency || 'IRR',
              description: descText,
            },
            {
              accountId: creditAccountId,
              detailedType: data.type === 'receipt' ? (data.partyType || 'other') : 'bank_account',
              detailedId: data.type === 'receipt' ? data.partyId : bank.id,
              detailedName: data.type === 'receipt' ? data.partyName : bank.title,
              debit: 0,
              credit: amount,
              currency: data.currency || 'IRR',
              description: descText,
            }
          ]
        }, txEngine);
        voucherId = v.id;
      }

      const [tx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: txNum,
        type: data.type,
        date: data.date.trim(),
        method: data.method,
        amount,
        currency: txCurrency,
        exchangeRate: Number(data.exchangeRate) || 1,
        bankAccountId: data.bankAccountId,
        partyType: data.partyType || 'other',
        partyId: data.partyId || null,
        partyName: data.partyName.trim(),
        trackingNumber: data.trackingNumber?.trim() || '',
        voucherId,
        documentId: data.documentId || null,
        description: data.description?.trim() || '',
        status: 'completed',
        createdById: data.userId || null,
      }).returning();

      // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with treasury transaction)
      const treasuryEvent = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(tx.id),
        {
          transactionId: tx.id,
          type: data.type === 'receipt' ? 'deposit' : 'withdrawal',
          amount,
          currency: txCurrency,
          accountId: bank.id,
          accountName: bank.title,
          description: data.description
        },
        { userId: data.userId, userName: data.username }
      );
      await OutboxService.saveToOutbox(txEngine, treasuryEvent);

      return {
        ...tx,
        type: tx.type as 'receipt' | 'payment',
        method: tx.method as TreasuryTransaction['method'],
        partyType: tx.partyType as TreasuryTransaction['partyType'],
        status: tx.status as TreasuryTransaction['status'],
        bankAccountTitle: bank.title,
      };
    });
  }

  /**
   * V1.4.0 (DB-009): ابطال تراکنش خزانه با سند معکوس
   * - تراکنش اصلی هرگز hard-delete نمی‌شود؛ status='voided' می‌گیرد
   * - یک تراکنش معکوس (receipt↔payment) با شماره سری جدید ساخته می‌شود که reversalOfId به اصل اشاره می‌کند
   * - سند معکوس اتوماتیک در همان تراکنش دیتابیس ثبت می‌شود
   * - مانده حساب بانکی با همان قواعد اصل اصلاح می‌شود
   */
  static async voidTreasuryTransaction(id: number, params: {
    reason: string;
    userId?: number;
    username?: string;
  }): Promise<TreasuryTransaction> {
    const reason = (params.reason || '').trim();
    if (!reason) throw new ValidationError('دلیل ابطال الزامی است');

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
        { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
      ]);

      // 1) قفل بانک (سطح ۱۰) سپس قفل تراکنش (سطح ۸۰) مطابق سلسله‌مراتب
      const [original] = await txEngine.select().from(treasuryTransactions)
        .where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)))
        .for('update');
      if (!original) throw new NotFoundError('تراکنش خزانه یافت نشد');
      if (original.status === 'voided') {
        throw new ConflictError('این تراکنش قبلاً ابطال شده است');
      }

      // تراکنش‌های متصل به پرداخت حقوق باید از مسیر خود حقوق مدیریت شوند (اتمیک بودن فیش)
      if (original.payrollId) {
        throw new BusinessLogicError('این تراکنش یک پرداخت حقوق ثبت‌شده است و از این مسیر قابل ابطال نیست');
      }

      const [bank] = await txEngine.select().from(bankAccounts)
        .where(and(eq(bankAccounts.id, original.bankAccountId || 0), eq(bankAccounts.isDeleted, 0)))
        .for('update');
      if (!bank) throw new NotFoundError('حساب بانکی مرتبط با تراکنش یافت نشد');

      // 2) اصلاح مانده: معکوس اثر اصل
      const amount = Number(original.amount) || 0;
      const currentBal = Number(bank.currentBalance) || 0;
      const newBal = original.type === 'receipt'
        ? fin(currentBal).subtract(amount).round(4).toNumber()
        : fin(currentBal).add(amount).round(4).toNumber();
      if (newBal < 0) {
        throw new ValidationError(`ابطال ممکن نیست: مانده فعلی «${bank.title}» (${currentBal.toLocaleString('fa-IR')}) برای برگشت این وجه کافی نیست`);
      }
      await txEngine.update(bankAccounts).set({ currentBalance: newBal }).where(eq(bankAccounts.id, bank.id));

      // 3) تراکنش معکوس با شماره سری جدید
      const reversalType = original.type === 'receipt' ? 'payment' : 'receipt';
      const reversalNum = await this.generateTransactionNumber(reversalType, txEngine);

      // 4) سند معکوس اتوماتیک (اگر اصل سند دارد)
      let reversalVoucherId: number | null = null;
      if (original.voucherId) {
        const rv = await VoucherService.reverseVoucher({
          voucherId: original.voucherId,
          reason: `ابطال تراکنش ${original.transactionNumber} — ${reason}`,
          userId: params.userId,
          username: params.username,
          externalTx: txEngine,
        });
        reversalVoucherId = rv?.id || null;
      }

      const [reversalTx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: reversalNum,
        type: reversalType,
        date: await businessTodayIsoDate(),
        method: original.method,
        amount,
        currency: original.currency || bank.currency || 'IRR',
        exchangeRate: original.exchangeRate || 1,
        bankAccountId: original.bankAccountId,
        partyType: original.partyType,
        partyId: original.partyId,
        partyName: original.partyName,
        trackingNumber: original.trackingNumber || '',
        voucherId: reversalVoucherId,
        chequeId: original.chequeId || null,
        documentId: original.documentId || null,
        reversalOfId: original.id,
        description: `ابطال تراکنش ${original.transactionNumber} — دلیل: ${reason}`,
        status: 'completed',
        createdById: params.userId || null,
      }).returning();

      // 5) نشان‌گذاری اصل به‌عنوان voided (soft — بدون حذف)
      await txEngine.update(treasuryTransactions)
        .set({ status: 'voided', updatedAt: sql`now()` })
        .where(eq(treasuryTransactions.id, original.id));

      // 6) Outbox event (same tx)
      const voidEvent = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(reversalTx.id),
        {
          transactionId: reversalTx.id,
          voidedTransactionId: original.id,
          voidedTransactionNumber: original.transactionNumber,
          type: reversalType === 'receipt' ? 'deposit' : 'withdrawal',
          isReversal: true,
          amount,
          currency: original.currency || bank.currency || 'IRR',
          accountId: bank.id,
          accountName: bank.title,
          reason
        },
        { userId: params.userId, userName: params.username }
      );
      await OutboxService.saveToOutbox(txEngine, voidEvent);

      return {
        ...reversalTx,
        type: reversalTx.type as 'receipt' | 'payment',
        method: reversalTx.method as TreasuryTransaction['method'],
        partyType: reversalTx.partyType as TreasuryTransaction['partyType'],
        status: reversalTx.status as TreasuryTransaction['status'],
        bankAccountTitle: bank.title,
      };
    });
  }

  /**
   * V1.5.0: انتقال بین‌بانکی/بین‌صندوقی
   * دو ردیف خزانه (پرداخت از مبدأ + دریافت در مقصد) + یک سند دوبل متوازن
   * (بدهکار حساب مقصد / بستانکار حساب مبدأ) همه در یک تراکنش دیتابیس.
   * هر دو حساب هم‌ارز باید باشند و مانده مبدأ منفی نمی‌شود.
   */
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
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ انتقال باید بزرگتر از صفر باشد');
    if (data.fromBankAccountId === data.toBankAccountId) {
      throw new ValidationError('حساب مبدأ و مقصد باید متفاوت باشند');
    }

    return await orm.transaction(async (txEngine) => {
      // قفل هر دو حساب در ترتیب id صعودی (جلوگیری از deadlock در همان سطح سلسله‌مراتب)
      const ids = [Number(data.fromBankAccountId), Number(data.toBankAccountId)].sort((a, b) => a - b);
      const locked = await txEngine.select().from(bankAccounts)
        .where(and(inArray(bankAccounts.id, ids), eq(bankAccounts.isDeleted, 0)))
        .for('update')
        .orderBy(asc(bankAccounts.id));
      const from = locked.find(b => b.id === Number(data.fromBankAccountId));
      const to = locked.find(b => b.id === Number(data.toBankAccountId));
      if (!from) throw new NotFoundError('حساب مبدأ یافت نشد');
      if (!to) throw new NotFoundError('حساب مقصد یافت نشد');

      const currency = data.currency || from.currency || 'IRR';
      if (from.currency && to.currency && from.currency !== to.currency) {
        throw new ValidationError(`انتقال بین حساب‌های با ارز متفاوت مجاز نیست (${from.currency} → ${to.currency})`);
      }
      if (currency !== from.currency) {
        throw new ValidationError(`ارز انتقال (${currency}) با ارز حساب مبدأ (${from.currency}) هم‌خوانی ندارد`);
      }

      // مانده‌ها با fin()
      const fromNewBal = fin(Number(from.currentBalance) || 0).subtract(amount).round(4).toNumber();
      if (fromNewBal < 0) {
        throw new ValidationError(`مانده حساب مبدأ «${from.title}» کافی نیست (مانده فعلی: ${currentBalFa(from.currentBalance)})`);
      }
      const toNewBal = fin(Number(to.currentBalance) || 0).add(amount).round(4).toNumber();
      await txEngine.update(bankAccounts).set({ currentBalance: fromNewBal }).where(eq(bankAccounts.id, from.id));
      await txEngine.update(bankAccounts).set({ currentBalance: toNewBal }).where(eq(bankAccounts.id, to.id));

      const payNum = await this.generateTransactionNumber('payment', txEngine);
      const recNum = await this.generateTransactionNumber('receipt', txEngine);

      // سند دوبل: بدهکار حساب مقصد / بستانکار حساب مبدأ
      let voucherId: number | null = null;
      if (data.createVoucher !== false) {
        if (!from.accountId || !to.accountId) {
          throw new ValidationError('برای انتقال بین‌بانکی، هر دو حساب باید در چارت حساب‌ها کدینگ شده باشند');
        }
        const descText = data.description?.trim() || `انتقال وجه از ${from.title} به ${to.title}`;
        const v = await VoucherService.createJournalVoucher({
          date: data.date,
          voucherType: 'treasury',
          description: descText,
          referenceModule: 'treasury',
          referenceNumber: payNum,
          currency,
          userId: data.userId,
          username: data.username,
          items: [
            {
              accountId: to.accountId,
              detailedType: 'bank_account',
              detailedId: to.id,
              detailedName: to.title,
              debit: amount,
              credit: 0,
              currency,
              description: `واریز به مقصد بابت انتقال از ${from.title}`
            },
            {
              accountId: from.accountId,
              detailedType: 'bank_account',
              detailedId: from.id,
              detailedName: from.title,
              debit: 0,
              credit: amount,
              currency,
              description: `برداشت از مبدأ بابت انتقال به ${to.title}`
            }
          ]
        }, txEngine);
        voucherId = v.id;
      }

      const descBase = data.description?.trim() || `انتقال وجه از ${from.title} به ${to.title}`;

      const [payTx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: payNum,
        type: 'payment',
        date: data.date.trim(),
        method: 'bank_transfer',
        amount,
        currency,
        exchangeRate: 1,
        bankAccountId: from.id,
        partyType: 'other',
        partyId: null,
        partyName: to.title,
        trackingNumber: data.trackingNumber?.trim() || '',
        voucherId,
        description: `${descBase} — نیمه پرداخت (مبدأ)`,
        status: 'completed',
        createdById: data.userId || null,
      }).returning();

      const [recTx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: recNum,
        type: 'receipt',
        date: data.date.trim(),
        method: 'bank_transfer',
        amount,
        currency,
        exchangeRate: 1,
        bankAccountId: to.id,
        partyType: 'other',
        partyId: null,
        partyName: from.title,
        trackingNumber: data.trackingNumber?.trim() || '',
        voucherId,
        description: `${descBase} — نیمه دریافت (مقصد)`,
        status: 'completed',
        createdById: data.userId || null,
      }).returning();

      // Outbox (همان تراکنش)
      const transferEvent = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(recTx.id),
        {
          transactionId: recTx.id,
          pairedTransactionId: payTx.id,
          isTransfer: true,
          amount,
          currency,
          fromAccountId: from.id,
          fromAccountName: from.title,
          toAccountId: to.id,
          toAccountName: to.title
        },
        { userId: data.userId, userName: data.username }
      );
      await OutboxService.saveToOutbox(txEngine, transferEvent);

      return { payment: payTx as unknown as TreasuryTransaction, receipt: recTx as unknown as TreasuryTransaction, voucherId };
    });
  }

  /**
   * V1.6.0: آشتی‌سنجی بانکی — علامت‌گذاری گروهی تراکنش‌های تطبیق‌یافته با صورت‌حساب بانک
   * (matching سمت کلاینت انجام می‌شود؛ این متد فقط ثبت وضعیت گروهی اتمیک است)
   */
  static async reconcileTransactions(params: {
    bankAccountId: number;
    txIds: number[];
    batch: string;
    reconciled: boolean;
    userId?: number;
    username?: string;
  }): Promise<{ success: boolean; updated: number }> {
    if (!params.txIds.length) return { success: true, updated: 0 };

    return await orm.transaction(async (txEngine) => {
      const rows = await txEngine.select().from(treasuryTransactions)
        .where(and(
          inArray(treasuryTransactions.id, params.txIds),
          eq(treasuryTransactions.bankAccountId, params.bankAccountId),
          eq(treasuryTransactions.isDeleted, 0)
        ))
        .for('update');

      const nowIso = await businessTodayIsoDate();
      for (const row of rows) {
        await txEngine.update(treasuryTransactions).set({
          reconciled: params.reconciled ? 1 : 0,
          reconciledAt: params.reconciled ? nowIso : '',
          reconciledBatch: params.reconciled ? (params.batch || '') : '',
        }).where(eq(treasuryTransactions.id, row.id));
      }

      return { success: true, updated: rows.length };
    });
  }
}

// V1.5.0: helper کوچک نمایش مانده در پیام خطا
function currentBalFa(val: unknown): string {
  return (Number(val) || 0).toLocaleString('fa-IR');
}
