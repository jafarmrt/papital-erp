import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions, accounts } from '../../../db/schema.js';
import { eq, and, sql, inArray, asc } from 'drizzle-orm';
import { AccountMappingService } from '../accountMapping.service.js';
import { VoucherService } from '../voucher.service.js';
import { resolveTreasuryExchangeRate } from './treasuryExchangeRate.js';
import { assertNoVoucherAllowed } from './noVoucherTreasury.js';
import { needsChosenContraAccount, normalizePartyPurpose, requireChoosableContraAccount } from './partyContraAccount.js';
import { isSalarySettlementPayment, SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE } from '../../../lib/treasury/partyPurpose.js';
import { assertWithinDocumentRemaining, lockSettlementDocument } from './documentRemaining.js';
import { assertAdvanceVoidKeepsBalance, isAdvancePayment, lockAdvancePersonnel } from './advanceVoidGuard.js';
import { assertPersonnelPartyId, assertTreasuryDocumentLink, documentPartyOfTreasuryLink, resolveTreasuryPartyName } from './treasuryLinks.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { DomainEventType } from '../../events/domainEvents.js';
import { OutboxService } from '../../events/outboxService.js';
import { auditTreasuryTransactionCreated, auditTreasuryTransactionVoided, auditTreasuryTransfer, type TreasuryAuditActor } from './treasuryAudit.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import type { TreasuryTransaction, Account } from '../../../types.js';
import { NotFoundError, ValidationError, ConflictError, BusinessLogicError } from '../../../errors/customErrors.js';
import { AttachmentStorageService } from '../../attachments/attachmentStorage.service.js';
import { resolveTreasuryWriteDate } from './treasuryDate.js';
import { reconcileTreasuryRows, type ReconcileParams, type ReconcileResult } from './bankReconciliation.js';
import type { TreasuryVoucherPreview } from '../../../lib/treasury/treasuryVoucherPreview.js';
import { listTreasuryTransactions, pageTreasuryTransactions, type TreasuryListFilters, type TreasuryTransactionPage } from './treasuryTransactionList.js';
import {
  assertBankCurrency, lockTreasuryBank, nextTreasuryTransactionNumber, postTreasuryRow, reverseTreasuryRow, treasuryEventPayload, isHighValueAmount, treasuryHighValueThreshold, type TreasuryBank, type TreasuryRow,
} from './treasuryPosting.js';

/**
 * TD-105 (v4.0.31): تاریخ تراکنش‌های خزانه «سرور authoritative» است: خالی ← امروز کسب‌وکار، تاریخ آینده ← 422.
 * v9.0.98 (TD-669، B16-05): ورودی با `requireStorageDate` خوانده می‌شود (`resolveTreasuryWriteDate`)؛ روز ناموجود دیگر به
 * روز بعد نمی‌رود.
 */
export async function resolveTreasuryBusinessDate(rawDate?: string | null): Promise<string> {
  return resolveTreasuryWriteDate(rawDate, 'تاریخ تراکنش');
}

export class TreasuryTransactionService {
  /** v10.1.32 (D-16): سند پیش‌نویس خزانه (نوع و ماژول مرجع «خزانه») برای پرداختی که خدمت دیگری از خزانه، صورت‌هزینه تنخواه، می‌سازد */
  static createTreasuryVoucher(
    data: Omit<Parameters<typeof VoucherService.createJournalVoucher>[0], 'voucherType' | 'referenceModule'>,
    txEngine: DbExecutor,
  ) {
    return VoucherService.createJournalVoucher({ ...data, voucherType: 'treasury', referenceModule: 'treasury' }, txEngine);
  }

  /**
   * v10.1.32 (D-16): پیوست‌های ردیف خزانه‌ای که خدمت دیگری از خزانه (صورت‌هزینه تنخواه) با `postTreasuryRow` در همین `tx`
   * درج کرده است؛ رویداد ردیف را خود `postTreasuryRow` می‌نویسد (OBS-R2-52).
   */
  static attachTreasuryRowFiles(txEngine: DbExecutor, rowId: number, attachments: unknown[] | undefined, username?: string) {
    return AttachmentStorageService.attachToNewRecord(txEngine, 'treasury_transaction', rowId, attachments, username);
  }

