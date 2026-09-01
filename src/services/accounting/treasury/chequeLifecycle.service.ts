import { orm } from '../../../db/drizzle.js';
import { bankAccounts, cheques } from '../../../db/schema.js';
import { eq, desc, asc, and, or, like, gte, lte } from 'drizzle-orm';
import { ChartOfAccountsService } from '../chartOfAccounts.service.js';
import { VoucherService } from '../voucher.service.js';
import { validateLockOrder, LockHierarchyLevel, LockableResource } from '../../../lib/lockOrder.js';
import type { Cheque, ChequeStatus } from '../../../types.js';
import { NotFoundError, ValidationError, BusinessLogicError, ConflictError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';

import { businessTodayIsoDate, businessTodayJalaliDash } from '../../../lib/businessClock.js';

/**
 * V1.4.0 — ماشین وضعیت چک صیادی
 * هر انتقال فقط در صورت مجاز بودن و فقط یک‌بار امکان‌پذیر است؛
 * این مانع از دوبار وصول (دوبار مانده + دوبار سند) و ناسازگاری دفتر/خزانه می‌شود.
 */
export const CHEQUE_TRANSITIONS: Record<string, ChequeStatus[]> = {
  received: ['in_treasury', 'in_collection', 'passed', 'bounced'],
  in_treasury: ['in_collection', 'passed', 'bounced'],
  in_safe: ['in_collection', 'passed', 'bounced'],
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
    type?: 'received' | 'paid';
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<Cheque[]> {
    const conditions = [eq(cheques.isDeleted, 0)];

    if (params.type) {
      conditions.push(eq(cheques.type, params.type));
    }
    if (params.status) {
      conditions.push(eq(cheques.status, params.status));
    }
    if (params.startDate) {
      conditions.push(gte(cheques.dueDate, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(cheques.dueDate, params.endDate));
    }
    if (params.search && params.search.trim()) {
      const q = `%${params.search.trim()}%`;
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
      createdAt: cheques.createdAt,
    })
    .from(cheques)
    .leftJoin(bankAccounts, eq(bankAccounts.id, cheques.bankAccountId))
    .where(and(...conditions))
    .orderBy(asc(cheques.dueDate), desc(cheques.id));

    return rawList.map(c => ({
      ...c,
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
      statusHistory: (c.statusHistory as any) || [],
      status_history: (c.statusHistory as any) || [],
    }));
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
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ چک باید بزرگتر از صفر باشد');

    const initialHistory = [{
      date: data.issueDate || await businessTodayIsoDate(),
      status: (data.type === 'received' ? 'received' : 'in_treasury') as ChequeStatus,
      user: data.username || 'سیستم',
      notes: `ثبت اولیه چک ${data.type === 'received' ? 'دریافتی' : 'پرداختی'}`
    }];

    // V1.4.0: صدور چک اتمیک است — سند دوبل و ثبت چک در یک تراکنش دیتابیس؛
    // در نبود کدینگ، خطای صریح (به‌جای skip بی‌صدای قبلی) تا چک بدون رد دفتری ثبت نشود.
    const inserted = await orm.transaction(async (txEngine) => {
      let voucherId: number | null = null;
      if (data.createVoucher !== false) {
        const allAccs = await ChartOfAccountsService.getAllAccounts(txEngine);
        const chequeReceivableAcc = allAccs.find(a => a.code === '1101');
        const customerAcc = allAccs.find(a => a.code === '1201');
        const chequePayableAcc = allAccs.find(a => a.code === '3101');
        const supplierAcc = allAccs.find(a => a.code === '3001');

        if (data.type === 'received') {
          if (!chequeReceivableAcc || !customerAcc) {
            throw new ValidationError('کدینگ لازم برای ثبت چک دریافتی یافت نشد (حساب‌های 1101 اسناد دریافتنی و 1201 حساب‌های دریافتنی تجاری). ابتدا کدینگ حسابداری را تکمیل کنید.');
          }
          const v = await VoucherService.createJournalVoucher({
            date: data.issueDate,
            voucherType: 'treasury',
            description: `دریافت چک شماره ${data.chequeNumber} از ${data.partyName} (سررسید: ${data.dueDate})`,
            referenceModule: 'cheque',
            referenceNumber: data.chequeNumber,
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
            date: data.issueDate,
            voucherType: 'treasury',
            description: `صدور چک شماره ${data.chequeNumber} در وجه ${data.partyName} (سررسید: ${data.dueDate})`,
            referenceModule: 'cheque',
            referenceNumber: data.chequeNumber,
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
      }

      const [row] = await txEngine.insert(cheques).values({
        type: data.type,
        chequeNumber: data.chequeNumber.trim(),
        sayadNumber: data.sayadNumber?.trim() || '',
        bankName: data.bankName.trim(),
        branch: data.branch?.trim() || '',
        issueDate: data.issueDate.trim(),
        dueDate: data.dueDate.trim(),
        amount,
        currency: data.currency || 'IRR',
        partyType: data.partyType || 'customer',
        partyId: data.partyId || null,
        partyName: data.partyName.trim(),
        status: (data.type === 'received' ? 'received' : 'in_treasury'),
        drawerName: data.drawerName?.trim() || '',
        payeeName: data.payeeName?.trim() || '',
        bankAccountId: data.bankAccountId || null,
        voucherId,
        description: data.description?.trim() || '',
        statusHistory: initialHistory,
        createdById: data.userId || null,
      }).returning();
      return row;
    });

    return {
      ...inserted,
      type: inserted.type as Cheque['type'],
      status: inserted.status as Cheque['status'],
      partyType: (inserted.partyType || 'customer') as Cheque['partyType'],
      statusHistory: initialHistory,
    };
  }

  static async updateChequeStatus(id: number, data: {
    status: ChequeStatus;
    actionDate?: string;
    bankAccountId?: number | null;
    notes?: string;
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

      let bankRecord: any = null;
      let existing: any = null;

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

      const history = Array.isArray(existing.statusHistory) ? [...existing.statusHistory] : [];
      const actDate = data.actionDate || await businessTodayJalaliDash();

      const allAccs = await ChartOfAccountsService.getAllAccounts(txEngine);
      const amount = Number(existing.amount) || 0;

      if (data.status === 'passed' && bankRecord) {
        const bank = bankRecord;
        // V1.4.0: ریاضی مالی با fin() — حذف خطای float
        const curBal = fin(Number(bank.currentBalance) || 0);
        const newBal = existing.type === 'received'
          ? curBal.add(amount)
          : curBal.subtract(amount);
        if (newBal.lessThan(0)) {
          throw new ValidationError(`مانده حساب «${bank.title}» برای پرداخت کافی نیست (مانده: ${newBal.toNumber()})`);
        }
        await txEngine.update(bankAccounts).set({ currentBalance: newBal.toNumber() }).where(eq(bankAccounts.id, bank.id));

        if (existing.type === 'received' && bank.accountId) {
          const inCollectionAcc = allAccs.find(a => a.code === '1102') || allAccs.find(a => a.code === '1101');
          if (inCollectionAcc) {
            await VoucherService.createJournalVoucher({
              date: actDate,
              voucherType: 'treasury',
              description: `وصول چک شماره ${existing.chequeNumber} از ${existing.partyName} و واریز به ${bank.title}`,
              referenceModule: 'cheque',
              referenceNumber: existing.chequeNumber,
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
                  accountId: inCollectionAcc.id,
                  detailedType: 'other',
                  detailedName: `چک ${existing.chequeNumber}`,
                  debit: 0,
                  credit: amount,
                  description: `بستانکاری اسناد دریافتنی بابت پاس شدن چک ${existing.chequeNumber}`
                }
              ]
            }, txEngine);
          }
        } else if (existing.type === 'paid' && bank.accountId) {
          const payableChequeAcc = allAccs.find(a => a.code === '3101');
          if (payableChequeAcc) {
            await VoucherService.createJournalVoucher({
              date: actDate,
              voucherType: 'treasury',
              description: `پاس شدن چک پرداختی شماره ${existing.chequeNumber} در وجه ${existing.partyName} از حساب ${bank.title}`,
              referenceModule: 'cheque',
              referenceNumber: existing.chequeNumber,
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
        const inTreasuryAcc = allAccs.find(a => a.code === '1101');
        const inCollectionAcc = allAccs.find(a => a.code === '1102');
        if (inTreasuryAcc && inCollectionAcc) {
          await VoucherService.createJournalVoucher({
            date: actDate,
            voucherType: 'treasury',
            description: `ارسال چک شماره ${existing.chequeNumber} به بانک جهت وصول (در جریان وصول)`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
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
        const bouncedAcc = allAccs.find(a => a.code === '1103') || allAccs.find(a => a.code === '1201');
        const inCollectionAcc = allAccs.find(a => a.code === '1102') || allAccs.find(a => a.code === '1101');
        if (bouncedAcc && inCollectionAcc && existing.type === 'received') {
          await VoucherService.createJournalVoucher({
            date: actDate,
            voucherType: 'adjustment',
            description: `واخواست و برگشت چک شماره ${existing.chequeNumber} از ${existing.partyName}`,
            referenceModule: 'cheque',
            referenceNumber: existing.chequeNumber,
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
                accountId: inCollectionAcc.id,
                detailedType: 'other',
                detailedName: `چک ${existing.chequeNumber}`,
                debit: 0,
                credit: amount,
                description: `کسر از اسناد در جریان وصول بابت برگشت چک ${existing.chequeNumber}`
              }
            ]
          }, txEngine);
        }
      }

      history.push({
        date: actDate,
        status: data.status,
        user: data.username || 'سیستم',
        notes: data.notes || `تغییر وضعیت به ${data.status}`
      });

      const [updated] = await txEngine.update(cheques).set({
        status: data.status,
        ...(data.bankAccountId !== undefined ? { bankAccountId: data.bankAccountId } : {}),
        statusHistory: history,
      }).where(eq(cheques.id, id)).returning();

      return {
        ...updated,
        type: updated.type as Cheque['type'],
        status: updated.status as Cheque['status'],
        partyType: (updated.partyType || 'customer') as Cheque['partyType'],
        statusHistory: history,
      };
    });
  }

  static async deleteCheque(id: number, user?: { userId?: number; username?: string }): Promise<{ success: boolean }> {
    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'cheque', hierarchyLevel: LockHierarchyLevel.CHEQUES },
      ]);
      const [existing] = await txEngine.select().from(cheques).where(eq(cheques.id, id)).for('update');
      if (!existing) throw new NotFoundError('چک مورد نظر یافت نشد');
      if (existing.status === 'passed') {
        throw new BusinessLogicError('چک وصول‌شده قابل حذف نیست — مبلغ آن به حساب بانکی منتقل شده است');
      }

      // V1.4.0 (DB-009): حذف چکِ دارای سند، حتماً با سند معکوس در همان تراکنش —
      // تا رد دفتری چک (اسناد دریافتنی/پرداختنی/واخواست) بدون جبران باقی نماند.
      if (existing.voucherId) {
        await VoucherService.reverseVoucher({
          voucherId: existing.voucherId,
          reason: `ابطال چک شماره ${existing.chequeNumber} (حذف رکورد)`,
          userId: user?.userId,
          username: user?.username,
          externalTx: txEngine,
        });
      }

      await txEngine.update(cheques).set({ isDeleted: 1 }).where(eq(cheques.id, id));
      return { success: true };
    });
  }
}
