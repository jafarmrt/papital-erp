import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions, users, accounts } from '../../../db/schema.js';
import { eq, desc, and, sql, gte, lte, inArray, asc } from 'drizzle-orm';
import { AccountMappingService } from '../accountMapping.service.js';
import { VoucherService } from '../voucher.service.js';
import { resolveTreasuryExchangeRate } from './treasuryExchangeRate.js';
import { assertNoVoucherAllowed } from './noVoucherTreasury.js';
import { needsChosenContraAccount, normalizePartyPurpose, requireChoosableContraAccount } from './partyContraAccount.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { DomainEventType } from '../../events/domainEvents.js';
import { OutboxService } from '../../events/outboxService.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { money, moneyOr } from '../../../lib/money.js';
import type { TreasuryTransaction, Account } from '../../../types.js';
import { NotFoundError, ValidationError, ConflictError, BusinessLogicError } from '../../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../../lib/businessClock.js';
import { AttachmentStorageService } from '../../attachments/attachmentStorage.service.js';
import { jalaliToIsoDate } from '../../../utils.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JALALI_DATE_PATTERN = /^(1[345]\d{2})[-/](\d{1,2})[-/](\d{1,2})$/;

/**
 * TD-105 (v4.0.31): تاریخ تراکنش‌های خزانه «سرور authoritative» است.
 * - مقدار خالی → پیش‌فرض businessTodayIsoDate (ساعت توافقی، نه ساعت مرورگر کلاینت)
 * - ورودی جلالی → نرمال‌سازی به ISO ذخیره‌سازی
 * - فرمت/روز نامعتبر یا تاریخ آینده → ValidationError (بازه مجاز: گذشته تا امروز کسب‌وکار)
 */