  static async generateTransactionNumber(type: 'receipt' | 'payment', tx?: DbExecutor): Promise<string> {
    const executor = tx || orm;
    return nextTreasuryTransactionNumber(type, executor);
  }

  /** v10.1.36 (TD-1243): حساب نگاشت‌شده بیمه پرداختنی (3204) یا مالیات حقوق پرداختنی (3206) برای پرداخت یکجای ماهانه */
  static payrollStatutoryPayableAccount(kind: 'insurance' | 'tax', tx?: DbExecutor): Promise<Account | null> {
    return kind === 'insurance' ? AccountMappingService.getInsurancePayableAccount(tx) : AccountMappingService.getPayrollTaxPayableAccount(tx);
  }

  /**
   * V1.8.0: انتخاب طرف حساب متقابل — منطق مشترک بین ثبت و پیش‌نمایش سند
   * purpose برای پرسنل: 'settlement' (تسویه حقوق → 3201) | 'advance' (مساعده → 1301) | 'deductions' (واریز کسورات → 3205)
   * v9.0.82 (TD-507، ت۴ الف): «متفرقه» و «سایر» پرسنل سرفصلی را می‌گیرند که کاربر انتخاب کرده است (`contraAccountId`)؛
   * پیش‌تر «متفرقه» به دریافتنی تجاری و «سایر» به حقوق پرداختنی می‌رفت.
   */
  static async resolveContraAccount(
    partyType: string,
    purpose: string | null | undefined,
    tx?: DbExecutor,
    contraAccountId?: number | null
  ): Promise<{ account: Account | null; conceptLabel: string }> {
    let account: Account | null = null;
    let conceptLabel = '';

    if (needsChosenContraAccount(partyType, purpose)) {
      if (!contraAccountId) return { account: null, conceptLabel: 'سرفصل طرف مقابل' };
      account = await requireChoosableContraAccount(tx, contraAccountId);
      return { account, conceptLabel: account.name };
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
      } else if (purpose === 'deductions') {
        // v10.0.257 (TD-952، ت۵ الف): واریز کسورات فیش با تفصیلی پرسنل، همان حسابی که فیش بستانکار می‌کند
        account = await AccountMappingService.getEmployeeDeductionsPayableAccount(tx);
        conceptLabel = 'سایر کسورات حقوق پرداختنی';
      } else {
        account = await AccountMappingService.getWagesPayableAccount(tx);
        conceptLabel = 'حقوق و دستمزد پرداختنی';
      }
    } else {
      account = (await AccountMappingService.getTradeReceivablesAccount(tx))
        || (await AccountMappingService.getTradePayablesAccount(tx));
      conceptLabel = 'حساب‌های دریافتنی/پرداختنی';
    }

