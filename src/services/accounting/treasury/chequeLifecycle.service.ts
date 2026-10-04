import { orm } from '../../../db/drizzle.js';
import { bankAccounts, cheques, journalVouchers } from '../../../db/schema.js';
import { eq, ne, desc, asc, and, or, like, gte, lte, isNull, sql } from 'drizzle-orm';
import { ChartOfAccountsService } from '../chartOfAccounts.service.js';
import { AccountMappingService } from '../accountMapping.service.js';
import { VoucherService } from '../voucher.service.js';
import { validateLockOrder, LockHierarchyLevel, LockableResource } from '../../../lib/lockOrder.js';
import type { Cheque, ChequeStatus } from '../../../types.js';
import { NotFoundError, ValidationError, BusinessLogicError, ConflictError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';

import { businessTodayIsoDate, normalizeDateToIso } from '../../../lib/businessClock.js';
import { AttachmentStorageService } from '../../attachments/attachmentStorage.service.js';
import { containsLikePattern } from '../../../lib/sqlLike.js';
import { requireStorageDate } from '../../../lib/storageDate.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';

/**
 * V1.4.0 — ماشین وضعیت چک صیادی
 * هر انتقال فقط در صورت مجاز بودن و فقط یک‌بار امکان‌پذیر است؛
 * این مانع از دوبار وصول (دوبار مانده + دوبار سند) و ناسازگاری دفتر/خزانه می‌شود.
 */
export const CHEQUE_TRANSITIONS: Record<string, ChequeStatus[]> = {
  received: ['in_treasury', 'in_collection', 'passed', 'bounced', 'spent'],
  in_treasury: ['in_collection', 'passed', 'bounced', 'spent'],
  in_safe: ['in_collection', 'passed', 'bounced', 'spent'],
  in_collection: ['passed', 'bounced'],
  passed: [],        // پایانی
  bounced: ['returned'],
  returned: [],      // پایانی
  spent: [],         // پایانی
};

export function assertChequeTransition(current: string, next: ChequeStatus): void {
  if (current === next) {
    throw new ConflictError(`چک هم‌اکنون در وضعیت «${next}» است — تکرار همان وضعیت مجاز نیست`);
  }
  const allowed = CHEQUE_TRANSITIONS[current];
  if (!allowed) {
    throw new ConflictError(`وضعیت فعلی چک («${current}») نامعتبر است`);
  }
  if (!allowed.includes(next)) {
    throw new BusinessLogicError(
      `انتقال وضعیت «${current}» به «${next}» مجاز نیست — انتقال‌های مجاز: ${allowed.join('، ') || 'هیچ'}`
    );
  }
}

export class ChequeLifecycleService {
  static async getCheques(params: {
    // v7.0.110 (TD-240): «all» یعنی بدون فیلتر نوع یا وضعیت
    type?: 'received' | 'paid' | 'all';
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<Cheque[]> {
    const conditions = [eq(cheques.isDeleted, 0)];

    if (params.type && params.type !== 'all') {
      conditions.push(eq(cheques.type, params.type));
    }
    if (params.status && params.status !== 'all') {
      conditions.push(eq(cheques.status, params.status));
    }
    // v7.0.133 (TD-232): سررسید میلادی ISO ذخیره می‌شود؛ بازه شمسی (یا میلادی) ورودی پیش از مقایسه ISO می‌شود
    const startDate = requireStorageDate(params.startDate, 'از تاریخ سررسید');
    const endDate = requireStorageDate(params.endDate, 'تا تاریخ سررسید');
    if (startDate) {
      conditions.push(gte(cheques.dueDate, startDate));
    }
    if (endDate) {
      conditions.push(lte(cheques.dueDate, endDate));
    }
    if (params.search && params.search.trim()) {
      const q = containsLikePattern(params.search.trim());
      conditions.push(
        or(
          like(cheques.chequeNumber, q),
          like(cheques.sayadNumber, q),
          like(cheques.partyName, q),
          like(cheques.bankName, q),
          like(cheques.drawerName, q)
        )!
      );
    }

    const rawList = await orm.select({
      id: cheques.id,
      type: cheques.type,
      chequeNumber: cheques.chequeNumber,
      sayadNumber: cheques.sayadNumber,
      bankName: cheques.bankName,
      branch: cheques.branch,
      issueDate: cheques.issueDate,
      dueDate: cheques.dueDate,
      amount: cheques.amount,
      currency: cheques.currency,
      partyType: cheques.partyType,
      partyId: cheques.partyId,
      partyName: cheques.partyName,
      status: cheques.status,
      drawerName: cheques.drawerName,
      payeeName: cheques.payeeName,
      bankAccountId: cheques.bankAccountId,
      bankAccountTitle: bankAccounts.title,
      voucherId: cheques.voucherId,
      description: cheques.description,
      statusHistory: cheques.statusHistory,
      attachments: cheques.attachments,
      createdAt: cheques.createdAt,
    })
    .from(cheques)
    .leftJoin(bankAccounts, eq(bankAccounts.id, cheques.bankAccountId))
    .where(and(...conditions))
    .orderBy(asc(cheques.dueDate), desc(cheques.id));

    return rawList.map(c => ({
      ...c,
      amount: c.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
      type: c.type as Cheque['type'],
      status: c.status as Cheque['status'],
      partyType: c.partyType as Cheque['partyType'],
      cheque_number: c.chequeNumber,
      sayad_number: c.sayadNumber || '',
      bank_name: c.bankName,
      issue_date: c.issueDate,
      due_date: c.dueDate,
      party_type: c.partyType as Cheque['partyType'],
      party_id: c.partyId,
      party_name: c.partyName,
      drawer_name: c.drawerName || '',
      payee_name: c.payeeName || '',
      bank_account_id: c.bankAccountId,
      voucher_id: c.voucherId,
      statusHistory: (c.statusHistory as unknown as Cheque['statusHistory']) || [],
      status_history: (c.statusHistory as unknown as Cheque['statusHistory']) || [],
    } as Cheque));
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
    attachments?: unknown[];
  }): Promise<Cheque> {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ چک باید بزرگتر از صفر باشد');
    // v7.0.133 (TD-232): تاریخ صدور و سررسید چک میلادی ISO ذخیره می‌شوند (ورودی شمسی تبدیل، نامعتبر 422)
    const issueDate = requireStorageDate(data.issueDate, 'تاریخ صدور چک');
    const dueDate = requireStorageDate(data.dueDate, 'تاریخ سررسید چک');
    if (!issueDate || !dueDate) throw new ValidationError('تاریخ صدور و تاریخ سررسید چک الزامی است');
    const dueJalali = isoToJalaliDate(dueDate);

    const initialHistory = [{
      date: issueDate,
      status: (data.type === 'received' ? 'received' : 'in_treasury') as ChequeStatus,
      user: data.username || 'سیستم',
      notes: `ثبت اولیه چک ${data.type === 'received' ? 'دریافتی' : 'پرداختی'}`
    }];

    // V1.4.0: صدور چک اتمیک است — سند دوبل و ثبت چک در یک تراکنش دیتابیس؛
    // در نبود کدینگ، خطای صریح (به‌جای skip بی‌صدای قبلی) تا چک بدون رد دفتری ثبت نشود.
    const inserted = await orm.transaction(async (txEngine) => {
      // v8.0.19 (TD-271): ابتدا چک ثبت می‌شود تا سند ثبت آن با source_cheque_id به همین چک پیوند بخورد
      const [row] = await txEngine.insert(cheques).values({
        type: data.type,
        chequeNumber: data.chequeNumber.trim(),
        sayadNumber: data.sayadNumber?.trim() || '',
        bankName: data.bankName.trim(),
        branch: data.branch?.trim() || '',
        issueDate,
        dueDate,
        amount: money(amount),
        currency: data.currency || 'IRR',
        partyType: data.partyType || 'customer',
        partyId: data.partyId || null,
        partyName: data.partyName.trim(),
        status: (data.type === 'received' ? 'received' : 'in_treasury'),
        drawerName: data.drawerName?.trim() || '',
        payeeName: data.payeeName?.trim() || '',
        bankAccountId: data.bankAccountId || null,
        voucherId: null,
        description: data.description?.trim() || '',
        statusHistory: initialHistory,
        attachments: [],
        createdById: data.userId || null,
      }).returning();

      if (data.createVoucher !== false) {
        // V1.7.0: کدینگ از مپینگ قابل‌تنظیم (تنظیمات حسابداری) — نه هاردکد
        const chequeReceivableAcc = await AccountMappingService.getChequeReceivableAccount(txEngine);
        const customerAcc = await AccountMappingService.getTradeReceivablesAccount(txEngine);
        const chequePayableAcc = await AccountMappingService.getChequePayableAccount(txEngine);
        const supplierAcc = await AccountMappingService.getTradePayablesAccount(txEngine);
        let voucherId: number;

        if (data.type === 'received') {
          if (!chequeReceivableAcc || !customerAcc) {
            throw new ValidationError('کدینگ لازم برای ثبت چک دریافتی یافت نشد (حساب‌های 1101 اسناد دریافتنی و 1201 حساب‌های دریافتنی تجاری). ابتدا کدینگ حسابداری را تکمیل کنید.');
          }
          const v = await VoucherService.createJournalVoucher({
            date: issueDate,
            voucherType: 'treasury',
            description: `دریافت چک شماره ${data.chequeNumber} از ${data.partyName} (سررسید: ${dueJalali})`,
            referenceModule: 'cheque',
            referenceNumber: data.chequeNumber,
            sourceChequeId: row.id,
            currency: data.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: chequeReceivableAcc.id,
                detailedType: 'other',
                detailedName: `چک صیادی ${data.sayadNumber || data.chequeNumber}`,
                debit: amount,
                credit: 0,
                currency: data.currency || 'IRR',
                description: `اسناد دریافتنی نزد صندوق بابت چک ${data.chequeNumber}`
              },
              {
                accountId: customerAcc.id,
                detailedType: 'customer',
                detailedId: data.partyId,
                detailedName: data.partyName,
                debit: 0,
                credit: amount,
                currency: data.currency || 'IRR',
                description: `بستانکاری مشتری بابت تسویه با چک شماره ${data.chequeNumber}`
              }
            ]
          }, txEngine);
          voucherId = v.id;
        } else {
          if (!chequePayableAcc || !supplierAcc) {
            throw new ValidationError('کدینگ لازم برای ثبت چک پرداختی یافت نشد (حساب‌های 3101 اسناد پرداختنی و 3001 حساب‌های پرداختنی تجاری). ابتدا کدینگ حسابداری را تکمیل کنید.');
          }
          const v = await VoucherService.createJournalVoucher({
            date: issueDate,
            voucherType: 'treasury',
            description: `صدور چک شماره ${data.chequeNumber} در وجه ${data.partyName} (سررسید: ${dueJalali})`,
            referenceModule: 'cheque',
            referenceNumber: data.chequeNumber,
            sourceChequeId: row.id,
            currency: data.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: supplierAcc.id,
                detailedType: 'supplier',
                detailedId: data.partyId,
                detailedName: data.partyName,
                debit: amount,
                credit: 0,
                currency: data.currency || 'IRR',
                description: `بدهکار شدن تامین‌کننده بابت پرداخت با چک شماره ${data.chequeNumber}`
              },
              {
                accountId: chequePayableAcc.id,
                detailedType: 'other',
                detailedName: `چک صادره ${data.sayadNumber || data.chequeNumber}`,
                debit: 0,
                credit: amount,
                currency: data.currency || 'IRR',
                description: `اسناد پرداختنی تجاری بابت صدور چک ${data.chequeNumber}`
              }
            ]
          }, txEngine);
          voucherId = v.id;
        }
        await txEngine.update(cheques).set({ voucherId }).where(eq(cheques.id, row.id));
        row.voucherId = voucherId;
      }

      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      row.attachments = await AttachmentStorageService.attachToNewRecord(txEngine, 'cheque', row.id, data.attachments, data.username);
      return row;
    });

    return {
      ...inserted,
      amount: inserted.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
      type: inserted.type as Cheque['type'],
      status: inserted.status as Cheque['status'],
      partyType: (inserted.partyType || 'customer') as Cheque['partyType'],
      statusHistory: initialHistory,
    } as Cheque;
  }

  static async updateChequeStatus(id: number, data: {
    status: ChequeStatus;
    actionDate?: string;
    bankAccountId?: number | null;
    transfereePartyId?: number;
    transfereePartyName?: string;
    notes?: string;
    description?: string;
    userId?: number;
    username?: string;
  }): Promise<Cheque> {
    return await orm.transaction(async (txEngine) => {
      // 1. Pre-read cheque to check target bank account if status is passed
      let targetBankId = data.bankAccountId;
      let chequeCurrency = 'IRR';
      if (data.status === 'passed' && !targetBankId) {
        const [preCheck] = await txEngine.select({ bankAccountId: cheques.bankAccountId, currency: cheques.currency }).from(cheques).where(eq(cheques.id, id));
        if (preCheck) {
          targetBankId = preCheck.bankAccountId;
          chequeCurrency = preCheck.currency || 'IRR';
        }
      } else if (data.status === 'passed') {
        const [preCheck] = await txEngine.select({ currency: cheques.currency }).from(cheques).where(eq(cheques.id, id));
        chequeCurrency = preCheck?.currency || 'IRR';
      }

      let bankRecord: typeof bankAccounts.$inferSelect | null = null;
      let existing: typeof cheques.$inferSelect | null = null;

      if (data.status === 'passed') {
        if (!targetBankId) throw new ValidationError('برای وصول چک، تعیین حساب بانکی واریز یا برداشت الزامی است');

        // Strictly respect Lock Hierarchy: BankAccounts (Level 10) -> Cheques (Level 20)
        const resources: LockableResource[] = [
          { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
          { name: 'cheque', hierarchyLevel: LockHierarchyLevel.CHEQUES },
        ];
        validateLockOrder(resources);

        // 1. Lock bank account (level 10) FIRST
        const [bank] = await txEngine.select().from(bankAccounts).where(and(eq(bankAccounts.id, targetBankId), eq(bankAccounts.isDeleted, 0))).for('update');
        if (!bank) throw new NotFoundError('حساب بانکی یافت نشد');

        // V1.4.0: گارد هم‌ارزی ارز — چک با ارز متفاوت از حساب بانکی قابل وصول نیست
        if (bank.currency && chequeCurrency && bank.currency !== chequeCurrency) {
          throw new ValidationError(`ارز چک (${chequeCurrency}) با ارز حساب بانکی «${bank.title}» (${bank.currency}) هم‌خوانی ندارد`);
        }

        // 2. Lock cheque (level 20) SECOND
        const [chq] = await txEngine.select().from(cheques).where(eq(cheques.id, id)).for('update');
        if (!chq) throw new NotFoundError('چک مورد نظر یافت نشد');
        existing = chq;
        bankRecord = bank;
      } else {
        validateLockOrder([
          { name: 'cheque', hierarchyLevel: LockHierarchyLevel.CHEQUES },
        ]);
        const [chq] = await txEngine.select().from(cheques).where(eq(cheques.id, id)).for('update');
        if (!chq) throw new NotFoundError('چک مورد نظر یافت نشد');
        existing = chq;
      }

      // V1.4.0: ماشین وضعیت — انتقال مجاز + جلوگیری از تکرار (دوبار وصول = دوبار مانده و سند)
      assertChequeTransition(String(existing.status), data.status);

      if (data.status === 'spent' && existing.type !== 'received') {
        throw new ValidationError('تنها چک‌های دریافتی از مشتریان قابل واگذاری و خرج کردن به غیر هستند');
      }

      const history = Array.isArray(existing.statusHistory) ? [...existing.statusHistory] : [];
      const voucherIsoDate = normalizeDateToIso(data.actionDate) || (await businessTodayIsoDate());

      // V1.7.0: کدینگ از مپینگ قابل‌تنظیم
      await ChartOfAccountsService.getAllAccounts(txEngine);
      const amount = money(existing.amount);

      if (data.status === 'passed' && bankRecord) {
        const bank = bankRecord;
        // V1.4.0: ریاضی مالی با fin() — حذف خطای float
        const curBal = fin(bank.currentBalance);
        const newBal = existing.type === 'received'
          ? curBal.add(amount)
          : curBal.subtract(amount);
        if (newBal.lessThan(0)) {
          throw new ValidationError(`مانده حساب «${bank.title}» برای پرداخت کافی نیست (مانده: ${newBal.toDisplayString()})`);
        }
        await txEngine.update(bankAccounts).set({ currentBalance: money(newBal) }).where(eq(bankAccounts.id, bank.id));

        if (existing.type === 'received' && bank.accountId) {
          // P2-01: اگر چک مستقیماً از وضعیت نزد صندوق (received/in_treasury/in_safe) وصول شده باشد،
          // سرفصل اسناد دریافتنی نزد صندوق (۱۱۰۱) بستانکار می‌شود؛ و اگر در جریان وصول بوده (in_collection)، سرفصل ۱۱۰۲.
          const isDirectFromTreasury = existing.status === 'received' || existing.status === 'in_treasury' || existing.status === 'in_safe';
          const creditAcc = isDirectFromTreasury
            ? ((await AccountMappingService.getChequeReceivableAccount(txEngine)) || (await AccountMappingService.getChequeInCollectionAccount(txEngine)))
            : ((await AccountMappingService.getChequeInCollectionAccount(txEngine)) || (await AccountMappingService.getChequeReceivableAccount(txEngine)));

          if (creditAcc) {
            await VoucherService.createJournalVoucher({
              date: voucherIsoDate,
              voucherType: 'treasury',
              description: `وصول چک شماره ${existing.chequeNumber} از ${existing.partyName} و واریز به ${bank.title}`,
              referenceModule: 'cheque',
              referenceNumber: existing.chequeNumber,
              sourceChequeId: existing.id,
              currency: existing.currency || 'IRR',
              userId: data.userId,
              username: data.username,
              items: [
                {
                  accountId: bank.accountId,
                  detailedType: 'bank_account',
                  detailedId: bank.id,
                  detailedName: bank.title,
                  debit: amount,
                  credit: 0,
                  description: `واریز به بانک بابت وصول چک ${existing.chequeNumber}`
                },
                {
                  accountId: creditAcc.id,
                  detailedType: 'other',
                  detailedName: `چک ${existing.chequeNumber}`,
                  debit: 0,
                  credit: amount,
                  description: isDirectFromTreasury
                    ? `بستانکاری اسناد دریافتنی نزد صندوق بابت وصول مستقیم چک ${existing.chequeNumber}`
                    : `بستانکاری اسناد در جریان وصول بابت پاس شدن چک ${existing.chequeNumber}`
                }
              ]
            }, txEngine);
          }
        } else if (existing.type === 'paid' && bank.accountId) {
          const payableChequeAcc = await AccountMappingService.getChequePayableAccount(txEngine);
          if (payableChequeAcc) {
            await VoucherService.createJournalVoucher({
              date: voucherIsoDate,
              voucherType: 'treasury',
              description: `پاس شدن چک پرداختی شماره ${existing.chequeNumber} در وجه ${existing.partyName} از حساب ${bank.title}`,
              referenceModule: 'cheque',
              referenceNumber: existing.chequeNumber,
              sourceChequeId: existing.id,
              currency: existing.currency || 'IRR',
              userId: data.userId,
              username: data.username,
              items: [
                {
                  accountId: payableChequeAcc.id,
                  detailedType: 'other',
                  detailedName: `چک ${existing.chequeNumber}`,
                  debit: amount,
                  credit: 0,
                  description: `بدهکار شدن اسناد پرداختنی بابت پاس شدن چک ${existing.chequeNumber}`
                },
                {
                  accountId: bank.accountId,
                  detailedType: 'bank_account',
                  detailedId: bank.id,
                  detailedName: bank.title,
                  debit: 0,
                  credit: amount,
                  description: `برداشت از حساب بانکی بابت پاس شدن چک ${existing.chequeNumber}`
                }
              ]
            }, txEngine);
          }
        }
      } else if (data.status === 'in_collection' && existing.type === 'received') {
        const inTreasuryAcc = await AccountMappingService.getChequeReceivableAccount(txEngine);
        const inCollectionAcc = await AccountMappingService.getChequeInCollectionAccount(txEngine);
        if (inTreasuryAcc && inCollectionAcc) {
          await VoucherService.createJournalVoucher({
            date: voucherIsoDate,
            voucherType: 'treasury',
            description: `ارسال چک شماره ${existing.chequeNumber} به بانک جهت وصول (در جریان وصول)`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
            sourceChequeId: existing.id,
            currency: existing.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: inCollectionAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: amount,
                credit: 0,
                description: `اسناد در جریان وصول بابت چک ${existing.chequeNumber}`
              },
              {
                accountId: inTreasuryAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: 0,
                credit: amount,
                description: `خروج از اسناد نزد صندوق بابت ارسال به وصول چک ${existing.chequeNumber}`
              }
            ]
          }, txEngine);
        }
      } else if (data.status === 'bounced') {
        const bouncedAcc = (await AccountMappingService.getChequeProtestAccount(txEngine))
          || (await AccountMappingService.getTradeReceivablesAccount(txEngine));
        // P2-01: اگر چک مستقیماً از نزد صندوق واخواست شده باشد، سرفصل اسناد نزد صندوق (۱۱۰۱) بستانکار می‌شود؛ و اگر در جریان وصول بوده، ۱۱۰۲
        const isDirectFromTreasury = existing.status === 'received' || existing.status === 'in_treasury' || existing.status === 'in_safe';
        const creditAcc = isDirectFromTreasury
          ? ((await AccountMappingService.getChequeReceivableAccount(txEngine)) || (await AccountMappingService.getChequeInCollectionAccount(txEngine)))
          : ((await AccountMappingService.getChequeInCollectionAccount(txEngine)) || (await AccountMappingService.getChequeReceivableAccount(txEngine)));

        if (bouncedAcc && creditAcc && existing.type === 'received') {
          await VoucherService.createJournalVoucher({
            date: voucherIsoDate,
            voucherType: 'adjustment',
            description: `واخواست و برگشت چک شماره ${existing.chequeNumber} از ${existing.partyName}`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
            sourceChequeId: existing.id,
            currency: existing.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: bouncedAcc.id,
                detailedType: 'customer',
                detailedId: existing.partyId,
                detailedName: existing.partyName,
                debit: amount,
                credit: 0,
                description: `برگشت چک ${existing.chequeNumber}`
              },
              {
                accountId: creditAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: 0,
                credit: amount,
                description: isDirectFromTreasury
                  ? `کسر از اسناد دریافتنی نزد صندوق بابت برگشت مستقیم چک ${existing.chequeNumber}`
                  : `کسر از اسناد در جریان وصول بابت برگشت چک ${existing.chequeNumber}`
              }
            ]
          }, txEngine);
        } else if (existing.type === 'paid') {
          // v8.0.21 (TD-272): برگشت چک پرداختی — بدهی ما به تأمین‌کننده برمی‌گردد: بدهکار اسناد پرداختنی، بستانکار
          // حساب تأمین‌کننده. پیش‌تر سندی صادر نمی‌شد؛ ۳۱۰۱ بستانکار می‌ماند و تأمین‌کننده پرداخت‌شده دیده می‌شد.
          const chequePayableAcc = await AccountMappingService.getChequePayableAccount(txEngine);
          const supplierAcc = await AccountMappingService.getTradePayablesAccount(txEngine);
          if (!chequePayableAcc || !supplierAcc) {
            throw new ValidationError('کدینگ لازم برای ثبت برگشت چک پرداختی یافت نشد (اسناد پرداختنی و حساب‌های پرداختنی تجاری).');
          }
          await VoucherService.createJournalVoucher({
            date: voucherIsoDate,
            voucherType: 'adjustment',
            description: `برگشت چک پرداختی شماره ${existing.chequeNumber} در وجه ${existing.partyName}`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
            sourceChequeId: existing.id,
            currency: existing.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: chequePayableAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: amount,
                credit: 0,
                description: `بستن اسناد پرداختنی بابت برگشت چک ${existing.chequeNumber}`
              },
              {
                accountId: supplierAcc.id,
                detailedType: 'supplier',
                detailedId: existing.partyId,
                detailedName: existing.partyName,
                debit: 0,
                credit: amount,
                description: `بازگشت بدهی به ${existing.partyName} بابت برگشت چک ${existing.chequeNumber}`
              }
            ]
          }, txEngine);
        }
      } else if (data.status === 'returned' && existing.type === 'received') {
        // v8.0.22 (TD-273، تصمیم مالک محصول — گزینه الف): عودت چک برگشتی به صادرکننده، مطالبه را از اسناد واخواستی به
        // حساب جاری مشتری برمی‌گرداند (بدهکار مشتری، بستانکار اسناد واخواستی) تا دریافت بعدی از مشتری درست تسویه شود.
        // پیش‌تر سندی صادر نمی‌شد و مطالبه برای همیشه در اسناد واخواستی می‌ماند. اگر برگشت به خود حساب مشتری ثبت شده
        // باشد (نبود حساب اسناد واخواستی در کدینگ) سندی لازم نیست.
        const protestAcc = await AccountMappingService.getChequeProtestAccount(txEngine);
        const customerAcc = await AccountMappingService.getTradeReceivablesAccount(txEngine);
        if (protestAcc && customerAcc && protestAcc.id !== customerAcc.id) {
          await VoucherService.createJournalVoucher({
            date: voucherIsoDate,
            voucherType: 'adjustment',
            description: `عودت چک برگشتی شماره ${existing.chequeNumber} به ${existing.partyName} و انتقال مطالبه به حساب مشتری`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
            sourceChequeId: existing.id,
            currency: existing.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: customerAcc.id,
                detailedType: 'customer',
                detailedId: existing.partyId,
                detailedName: existing.partyName,
                debit: amount,
                credit: 0,
                description: `مطالبه چک برگشتی ${existing.chequeNumber} به حساب جاری مشتری`
              },
              {
                accountId: protestAcc.id,
                detailedType: 'customer',
                detailedId: existing.partyId,
                detailedName: existing.partyName,
                debit: 0,
                credit: amount,
                description: `بستن اسناد واخواستی بابت عودت چک ${existing.chequeNumber}`
              }
            ]
          }, txEngine);
        }
      } else if (data.status === 'spent' && existing.type === 'received') {
        const tradePayablesAcc = await AccountMappingService.getTradePayablesAccount(txEngine);
        const inTreasuryAcc = (await AccountMappingService.getChequeReceivableAccount(txEngine))
          || (await AccountMappingService.getChequeInCollectionAccount(txEngine));

        if (tradePayablesAcc && inTreasuryAcc) {
          const transferee = data.transfereePartyName || data.notes || data.description || 'طرف حساب واگذاری';
          await VoucherService.createJournalVoucher({
            date: voucherIsoDate,
            voucherType: 'treasury',
            description: `واگذاری و خرج چک شماره ${existing.chequeNumber} از ${existing.partyName} به ${transferee}`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
            sourceChequeId: existing.id,
            currency: existing.currency || 'IRR',
            userId: data.userId,
            username: data.username,
            items: [
              {
                accountId: tradePayablesAcc.id,
                detailedType: data.transfereePartyId ? 'supplier' : 'other',
                detailedId: data.transfereePartyId,
                detailedName: transferee,
                debit: amount,
                credit: 0,
                description: `بدهکار شدن حساب پرداختنی بابت واگذاری چک ${existing.chequeNumber} به ${transferee}`
              },
              {
                accountId: inTreasuryAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: 0,
                credit: amount,
                description: `خروج چک دریافتی ${existing.chequeNumber} از اسناد نزد صندوق بابت واگذاری و خرج چک`
              }
            ]
          }, txEngine);
        }
      }

      const effectiveNotes = data.notes || data.description || (data.transfereePartyName ? `واگذاری به ${data.transfereePartyName}` : undefined);

      history.push({
        date: voucherIsoDate,
        status: data.status,
        user: data.username || 'سیستم',
        notes: effectiveNotes || `تغییر وضعیت به ${data.status}`
      });

      const [updated] = await txEngine.update(cheques).set({
        status: data.status,
        ...(data.bankAccountId !== undefined ? { bankAccountId: data.bankAccountId } : {}),
        ...(data.transfereePartyName ? { payeeName: data.transfereePartyName } : {}),
        statusHistory: history,
      }).where(eq(cheques.id, id)).returning();

      return {
        ...updated,
        amount: updated.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
        type: updated.type as Cheque['type'],
        status: updated.status as Cheque['status'],
        partyType: (updated.partyType || 'customer') as Cheque['partyType'],
        statusHistory: history,
      } as Cheque;
    });
  }

  static async deleteCheque(id: number, user?: { userId?: number; username?: string }): Promise<{ success: boolean }> {
    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'cheque', hierarchyLevel: LockHierarchyLevel.CHEQUES },
      ]);
      const [existing] = await txEngine.select().from(cheques).where(eq(cheques.id, id)).for('update');
      if (!existing) throw new NotFoundError('چک مورد نظر یافت نشد');
      if (existing.status === 'passed' || existing.status === 'spent') {
        throw new BusinessLogicError('چک وصول‌شده یا خرج‌شده قابل حذف نیست — اسناد مالی مربوط به آن صادر گردیده است');
      }

      // P2-02 (AUD-ACC): شناسایی و ابطال اتمیک کلیه اسناد چرخه عمر چک (سند اولیه، در جریان وصول، واخواست و...)
      // v8.0.19 (TD-271): اسناد چک با پیوند صریح source_cheque_id (مهاجرت 0047) یافته می‌شوند. پیش‌تر با شماره چک
      // یافته می‌شدند و شماره چک یکتا نیست؛ حذف یک چک اسناد چک دیگری با همان شماره را هم باطل می‌کرد. سند قدیمی
      // بی‌پیوند (پیش از v8.0.19) فقط وقتی سند این چک شمرده می‌شود که هیچ چک دیگری همین شماره را نداشته باشد.
      const chequeNumber = String(existing.chequeNumber).trim();
      const linkedToCheque = or(
        eq(journalVouchers.sourceChequeId, id),
        existing.voucherId ? eq(journalVouchers.id, existing.voucherId) : sql`1 = 0`,
      );
      const legacyByNumber = and(
        isNull(journalVouchers.sourceChequeId),
        eq(journalVouchers.referenceModule, 'cheque'),
        sql`${journalVouchers.referenceNumber} = ${chequeNumber}::text`,
      );
      const [sameNumber] = await txEngine.select({ n: sql<number>`count(*)::int` }).from(cheques)
        .where(and(sql`btrim(${cheques.chequeNumber}) = ${chequeNumber}::text`, ne(cheques.id, id)));
      const numberShared = Number(sameNumber?.n ?? 0) > 0;
      if (numberShared) {
        const ambiguous = await txEngine.select({ voucherNumber: journalVouchers.voucherNumber }).from(journalVouchers)
          .where(and(eq(journalVouchers.isDeleted, 0), legacyByNumber,
            existing.voucherId ? ne(journalVouchers.id, existing.voucherId) : sql`1 = 1`));
        if (ambiguous.length > 0) {
          throw new BusinessLogicError(
            `چک دیگری هم شماره «${chequeNumber}» دارد و ${ambiguous.length} سند حسابداری قدیمی این شماره ` +
            `(${ambiguous.map(v => v.voucherNumber).join('، ')}) به چک مشخصی پیوند ندارد؛ ابطال خودکار ممکن است سند چک دیگری را ` +
            'باطل کند. این اسناد را دستی بررسی و ابطال کنید.'
          );
        }
      }
      const activeChequeVouchers = await txEngine.select({
        id: journalVouchers.id,
        voucherNumber: journalVouchers.voucherNumber,
        status: journalVouchers.status,
      }).from(journalVouchers)
        .where(and(
          eq(journalVouchers.isDeleted, 0),
          numberShared ? linkedToCheque : or(linkedToCheque, legacyByNumber),
        ))
        .for('update');

      const reversedVoucherIds = new Set<number>();
      for (const v of activeChequeVouchers) {
        if (!reversedVoucherIds.has(v.id) && v.status !== 'permanent') {
          const expectedRevRef = `REV-V${v.voucherNumber}`;
          const [hasReversal] = await txEngine.select({ id: journalVouchers.id })
            .from(journalVouchers)
            .where(and(
              eq(journalVouchers.referenceId, v.id),
              eq(journalVouchers.referenceNumber, expectedRevRef),
              eq(journalVouchers.isDeleted, 0)
            ));

          if (!hasReversal) {
            // v8.0.2 (TD-251، تصمیم مالک محصول): سند پیش‌نویس چک حذف نرم می‌شود و سند معکوس نمی‌گیرد
            await VoucherService.voidSourceVoucher({
              voucherId: v.id,
              reason: `ابطال چک شماره ${existing.chequeNumber} (حذف رکورد و ابطال چرخه عمر)`,
              userId: user?.userId,
              username: user?.username,
              externalTx: txEngine,
            });
            reversedVoucherIds.add(v.id);
          }
        }
      }

      await txEngine.update(cheques).set({ isDeleted: 1 }).where(eq(cheques.id, id));
      return { success: true };
    });
  }
}