export async function resolveTreasuryBusinessDate(rawDate?: string | null): Promise<string> {
  const trimmed = String(rawDate || '').trim();
  if (!trimmed) {
    return await businessTodayIsoDate();
  }

  let isoDate = trimmed;
  const jalaliMatch = trimmed.match(JALALI_DATE_PATTERN);
  if (jalaliMatch) {
    isoDate = jalaliToIsoDate(trimmed);
    if (!isoDate) {
      throw new ValidationError(`تاریخ جلالی «${trimmed}» قابل تبدیل به تقویم معتبر نیست`);
    }
  } else if (ISO_DATE_PATTERN.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
      throw new ValidationError(`تاریخ «${trimmed}» یک روز تقویمی معتبر نیست`);
    }
  } else {
    throw new ValidationError(`فرمت تاریخ تراکنش نامعتبر است («${trimmed}»). فرمت‌های مجاز: YYYY-MM-DD میلادی یا 14xx/xx/xx جلالی`);
  }

  const businessToday = await businessTodayIsoDate();
  if (isoDate > businessToday) {
    throw new ValidationError(`تاریخ تراکنش («${trimmed}») نمی‌تواند در آینده باشد؛ تاریخ امروز کسب‌وکار «${businessToday}» است`);
  }
  return isoDate;
}

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
   * v9.0.72 (TD-507، ت۴ الف): «متفرقه» و «سایر» پرسنل سرفصلی را می‌گیرند که کاربر انتخاب کرده است (`contraAccountId`)؛
   * پیش‌تر «متفرقه» به دریافتنی تجاری و «سایر» به حقوق پرداختنی می‌رفت.
   */
  static async resolveContraAccount(
    partyType: string,
    purpose: string | null | undefined,
    tx?: DbExecutor,
    contraAccountId?: number | null
  ): Promise<{ account: Account | null; fallbackGeneralId: number | null; conceptLabel: string }> {
    let account: Account | null = null;
    let conceptLabel = '';

    if (needsChosenContraAccount(partyType, purpose)) {
      if (!contraAccountId) return { account: null, fallbackGeneralId: null, conceptLabel: 'سرفصل طرف مقابل' };
      account = await requireChoosableContraAccount(tx, contraAccountId);
      return { account, fallbackGeneralId: null, conceptLabel: account.name };
    }

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
    method?: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
    amount: number;
    currency?: string;
    bankAccountId: number;
    partyType?: string;
    purpose?: string;
    partyId?: number | null;
    partyName?: string;
    contraAccountId?: number | null;
  }): Promise<{
    debit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null;
    credit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null;
    warnings: string[];
    contraConceptLabel: string;
  }> {
    const amount = Number(data.amount) || 0;
    const warnings: string[] = [];
    // v8.0.26 (TD-278): روش «چک» در فرم خزانه ثبت نمی‌شود؛ پیش‌نمایش سندی برای آن ساخته نمی‌شود
    if (data.method === 'cheque') {
      warnings.push('روش «چک» در فرم خزانه پذیرفته نمی‌شود؛ چک را از «مدیریت چک‌های صیادی» (دفتر چک) ثبت کنید.');
    }

    const [bank] = await orm.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, data.bankAccountId), eq(bankAccounts.isDeleted, 0)));
    if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');

    if (!bank.accountId) {
      warnings.push('این حساب بانکی/صندوق به چارت حساب‌ها متصل نیست — سند دوبل صادر نخواهد شد. از ویرایش حساب، کدینگ معین را متصل کنید.');
    }

    if (bank.currency && (data.currency || bank.currency) !== bank.currency) {
      warnings.push(`ارز تراکنش با ارز حساب «${bank.title}» (${bank.currency}) هم‌خوانی ندارد`);
    }

    let contra: Awaited<ReturnType<typeof TreasuryTransactionService.resolveContraAccount>>;
    try {
      contra = await this.resolveContraAccount(data.partyType || 'other', data.purpose, undefined, data.contraAccountId);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      warnings.push(err.message);
      contra = { account: null, fallbackGeneralId: null, conceptLabel: 'سرفصل طرف مقابل' };
    }
    const contraAccountId = contra?.account?.id || contra?.fallbackGeneralId || null;
    if (!contraAccountId && needsChosenContraAccount(data.partyType || 'other', data.purpose)) {
      warnings.push('سرفصل طرف مقابل را انتخاب کنید؛ تا انتخاب نشود سند صادر نمی‌شود.');
    } else if (!contraAccountId) {
      warnings.push(`حساب معین «${contra.conceptLabel}» در چارت یافت نشد — سند صادر نخواهد شد (از تنظیمات ← تنظیمات حسابداری پیکربندی کنید)`);
    }

    if (amount <= 0) {
      warnings.push('مبلغ باید بزرگ‌تر از صفر باشد');
    }

    let treasuryAccount: Account | null = null;
    const treasuryDetailedName = bank.title;

    if (bank.accountId && data.method !== 'cheque') {
      const [acc] = await orm.select().from(accounts).where(and(eq(accounts.id, bank.accountId), eq(accounts.isDeleted, 0)));
      treasuryAccount = (acc as unknown as Account) || null;
    }

    let debit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null = null;
    let credit: { accountId: number; accountCode: string; accountName: string; detailedName: string; amount: number } | null = null;
    if (amount > 0 && treasuryAccount && contraAccountId) {
      const accById = new Map((await orm.select().from(accounts).where(eq(accounts.isDeleted, 0))).map(a => [a.id, a]));
      const contraAcc = accById.get(contraAccountId);
      const isReceipt = data.type === 'receipt';

      const debitAcc = isReceipt ? treasuryAccount : contraAcc;
      const creditAcc = isReceipt ? contraAcc : treasuryAccount;

      debit = {
        accountId: debitAcc?.id || 0,
        accountCode: debitAcc?.code || '',
        accountName: debitAcc?.name || '',
        detailedName: isReceipt ? treasuryDetailedName : (data.partyName || 'طرف حساب'),
        amount,
      };
      credit = {
        accountId: creditAcc?.id || 0,
        accountCode: creditAcc?.code || '',
        accountName: creditAcc?.name || '',
        detailedName: isReceipt ? (data.partyName || 'طرف حساب') : treasuryDetailedName,
        amount,
      };
    }

    return { debit, credit, warnings, contraConceptLabel: contra.conceptLabel };
  }

  static async getTreasuryTransactions(params: {
    // v7.0.110 (TD-240): «all» یعنی بدون فیلتر نوع (مانند فهرست اسناد حسابداری)
    type?: 'receipt' | 'payment' | 'all';
    bankAccountId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<TreasuryTransaction[]> {
    const conditions = [eq(treasuryTransactions.isDeleted, 0)];

    if (params.type && params.type !== 'all') {
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
      purpose: treasuryTransactions.purpose,
      contraAccountId: treasuryTransactions.contraAccountId,
      contraAccountName: accounts.name,
      // V1.6.0: وضعیت آشتی‌سنجی بانکی
      reconciled: treasuryTransactions.reconciled,
      reconciledAt: treasuryTransactions.reconciledAt,
      reconciledBatch: treasuryTransactions.reconciledBatch,
      // V1.5.0: هویت ثبت‌کننده (یک موجودیت کاربر)
      createdById: treasuryTransactions.createdById,
      creatorName: users.fullName,
      description: treasuryTransactions.description,
      status: treasuryTransactions.status,
      attachments: treasuryTransactions.attachments,
      createdAt: treasuryTransactions.createdAt,
    })
    .from(treasuryTransactions)
    .leftJoin(bankAccounts, eq(bankAccounts.id, treasuryTransactions.bankAccountId))
    .leftJoin(users, eq(users.id, treasuryTransactions.createdById))
    .leftJoin(accounts, eq(accounts.id, treasuryTransactions.contraAccountId))
    .where(and(...conditions))
    .orderBy(desc(treasuryTransactions.date), desc(treasuryTransactions.id));

    return rawList.map(t => ({
      ...t,
      amount: t.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
      exchangeRate: t.exchangeRate?.toNumber() ?? null,
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
    } as TreasuryTransaction));
  }

  static async createTreasuryTransaction(data: {
    type: 'receipt' | 'payment';
    date?: string;
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
    /** v8.0.118 (TD-409): کاربر مجوز «ثبت خزانه و چک بدون سند حسابداری» را دارد (روت می‌سنجد، نه بدنه درخواست) */
    allowNoVoucher?: boolean;
    attachments?: unknown[];
    // V1.8.0: انگیزه پرداخت به پرسنل — 'settlement' (تسویه حقوق) | 'advance' (مساعده) | 'other' (v9.0.72)
    purpose?: string;
    /** v9.0.72 (TD-507): سرفصل طرف مقابلی که کاربر برای «متفرقه» و «سایر» پرسنل انتخاب کرده است */
    contraAccountId?: number | null;
  }): Promise<TreasuryTransaction> {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ تراکنش باید بزرگتر از صفر باشد');
    // v8.0.26 (TD-278، تصمیم مالک محصول — گزینه الف): روش «چک» در فرم خزانه پذیرفته نمی‌شود؛ چک فقط از «دفتر چک» ثبت
    // می‌شود. پیش‌تر این روش اسناد دریافتنی/پرداختنی را بدهکار/بستانکار می‌کرد ولی رکورد چکی نمی‌ساخت که روزی وصول،
    // برگشت یا خرج شود، و ثبت همان چک در دفتر چک آن را دوبار به حساب مشتری می‌برد. تراکنش‌های چکی پیشین ابطال‌پذیرند.
    if (data.method === 'cheque') {
      throw new ValidationError('روش «چک» در فرم خزانه پذیرفته نمی‌شود؛ چک دریافتی یا پرداختی را از «مدیریت چک‌های صیادی» (دفتر چک) ثبت کنید.');
    }
    // v8.0.118 (TD-409، تصمیم مالک محصول — گزینه الف): بدون سند حسابداری فقط با مجوز جدا
    assertNoVoucherAllowed(data.createVoucher, data.allowNoVoucher, data.type === 'receipt' ? 'دریافت' : 'پرداخت');
    // v9.0.72 (TD-507، ت۴ الف): پرسنل هدف می‌خواهد و «متفرقه» و «سایر» سرفصل طرف مقابل؛ هر دو روی ردیف ذخیره می‌شوند
    const partyType = data.partyType || 'other';
    const party = normalizePartyPurpose(partyType, data.purpose, data.contraAccountId);
    // TD-105: تاریخ سرور-authoritative — پیش‌فرض business clock + اعتبارسنجی بازه
    const resolvedDate = await resolveTreasuryBusinessDate(data.date);

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      ]);
      // سرفصل انتخابی حتی در ثبت بی‌سند سنجیده می‌شود تا ردیف به حساب نامجاز اشاره نکند
      if (party.contraAccountId) await requireChoosableContraAccount(txEngine, party.contraAccountId);
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
      // v8.0.20 (TD-274): نرخ تسعیر تراکنش ارزی (صریح، فاکتور تسویه‌شده، تنظیمات)؛ بدون نرخ رد می‌شود، هرگز نرخ ۱
      const txExchangeRate = await resolveTreasuryExchangeRate(txEngine, txCurrency, data.exchangeRate, data.documentId);

      const txNum = await this.generateTransactionNumber(data.type, txEngine);

      const currentBal = fin(bank.currentBalance);
      // V9-1.3: محاسبه موجودی بانک با FinancialDecimal — حذف خطای شناور float
      const newBal = data.type === 'receipt'
        ? currentBal.add(amount).round(4)
        : currentBal.subtract(amount).round(4);
      // V1.4.0: سیاست مانده منفی ممنوع — پرداخت بیش از مانده رد می‌شود
      if (newBal.isNegative()) {
        throw new ValidationError(`مانده حساب «${bank.title}» کافی نیست (مانده فعلی: ${currentBalFa(currentBal)})`);
      }
      await txEngine.update(bankAccounts).set({ currentBalance: money(newBal) }).where(eq(bankAccounts.id, data.bankAccountId));

      let voucherId: number | null = null;
      if (data.createVoucher !== false) {
        if (!bank.accountId) {
          throw new ValidationError('حساب معین مرتبط در چارت حساب‌ها برای این حساب بانکی/صندوق تعریف نشده است');
        }

        // V1.8.0: طرف حساب متقابل از منطق مشترک (مپینگ + purpose)
        const contra = await this.resolveContraAccount(partyType, party.purpose, txEngine, party.contraAccountId);
        const contraAccountId = contra?.account?.id || contra?.fallbackGeneralId || null;

        if (!contraAccountId) {
          throw new NotFoundError('حساب معین طرف حساب در چارت حساب‌ها یافت نشد (آن را از تنظیمات ← تنظیمات حسابداری پیکربندی کنید)');
        }

        const treasuryAccountId: number = bank.accountId;
        const treasuryDetailedType = 'bank_account';
        const treasuryDetailedId: number | null = bank.id;
        const treasuryDetailedName = bank.title;

        const descText = data.description || `${data.type === 'receipt' ? 'دریافت' : 'پرداخت'} ${data.method === 'cash' ? 'نقدی' : data.method === 'pos' ? 'کارتخوان' : 'حواله بانکی'} از/به ${data.partyName}`;
        
        const debitAccountId = data.type === 'receipt' ? treasuryAccountId : contraAccountId;
        const creditAccountId = data.type === 'receipt' ? contraAccountId : treasuryAccountId;

        const v = await VoucherService.createJournalVoucher({
          date: resolvedDate,
          voucherType: 'treasury',
          description: descText,
          referenceModule: 'treasury',
          referenceNumber: txNum,
          currency: txCurrency,
          userId: data.userId,
          username: data.username,
          items: [
            {
              accountId: debitAccountId!,
              detailedType: data.type === 'receipt' ? treasuryDetailedType : (data.partyType || 'other'),
              detailedId: data.type === 'receipt' ? treasuryDetailedId : data.partyId,
              detailedName: data.type === 'receipt' ? treasuryDetailedName : data.partyName,
              debit: amount,
              credit: 0,
              currency: txCurrency,
              exchangeRate: txExchangeRate,
              description: descText,
            },
            {
              accountId: creditAccountId!,
              detailedType: data.type === 'receipt' ? (data.partyType || 'other') : treasuryDetailedType,
              detailedId: data.type === 'receipt' ? data.partyId : treasuryDetailedId,
              detailedName: data.type === 'receipt' ? data.partyName : treasuryDetailedName,
              debit: 0,
              credit: amount,
              currency: txCurrency,
              exchangeRate: txExchangeRate,
              description: descText,
            }
          ]
        }, txEngine);
        voucherId = v.id;
      }

      const [tx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: txNum,
        type: data.type,
        date: resolvedDate,
        method: data.method,
        amount: money(amount),
        currency: txCurrency,
        exchangeRate: money(txExchangeRate),
        bankAccountId: data.bankAccountId,
        partyType,
        partyId: data.partyId || null,
        partyName: data.partyName.trim(),
        purpose: party.purpose,
        contraAccountId: party.contraAccountId,
        trackingNumber: data.trackingNumber?.trim() || '',
        voucherId,
        documentId: data.documentId || null,
        description: data.description?.trim() || '',
        status: 'completed',
        attachments: [],
        createdById: data.userId || null,
      }).returning();
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      tx.attachments = await AttachmentStorageService.attachToNewRecord(txEngine, 'treasury_transaction', tx.id, data.attachments, data.username);

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
        amount: tx.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
        exchangeRate: tx.exchangeRate?.toNumber() ?? null,
        type: tx.type as 'receipt' | 'payment',
        method: tx.method as TreasuryTransaction['method'],
        partyType: tx.partyType as TreasuryTransaction['partyType'],
        status: tx.status as TreasuryTransaction['status'],
        bankAccountTitle: bank.title,
      } as TreasuryTransaction;
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

      // v8.0.73 (TD-341، تصمیم مالک محصول — گزینه الف «ابطال هر دو»): هر طرف انتقال بین بانک‌ها (دو ردیف با یک سند
      // مشترک) با طرف دیگرش باطل می‌شود: هر دو ردیف، هر دو مانده و سند مشترک با هم. پیش‌تر ابطال یک طرف سند مشترک را
      // باطل و فقط مانده همان بانک را برمی‌گرداند و طرف دیگر دیگر باطل‌شدنی نبود. قفل‌ها به ترتیب اعلام‌شده: بانک‌ها (سطح ۱۰،
      // به ترتیب شناسه) سپس ردیف‌های خزانه (سطح ۸۰)؛ پیش‌تر ردیف خزانه پیش از بانک قفل می‌شد.
      const [peeked] = await txEngine.select({ id: treasuryTransactions.id }).from(treasuryTransactions)
        .where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)));
      if (!peeked) throw new NotFoundError('تراکنش خزانه یافت نشد');
      const sideIds = await this.transferSideIds(txEngine, id);
      const sidesPeek = await txEngine.select({ bankAccountId: treasuryTransactions.bankAccountId }).from(treasuryTransactions)
        .where(inArray(treasuryTransactions.id, sideIds));
      const bankIds = [...new Set(sidesPeek.map(r => Number(r.bankAccountId || 0)))].sort((a, b) => a - b);
      const banks = await txEngine.select().from(bankAccounts)
        .where(and(inArray(bankAccounts.id, bankIds), eq(bankAccounts.isDeleted, 0)))
        .orderBy(asc(bankAccounts.id))
        .for('update');
      const sides = await txEngine.select().from(treasuryTransactions)
        .where(and(inArray(treasuryTransactions.id, sideIds), eq(treasuryTransactions.isDeleted, 0)))
        .orderBy(asc(treasuryTransactions.id))
        .for('update');

      const original = sides.find(t => t.id === id);
      if (!original) throw new NotFoundError('تراکنش خزانه یافت نشد');
      if (original.status === 'voided') {
        throw new ConflictError('این تراکنش قبلاً ابطال شده است');
      }
      // تراکنش‌های متصل به پرداخت حقوق باید از مسیر خود حقوق مدیریت شوند (اتمیک بودن فیش)
      if (original.payrollId) {
        throw new BusinessLogicError('این تراکنش یک پرداخت حقوق ثبت‌شده است و از این مسیر قابل ابطال نیست؛ آن را از پنجره پرداخت همان فیش («ابطال پرداخت») ابطال کنید.');
      }
      // v9.0.67 (TD-499، تصمیم مالک محصول ت۱ الف): ردیف معکوس («ابطال تراکنش دیگر») ابطال نمی‌شود. پیش‌تر ابطال آن اثر اصل
      // را «احیا» می‌کرد؛ وقتی سند پیش‌نویس اصل در ابطال اول حذف نرم شده بود، پول بی هیچ سندی به بانک برمی‌گشت (دور زدن TD-409).
      if (original.reversalOfId !== null) {
        throw new ConflictError('این ردیف ابطالِ تراکنش دیگری است و ابطال نمی‌شود؛ برای ثبت دوباره، تراکنش تازه ثبت کنید.');
      }
      // طرفی که پیش‌تر جدا باطل شده (پیش از v8.0.73) سند مشترک را هم باطل کرده است؛ این طرف فقط مانده و ردیف خودش را برمی‌گرداند
      const partner = sides.find(t => t.id !== id && t.status !== 'voided');
      const isTransfer = sideIds.length > 1;

      // سند معکوس اتوماتیک (اگر اصل سند دارد و طرف دیگر انتقال آن را پیش‌تر باطل نکرده است)
      let reversalVoucherId: number | null = null;
      const sharedVoucherVoided = isTransfer && !partner;
      if (original.voucherId && !sharedVoucherVoided) {
        // v8.0.2 (TD-251، تصمیم مالک محصول): سند پیش‌نویس حذف نرم می‌شود و سند معکوس نمی‌گیرد
        const rv = await VoucherService.voidSourceVoucher({
          voucherId: original.voucherId,
          reason: partner
            ? `ابطال انتقال ${original.transactionNumber} و ${partner.transactionNumber} — ${reason}`
            : `ابطال تراکنش ${original.transactionNumber} — ${reason}`,
          userId: params.userId,
          username: params.username,
          externalTx: txEngine,
        });
        reversalVoucherId = rv.reversalVoucherId;
      }

      let originalReversal: TreasuryTransaction | null = null;
      for (const side of partner ? [original, partner] : [original]) {
        const bank = banks.find(b => b.id === side.bankAccountId);
        if (!bank) throw new NotFoundError('حساب بانکی مرتبط با تراکنش یافت نشد');
        const reversal = await this.voidTreasurySide(txEngine, side, bank, reversalVoucherId, reason,
          side.id === original.id ? '' : ` (طرف دیگر انتقال ${original.transactionNumber})`, params);
        if (side.id === original.id) originalReversal = reversal;
      }
      return originalReversal as TreasuryTransaction;
    });
  }

  /**
   * v8.0.73 (TD-341): ردیف‌های یک انتقال بین بانک‌ها — تراکنش داده‌شده و طرف دیگرش (همان سند مشترک، نوع مخالف، روش
   * bank_transfer، هر دو اصل یا هر دو معکوس). تراکنشی که انتقال نیست فقط خودش است. انتقالی که بی سند ثبت شده (فقط از API)
   * پیوندی ندارد و هر طرفش جدا باطل می‌شود؛ بی سند مشترک، ابطال یک طرف اثری بر طرف دیگر ندارد.
   */
  private static async transferSideIds(txEngine: DbExecutor, id: number): Promise<number[]> {
    const [row] = await txEngine.select({
      voucherId: treasuryTransactions.voucherId, type: treasuryTransactions.type, method: treasuryTransactions.method,
      reversalOfId: treasuryTransactions.reversalOfId,
    }).from(treasuryTransactions).where(eq(treasuryTransactions.id, id));
    if (!row?.voucherId || row.method !== 'bank_transfer') return [id];
    const partners = await txEngine.select({ id: treasuryTransactions.id }).from(treasuryTransactions)
      .where(and(
        eq(treasuryTransactions.voucherId, row.voucherId),
        eq(treasuryTransactions.isDeleted, 0),
        eq(treasuryTransactions.method, 'bank_transfer'),
        eq(treasuryTransactions.type, row.type === 'receipt' ? 'payment' : 'receipt'),
        row.reversalOfId === null ? sql`${treasuryTransactions.reversalOfId} IS NULL` : sql`${treasuryTransactions.reversalOfId} IS NOT NULL`,
        sql`${treasuryTransactions.id} <> ${id}`
      ));
    return partners.length === 1 ? [id, partners[0].id] : [id];
  }

  /** یک طرف ابطال: برگشت مانده بانک، ردیف معکوس با شماره سری جدید، نشان «باطل‌شده» روی اصل و رویداد Outbox */
  private static async voidTreasurySide(
    txEngine: DbExecutor,
    original: typeof treasuryTransactions.$inferSelect,
    bank: typeof bankAccounts.$inferSelect,
    reversalVoucherId: number | null,
    reason: string,
    pairNote: string,
    params: { userId?: number; username?: string }
  ): Promise<TreasuryTransaction> {
    if (original.payrollId) {
      throw new BusinessLogicError('این تراکنش یک پرداخت حقوق ثبت‌شده است و از این مسیر قابل ابطال نیست؛ آن را از پنجره پرداخت همان فیش («ابطال پرداخت») ابطال کنید.');
    }
    // اصلاح مانده: معکوس اثر اصل
    // V6 Sub-phase 1.2 (TD-148): اگر روش تراکنش چک بوده، مانده بانک در ثبت اصل تغییر نکرده بود؛
    // بنابراین در ابطال نیز مانده حساب بانکی نباید تغییر کند
    const amount = money(original.amount);
    if (original.method !== 'cheque') {
      const currentBal = fin(bank.currentBalance);
      const newBal = original.type === 'receipt'
        ? currentBal.subtract(amount).round(4)
        : currentBal.add(amount).round(4);
      if (newBal.isNegative()) {
        throw new ValidationError(`ابطال ممکن نیست: مانده فعلی «${bank.title}» (${currentBalFa(currentBal)}) برای برگشت این وجه کافی نیست`);
      }
      await txEngine.update(bankAccounts).set({ currentBalance: money(newBal) }).where(eq(bankAccounts.id, bank.id));
      bank.currentBalance = money(newBal);
    }

    // تراکنش معکوس با شماره سری جدید
    const reversalType = original.type === 'receipt' ? 'payment' : 'receipt';
    const reversalNum = await this.generateTransactionNumber(reversalType, txEngine);

    const [reversalTx] = await txEngine.insert(treasuryTransactions).values({
      transactionNumber: reversalNum,
      type: reversalType,
      date: await businessTodayIsoDate(),
      method: original.method,
      amount,
      currency: original.currency || bank.currency || 'IRR',
      exchangeRate: moneyOr(original.exchangeRate, 1),
      bankAccountId: original.bankAccountId,
      partyType: original.partyType,
      partyId: original.partyId,
      partyName: original.partyName,
      purpose: original.purpose,
      contraAccountId: original.contraAccountId,
      trackingNumber: original.trackingNumber || '',
      voucherId: reversalVoucherId,
      chequeId: original.chequeId || null,
      documentId: original.documentId || null,
      reversalOfId: original.id,
      description: `ابطال تراکنش ${original.transactionNumber}${pairNote} — دلیل: ${reason}`,
      status: 'completed',
      createdById: params.userId || null,
    }).returning();

    // نشان‌گذاری اصل به‌عنوان voided (soft — بدون حذف)
    await txEngine.update(treasuryTransactions)
      .set({ status: 'voided', updatedAt: sql`now()` })
      .where(eq(treasuryTransactions.id, original.id));

    // Outbox event (same tx)
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
      amount: reversalTx.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
      exchangeRate: reversalTx.exchangeRate?.toNumber() ?? null,
      type: reversalTx.type as 'receipt' | 'payment',
      method: reversalTx.method as TreasuryTransaction['method'],
      partyType: reversalTx.partyType as TreasuryTransaction['partyType'],
      status: reversalTx.status as TreasuryTransaction['status'],
      bankAccountTitle: bank.title,
    } as TreasuryTransaction;
  }

  /**
   * V1.5.0: انتقال بین‌بانکی/بین‌صندوقی
   * دو ردیف خزانه (پرداخت از مبدأ + دریافت در مقصد) + یک سند دوبل متوازن
   * (بدهکار حساب مقصد / بستانکار حساب مبدأ) همه در یک تراکنش دیتابیس.
   * هر دو حساب هم‌ارز باید باشند و مانده مبدأ منفی نمی‌شود.
   */
  static async createTreasuryTransfer(data: {
    date?: string;
    amount: number;
    currency?: string;
    fromBankAccountId: number;
    toBankAccountId: number;
    trackingNumber?: string;
    description?: string;
    userId?: number;
    username?: string;
    createVoucher?: boolean;
    /** v8.0.118 (TD-409): کاربر مجوز «ثبت خزانه و چک بدون سند حسابداری» را دارد */
    allowNoVoucher?: boolean;
    /** v8.0.20 (TD-274): نرخ تسعیر انتقال ارزی (ریال برای هر واحد) */
    exchangeRate?: number;
  }): Promise<{ payment: TreasuryTransaction; receipt: TreasuryTransaction; voucherId: number | null }> {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ انتقال باید بزرگتر از صفر باشد');
    if (data.fromBankAccountId === data.toBankAccountId) {
      throw new ValidationError('حساب مبدأ و مقصد باید متفاوت باشند');
    }
    assertNoVoucherAllowed(data.createVoucher, data.allowNoVoucher, 'انتقال وجه');
    // TD-105: تاریخ سرور-authoritative — پیش‌فرض business clock + اعتبارسنجی بازه
    const resolvedDate = await resolveTreasuryBusinessDate(data.date);

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
      // v8.0.20 (TD-274): انتقال ارزی با نرخ تسعیر (صریح یا تنظیمات)، هرگز نرخ ۱
      const transferRate = await resolveTreasuryExchangeRate(txEngine, currency, data.exchangeRate);

      // مانده‌ها با fin()
      const fromNewBal = fin(from.currentBalance).subtract(amount).round(4);
      if (fromNewBal.isNegative()) {
        throw new ValidationError(`مانده حساب مبدأ «${from.title}» کافی نیست (مانده فعلی: ${currentBalFa(from.currentBalance)})`);
      }
      const toNewBal = fin(to.currentBalance).add(amount).round(4);
      await txEngine.update(bankAccounts).set({ currentBalance: money(fromNewBal) }).where(eq(bankAccounts.id, from.id));
      await txEngine.update(bankAccounts).set({ currentBalance: money(toNewBal) }).where(eq(bankAccounts.id, to.id));

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
          date: resolvedDate,
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
              exchangeRate: transferRate,
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
              exchangeRate: transferRate,
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
        date: resolvedDate,
        method: 'bank_transfer',
        amount: money(amount),
        currency,
        exchangeRate: money(transferRate),
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
        date: resolvedDate,
        method: 'bank_transfer',
        amount: money(amount),
        currency,
        exchangeRate: money(transferRate),
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

      // قرارداد API: مبلغ عدد (P2-6)
      const asDto = (t: typeof payTx) => ({ ...t, amount: t.amount.toNumber(), exchangeRate: t.exchangeRate?.toNumber() ?? null }) as unknown as TreasuryTransaction;
      return { payment: asDto(payTx), receipt: asDto(recTx), voucherId };
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

      // P2-05: گارد ممانعت از ثبت مجدد تراکنش‌های قبلاً تطبیق‌یافته در سرور
      if (params.reconciled) {
        const alreadyReconciledRow = rows.find(r => r.reconciled === 1);
        if (alreadyReconciledRow) {
          throw new BusinessLogicError(
            `تراکنش شماره «${alreadyReconciledRow.transactionNumber}» قبلاً در دسته «${alreadyReconciledRow.reconciledBatch || 'نامشخص'}» تطبیق داده شده است و امکان تطبیق مجدد ندارد.`
          );
        }
      }

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
function currentBalFa(val: DecimalValue): string {
  return fin(val).toNumber().toLocaleString('fa-IR');
}