    // v10.0.262 (OWN-03، OBS-R2-04): نبود حساب نگاشت هرگز به حساب کل (دو رقم اول کد) نمی‌رود (قاعده TD-550)؛ پیش‌تر
    // ردیف طرف مقابل روی حساب کل می‌نشست و آن را با اتصال دوم استخر درون تراکنش می‌خواند. ثبت با سند رد می‌شود.
    return { account, conceptLabel };
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
  }): Promise<TreasuryVoucherPreview> {
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
      warnings.push('این حساب بانکی/صندوق به چارت حساب‌ها متصل نیست — سند حسابداری صادر نخواهد شد. از ویرایش حساب، کدینگ معین را متصل کنید.');
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
      contra = { account: null, conceptLabel: 'سرفصل طرف مقابل' };
    }
    const contraAccountId = contra?.account?.id || null;
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

  static async getTreasuryTransactions(params: TreasuryListFilters): Promise<TreasuryTransaction[]> {
    return listTreasuryTransactions(params);
  }

  /** v9.0.102 (TD-509): صفحه‌ای از فهرست خزانه با شمار کل و مانده جاری (صفحه خزانه) */
  static async getTreasuryTransactionPage(params: TreasuryListFilters, page: number, limit: number): Promise<TreasuryTransactionPage> {
    return pageTreasuryTransactions(params, page, limit);
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
    // V1.8.0: انگیزه پرداخت به پرسنل — 'settlement' (تسویه حقوق) | 'advance' (مساعده) | 'deductions' (واریز کسورات، v10.0.257) | 'other' (v9.0.82)
    purpose?: string;
    /** v9.0.82 (TD-507): سرفصل طرف مقابلی که کاربر برای «متفرقه» و «سایر» پرسنل انتخاب کرده است */
    contraAccountId?: number | null;
    /** v10.0.262 (TD-934): ممیزی ثبت با `tx` همین ثبت */
    audit?: TreasuryAuditActor;
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
    // v9.0.82 (TD-507، ت۴ الف): پرسنل هدف می‌خواهد و «متفرقه» و «سایر» سرفصل طرف مقابل؛ هر دو روی ردیف ذخیره می‌شوند
    const partyType = data.partyType || 'other';
    const party = normalizePartyPurpose(partyType, data.purpose, data.contraAccountId);
    // v10.0.57 (TD-925، ت۸ الف): تسویه حقوق فقط از «پرداخت فیش»؛ پرداخت خزانه «تسویه حقوق» همان فیش را دو بار می‌پرداخت
    if (isSalarySettlementPayment(data.type, partyType, party.purpose)) {
      throw new ValidationError(SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE, undefined, 'TREASURY_PAYROLL_SETTLEMENT_VIA_PAYSLIP');
    }
    // TD-105: تاریخ سرور-authoritative — پیش‌فرض business clock + اعتبارسنجی بازه
    const resolvedDate = await resolveTreasuryBusinessDate(data.date);

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
        ...(data.documentId ? [{ name: 'document', hierarchyLevel: LockHierarchyLevel.DOCUMENTS }] : []),
      ]);
      // سرفصل انتخابی حتی در ثبت بی‌سند سنجیده می‌شود تا ردیف به حساب نامجاز اشاره نکند
      if (party.contraAccountId) await requireChoosableContraAccount(txEngine, party.contraAccountId);
      // V1.4.0: قفل حساب با فیلتر isDeleted — ثبت وجه در حساب حذف‌شده ممنوع
      const bank = await lockTreasuryBank(txEngine, data.bankAccountId);
      // v10.0.59 (TD-938): سند پیش از هر خواندن قفل می‌شود تا دو پرداخت همزمان مانده آن را پشت سر هم بسنجند
      if (data.documentId) await lockSettlementDocument(txEngine, data.documentId);
      // v9.0.459 (TD-907): ردیف وصل به سند بی شناسه طرف حساب (فرم تسویه فاکتور) شناسه طرف حساب سند و نام کنونی او را
      // می‌گیرد تا ردیف سند حسابداری و ردیف خزانه با تغییر نام از کارت حساب و نگهبان حذف طرف حساب بیرون نیفتند
      const documentParty = data.documentId && !data.partyId
        ? await documentPartyOfTreasuryLink(txEngine, { type: data.type, documentId: data.documentId, partyType, partyName: data.partyName })
        : null;
      const partyId = data.partyId || documentParty?.id || null;
      const partyName = documentParty?.name ?? data.partyName;
      const txCurrency = data.currency || bank.currency || 'IRR';
      // v9.0.83 (TD-501، B04-05): شناسه طرف حساب در جدول همان نوع، و سند پیوسته فعال، هم‌سو و با همان طرف حساب؛
      // v9.0.460 (TD-908): و با همان ارز ردیف، مانند «وصل دوباره»
      assertPersonnelPartyId(partyType, partyId);
      const partyCurrentName = await resolveTreasuryPartyName(txEngine, partyType, partyId);
      if (data.documentId) {
        await assertTreasuryDocumentLink(txEngine, {
          type: data.type, documentId: data.documentId, partyType, partyId, partyName: partyCurrentName ?? partyName, currency: txCurrency,
        });
        // v10.0.59 (TD-938، ت۸ الف): بیش از مانده سند وصل نمی‌شود؛ مازاد علی‌الحساب است
        await assertWithinDocumentRemaining(txEngine, { documentId: data.documentId, amount });
      }

      // V1.4.0: گارد هم‌ارزی ارز، پیش از نرخ تسعیر تا ارز ناهم‌خوان پیام خودش را بگیرد (`postTreasuryRow` هم آن را می‌سنجد)
      assertBankCurrency(bank, txCurrency);
      // v8.0.20 (TD-274): نرخ تسعیر تراکنش ارزی (صریح، فاکتور تسویه‌شده، تنظیمات)؛ بدون نرخ رد می‌شود، هرگز نرخ ۱
      const txExchangeRate = await resolveTreasuryExchangeRate(txEngine, txCurrency, data.exchangeRate, data.documentId);

      // V1.8.0: طرف حساب متقابل از منطق مشترک (مپینگ + purpose)، پیش از هر نوشتن
      let contraAccountId: number | null = null;
      if (data.createVoucher !== false) {
        if (!bank.accountId) {
          throw new ValidationError('حساب معین مرتبط در چارت حساب‌ها برای این حساب بانکی/صندوق تعریف نشده است', undefined, 'BANK_LEDGER_ACCOUNT_INVALID');
        }
        const contra = await this.resolveContraAccount(partyType, party.purpose, txEngine, party.contraAccountId);
        contraAccountId = contra?.account?.id || null;
        if (!contraAccountId) {
          throw new NotFoundError('حساب معین طرف حساب در چارت حساب‌ها یافت نشد (آن را از تنظیمات ← تنظیمات حسابداری پیکربندی کنید)');
        }
      }

      const descText = data.description || `${data.type === 'receipt' ? 'دریافت' : 'پرداخت'} ${data.method === 'cash' ? 'نقدی' : data.method === 'pos' ? 'کارتخوان' : 'حواله بانکی'} از/به ${partyName}`;
      const treasuryRow = (accountId: number) => ({ accountId, detailedType: 'bank_account', detailedId: bank.id, detailedName: bank.title });
      const partyRow = (accountId: number) => ({ accountId, detailedType: data.partyType || 'other', detailedId: partyId, detailedName: partyName });

      // OBS-R2-52: مانده، شماره، سند، ردیف و رویداد از راه یگانه خزانه
      const { row: tx } = await postTreasuryRow(txEngine, bank, {
        type: data.type,
        date: resolvedDate,
        method: data.method,
        amount,
        currency: txCurrency,
        exchangeRate: txExchangeRate,
        partyType,
        partyId,
        partyName: partyName.trim(),
        purpose: party.purpose,
        contraAccountId: party.contraAccountId,
        trackingNumber: data.trackingNumber?.trim() || '',
        documentId: data.documentId || null,
        description: data.description?.trim() || '',
        createdById: data.userId || null,
        voucher: contraAccountId === null ? null : (transactionNumber) => VoucherService.createJournalVoucher({
          date: resolvedDate,
          voucherType: 'treasury',
          description: descText,
          referenceModule: 'treasury',
          referenceNumber: transactionNumber,
          currency: txCurrency,
          userId: data.userId,
          username: data.username,
          items: [
            {
              ...(data.type === 'receipt' ? treasuryRow(Number(bank.accountId)) : partyRow(contraAccountId)),
              debit: amount,
              credit: 0,
              currency: txCurrency,
              exchangeRate: txExchangeRate,
              description: descText,
            },
            {
              ...(data.type === 'receipt' ? partyRow(contraAccountId) : treasuryRow(Number(bank.accountId))),
              debit: 0,
              credit: amount,
              currency: txCurrency,
              exchangeRate: txExchangeRate,
              description: descText,
            }
          ]
        }, txEngine),
        // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with treasury transaction)
        event: (rowId) => ({
          transactionId: rowId,
          type: data.type === 'receipt' ? 'deposit' : 'withdrawal',
          currency: txCurrency,
          accountId: bank.id,
          accountName: bank.title,
        }),
        actor: { userId: data.userId, username: data.username },
      });
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      tx.attachments = await this.attachTreasuryRowFiles(txEngine, tx.id, data.attachments, data.username);

      const created = treasuryRowDto(tx, bank);
      await auditTreasuryTransactionCreated(txEngine, data.audit, created, { ...created });
      return created;
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
    /** v10.0.262 (TD-934): ممیزی ابطال با `tx` همین ابطال */
    audit?: TreasuryAuditActor;
  }): Promise<TreasuryTransaction> {
    const reason = (params.reason || '').trim();
    if (!reason) throw new ValidationError('دلیل ابطال الزامی است');

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
        { name: 'personnel', hierarchyLevel: LockHierarchyLevel.PARTIES },
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
      // v10.0.58 (TD-926): پرداخت مساعده ردیف پرسنل را پس از بانک و پیش از ردیف خزانه قفل می‌کند، همان قفل صدور فیش
      const [advancePeek] = await txEngine.select({
        type: treasuryTransactions.type, partyType: treasuryTransactions.partyType, purpose: treasuryTransactions.purpose, partyId: treasuryTransactions.partyId,
      }).from(treasuryTransactions).where(eq(treasuryTransactions.id, id));
      if (advancePeek && isAdvancePayment(advancePeek)) await lockAdvancePersonnel(txEngine, Number(advancePeek.partyId));
      const sides = await txEngine.select().from(treasuryTransactions)
        .where(and(inArray(treasuryTransactions.id, sideIds), eq(treasuryTransactions.isDeleted, 0)))
        .orderBy(asc(treasuryTransactions.id))
        .for('update');

      const original = sides.find(t => t.id === id);
      if (!original) throw new NotFoundError('تراکنش خزانه یافت نشد');
      if (original.status === 'voided') {
        throw new ConflictError('این تراکنش قبلاً ابطال شده است');
      }
      // تراکنش‌های متصل به پرداخت حقوق باید از مسیر خود حقوق مدیریت شوند (اتمیک بودن فیش)؛ هر دو طرف یک انتقال، پیش از هر نوشتن
      if (sides.some(side => side.payrollId)) {
        throw new BusinessLogicError('این تراکنش یک پرداخت حقوق ثبت‌شده است و از این مسیر قابل ابطال نیست؛ آن را از پنجره پرداخت همان فیش («ابطال پرداخت») ابطال کنید.');
      }
      // v9.0.67 (TD-499، تصمیم مالک محصول ت۱ الف): ردیف معکوس («ابطال تراکنش دیگر») ابطال نمی‌شود. پیش‌تر ابطال آن اثر اصل
      // را «احیا» می‌کرد؛ وقتی سند پیش‌نویس اصل در ابطال اول حذف نرم شده بود، پول بی هیچ سندی به بانک برمی‌گشت (دور زدن TD-409).
      if (original.reversalOfId !== null) {
        throw new ConflictError('این ردیف ابطالِ تراکنش دیگری است و ابطال نمی‌شود؛ برای ثبت دوباره، تراکنش تازه ثبت کنید.');
      }
      // v10.0.58 (TD-926، ت۸ الف): مساعده‌ای که فیش زنده کسر کرده باطل نمی‌شود (مانده مساعده منفی می‌شد)
      if (isAdvancePayment(original)) {
        await assertAdvanceVoidKeepsBalance(txEngine, original, await AccountMappingService.getEmployeeAdvanceAccount(txEngine));
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
        const pairNote = side.id === original.id ? '' : ` (طرف دیگر انتقال ${original.transactionNumber})`;
        const reversalRow = await reverseTreasuryRow(txEngine, side, bank, {
          reversalVoucherId,
          description: `ابطال تراکنش ${side.transactionNumber}${pairNote} — دلیل: ${reason}`,
          createdById: params.userId || null,
          event: (row) => ({
            transactionId: row.id,
            voidedTransactionId: side.id,
            voidedTransactionNumber: side.transactionNumber,
            type: row.type === 'receipt' ? 'deposit' : 'withdrawal',
            isReversal: true,
            currency: side.currency || bank.currency || 'IRR',
            accountId: bank.id,
            accountName: bank.title,
          }),
          actor: { userId: params.userId, username: params.username },
        });
        if (side.id === original.id) originalReversal = treasuryRowDto(reversalRow, bank);
      }
      const reversal = originalReversal as TreasuryTransaction;
      await auditTreasuryTransactionVoided(txEngine, params.audit, original, { id: reversal.id, transactionNumber: reversal.transactionNumber, voucherId: reversal.voucherId ?? null }, reason);
      return reversal;
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
    /** v10.0.262 (TD-934): ممیزی انتقال با `tx` همین انتقال */
    audit?: TreasuryAuditActor;
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

      // Outbox (همان تراکنش)؛ بی مبلغ و شرح (۱۰.۲ بسته ۸، TD-1297)
      const transferEvent = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(recTx.id),
        treasuryEventPayload({
          transactionId: recTx.id,
          pairedTransactionId: payTx.id,
          isTransfer: true,
          currency,
          fromAccountId: from.id,
          fromAccountName: from.title,
          toAccountId: to.id,
          toAccountName: to.title,
          isHighValue: isHighValueAmount(amount, currency, transferRate, await treasuryHighValueThreshold(txEngine)),
        }),
        { userId: data.userId, userName: data.username }
      );
      await OutboxService.saveToOutbox(txEngine, transferEvent);

      // قرارداد API: مبلغ عدد (P2-6)
      const asDto = (t: typeof payTx) => ({ ...t, amount: t.amount.toNumber(), exchangeRate: t.exchangeRate?.toNumber() ?? null }) as unknown as TreasuryTransaction;
      await auditTreasuryTransfer(txEngine, data.audit, {
        paymentId: payTx.id, receiptId: recTx.id, voucherId, amount,
        fromBankAccountId: data.fromBankAccountId, toBankAccountId: data.toBankAccountId,
      });
      return { payment: asDto(payTx), receipt: asDto(recTx), voucherId };
    });
  }

  /**
   * V1.6.0: آشتی‌سنجی بانکی — علامت‌گذاری گروهی تراکنش‌های تطبیق‌یافته با صورت‌حساب بانک
   * (matching سمت کلاینت انجام می‌شود). v9.0.103 (TD-511): قواعد و ممیزی در `reconcileTreasuryRows`.
   */
  static async reconcileTransactions(params: ReconcileParams): Promise<ReconcileResult> {
    return reconcileTreasuryRows(params);
  }
}

/** قرارداد API ردیف خزانه: مبلغ و نرخ عدد (P2-6) با نام حساب */
function treasuryRowDto(row: TreasuryRow, bank: TreasuryBank): TreasuryTransaction {
  return {
    ...row,
    amount: row.amount.toNumber(),
    exchangeRate: row.exchangeRate?.toNumber() ?? null,
    type: row.type as 'receipt' | 'payment',
    method: row.method as TreasuryTransaction['method'],
    partyType: row.partyType as TreasuryTransaction['partyType'],
    status: row.status as TreasuryTransaction['status'],
    bankAccountTitle: bank.title,
  } as TreasuryTransaction;
}

// V1.5.0: helper کوچک نمایش مانده در پیام خطا
function currentBalFa(val: DecimalValue): string {
  return fin(val).toNumber().toLocaleString('fa-IR');
}
