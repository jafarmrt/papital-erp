import { orm, type DbExecutor } from '../../db/drizzle.js';
import { accounts, journalVouchers, journalVoucherItems } from '../../db/schema.js';
import { eq, desc, asc, and, or, sql, like, inArray, gte, lte } from 'drizzle-orm';
import type { JournalVoucher, JournalVoucherItem, FinancialAttachment } from '../../types.js';
import { updateRequestContext } from '../../lib/requestContext.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { money, moneyOr } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { NotFoundError, ValidationError, UnbalancedVoucherError, BusinessLogicError, ConflictError } from '../../errors/customErrors.js';
import { FiscalPeriodService } from './fiscalPeriod.service.js';
import { AttachmentStorageService } from '../attachments/attachmentStorage.service.js';
import { containsLikePattern } from '../../lib/sqlLike.js';

// v7.0.49 (audit P2-5): ثابت یگانه تلورانس تراز؛ v7.0.76 به src/lib/voucherBalance.ts منتقل شد تا فرم‌ها هم آن را بخوانند
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
export { VOUCHER_BALANCE_TOLERANCE };

/** v7.0.72 (audit P3-5): حداکثر ردیف در هر INSERT چندردیفی (۱۲ پارامتر در هر ردیف، زیر سقف ۶۵۵۳۵ پارامتر PostgreSQL) */
const VOUCHER_ITEM_INSERT_CHUNK = 500;

/** v7.0.72 (audit P3-5): ردیف‌های سند حسابداری با INSERT چندردیفی (قبلاً یک INSERT برای هر ردیف) */
async function insertVoucherItems(tx: DbExecutor, rows: Array<typeof journalVoucherItems.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += VOUCHER_ITEM_INSERT_CHUNK) {
    await tx.insert(journalVoucherItems).values(rows.slice(i, i + VOUCHER_ITEM_INSERT_CHUNK));
  }
}

export class VoucherService {
  static async getNextVoucherNumber(tx?: DbExecutor): Promise<number> {
    const executor = tx || orm;
    const result = await executor.execute(sql`SELECT nextval('journal_voucher_number_seq') AS num`);
    return Number(result.rows?.[0]?.num);
  }

  /**
   * Check whether the fiscal year corresponding to the voucher date is closed.
   * If closed, operations modifying or creating vouchers are prohibited.
   * v7.0.49 (audit P2-5): وضعیت از جدول fiscal_periods (نه LIKE روی شماره مرجع اسناد اختتامیه)؛ با tx ردیف سال
   * تا پایان تراکنش FOR SHARE قفل می‌شود تا بستن همزمان همان سال منتظر این سند بماند.
   */
  static async checkFiscalPeriodOpen(date: string, tx?: DbExecutor): Promise<void> {
    await FiscalPeriodService.assertOpen(date, tx);
  }

  /**
   * Helper to check if a specific date or fiscal period is closed.
   */
  static async isPeriodClosed(date: string, tx?: DbExecutor): Promise<boolean> {
    return FiscalPeriodService.isClosed(date, tx);
  }

  static async getJournalVouchers(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    voucherType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: JournalVoucher[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(journalVouchers.isDeleted, 0)];

    if (params.status && params.status !== 'all') {
      conditions.push(eq(journalVouchers.status, params.status));
    }
    if (params.voucherType && params.voucherType !== 'all') {
      conditions.push(eq(journalVouchers.voucherType, params.voucherType));
    }
    if (params.startDate) {
      conditions.push(gte(journalVouchers.date, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(journalVouchers.date, params.endDate));
    }
    if (params.search && params.search.trim()) {
      const q = containsLikePattern(params.search.trim());
      conditions.push(
        or(
          like(journalVouchers.description, q),
          like(journalVouchers.manualVoucherNumber, q),
          like(journalVouchers.referenceNumber, q),
          sql`CAST(${journalVouchers.voucherNumber} AS TEXT) LIKE ${q}`
        )!
      );
    }

    const whereClause = and(...conditions);

    const [countRes] = await orm.select({ count: sql<number>`count(*)` })
      .from(journalVouchers)
      .where(whereClause);
    const total = Number(countRes?.count) || 0;

    const rawList = await orm.select()
      .from(journalVouchers)
      .where(whereClause)
      .orderBy(desc(journalVouchers.voucherNumber))
      .limit(limit)
      .offset(offset);

    // Fetch items for each voucher
    const voucherIds = rawList.map(v => v.id);
    let itemsMap = new Map<number, JournalVoucherItem[]>();

    if (voucherIds.length > 0) {
      const rawItems = await orm.select({
        id: journalVoucherItems.id,
        voucherId: journalVoucherItems.voucherId,
        accountId: journalVoucherItems.accountId,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountLevel: accounts.level,
        rowOrder: journalVoucherItems.rowOrder,
        detailedType: journalVoucherItems.detailedType,
        detailedId: journalVoucherItems.detailedId,
        detailedName: journalVoucherItems.detailedName,
        debit: journalVoucherItems.debit,
        credit: journalVoucherItems.credit,
        currency: journalVoucherItems.currency,
        exchangeRate: journalVoucherItems.exchangeRate,
        description: journalVoucherItems.description,
      })
      .from(journalVoucherItems)
      .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
      .where(and(inArray(journalVoucherItems.voucherId, voucherIds), eq(journalVoucherItems.isDeleted, 0)))
      .orderBy(asc(journalVoucherItems.rowOrder));

      for (const item of rawItems) {
        const list = itemsMap.get(item.voucherId) || [];
        list.push({
          ...item,
          // قرارداد API: مبلغ در پاسخ عدد است (P2-6)
          debit: item.debit.toNumber(),
          credit: item.credit.toNumber(),
          exchangeRate: item.exchangeRate?.toNumber() ?? null,
          detailedType: item.detailedType as JournalVoucherItem['detailedType'],
          detailed_type: item.detailedType as JournalVoucherItem['detailedType'],
          account_id: item.accountId,
          voucher_id: item.voucherId,
          row_order: item.rowOrder ?? 1,
        } as JournalVoucherItem);
        itemsMap.set(item.voucherId, list);
      }
    }

    const data: JournalVoucher[] = rawList.map(v => ({
      ...v,
      voucher_number: v.voucherNumber,
      manual_voucher_number: v.manualVoucherNumber || '',
      voucher_type: v.voucherType as JournalVoucher['voucherType'],
      voucherType: v.voucherType as JournalVoucher['voucherType'],
      status: v.status as JournalVoucher['status'],
      total_debit: v.totalDebit.toNumber(),
      total_credit: v.totalCredit.toNumber(),
      totalDebit: v.totalDebit.toNumber(),
      totalCredit: v.totalCredit.toNumber(),
      referenceModule: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_module: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_id: v.referenceId,
      reference_number: v.referenceNumber || '',
      created_by_username: v.createdByUsername || '',
      items: itemsMap.get(v.id) || []
    } as JournalVoucher));

    return { data, total, page, limit };
  }

  static async getJournalVoucherById(id: number, tx?: DbExecutor): Promise<JournalVoucher> {
    const executor = tx || orm;
    const [v] = await executor.select().from(journalVouchers)
      .where(and(eq(journalVouchers.id, id), eq(journalVouchers.isDeleted, 0)));
    if (!v) throw new NotFoundError('سند حسابداری یافت نشد');

    const rawItems = await executor.select({
      id: journalVoucherItems.id,
      voucherId: journalVoucherItems.voucherId,
      accountId: journalVoucherItems.accountId,
      accountCode: accounts.code,
      accountName: accounts.name,
      accountLevel: accounts.level,
      rowOrder: journalVoucherItems.rowOrder,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      detailedName: journalVoucherItems.detailedName,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      currency: journalVoucherItems.currency,
      exchangeRate: journalVoucherItems.exchangeRate,
      description: journalVoucherItems.description,
    })
    .from(journalVoucherItems)
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(eq(journalVoucherItems.voucherId, id), eq(journalVoucherItems.isDeleted, 0)))
    .orderBy(asc(journalVoucherItems.rowOrder));

    return {
      ...v,
      attachments: (Array.isArray(v.attachments) ? v.attachments : []) as FinancialAttachment[],
      description: v.description || '',
      voucher_number: v.voucherNumber,
      manual_voucher_number: v.manualVoucherNumber || '',
      voucher_type: v.voucherType as JournalVoucher['voucherType'],
      voucherType: v.voucherType as JournalVoucher['voucherType'],
      status: v.status as JournalVoucher['status'],
      total_debit: v.totalDebit.toNumber(),
      total_credit: v.totalCredit.toNumber(),
      totalDebit: v.totalDebit.toNumber(),
      totalCredit: v.totalCredit.toNumber(),
      referenceModule: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_module: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_id: v.referenceId,
      reference_number: v.referenceNumber || '',
      created_by_username: v.createdByUsername || '',
      items: rawItems.map(item => ({
        ...item,
        debit: item.debit.toNumber(),
        credit: item.credit.toNumber(),
        exchangeRate: item.exchangeRate?.toNumber() ?? null,
        detailedType: item.detailedType as JournalVoucherItem['detailedType'],
        detailed_type: item.detailedType as JournalVoucherItem['detailedType'],
        account_id: item.accountId,
        voucher_id: item.voucherId,
        row_order: item.rowOrder ?? 1,
      } as JournalVoucherItem))
    };
  }

  static async createJournalVoucher(data: {
    date: string;
    voucherType?: 'general' | 'opening' | 'closing' | 'sales' | 'purchase' | 'treasury' | 'payroll' | 'adjustment';
    status?: 'draft' | 'approved' | 'permanent';
    manualVoucherNumber?: string;
    description: string;
    referenceModule?: 'manual' | 'invoice' | 'payroll' | 'cheque' | 'treasury' | 'inventory' | string;
    referenceId?: number | null;
    referenceNumber?: string;
    /** v7.0.31 (TD-193): فقط برای اسناد صادرشده توسط VoucherSync برای یک سند انبار/فاکتور */
    sourceDocumentId?: number | null;
    /** TD-242: فقط برای سند صادرشده توسط VoucherSync برای یک فیش حقوقی */
    sourcePayrollId?: number | null;
    /** v8.0.19 (TD-271): چکی که این سند در چرخه عمر آن صادر می‌شود */
    sourceChequeId?: number | null;
    sourceBomAllocationId?: number | null;
    currency?: string;
    attachments?: unknown[];
    userId?: number;
    username?: string;
    items: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
      detailedId?: number | null;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[];
  }, externalTx?: DbExecutor): Promise<JournalVoucher> {
    if (!data.items || data.items.length < 2) {
      throw new ValidationError('سند دوبل حسابداری باید حداقل شامل دو ردیف (بدهکار و بستانکار) باشد');
    }

    let sumDebit = fin(0);
    let sumCredit = fin(0);

    for (const item of data.items) {
      const d = fin(item.debit);
      const c = fin(item.credit);
      if (d.isNegative() || c.isNegative()) throw new ValidationError('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند');
      if (d.isZero() && c.isZero()) throw new ValidationError('هر ردیف سند باید دارای مبلغ بدهکار یا بستانکار باشد');
      sumDebit = sumDebit.add(d);
      sumCredit = sumCredit.add(c);
    }

    // Verify double-entry balance — v7.0.49 (audit P2-5): آستانه واحد VOUCHER_BALANCE_TOLERANCE در ثبت و قطعی‌سازی
    const diff = sumDebit.subtract(sumCredit).abs();
    if (diff.greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
      throw new UnbalancedVoucherError(`سند تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()} و جمع بستانکار: ${sumCredit.toDisplayString()} می‌باشد (اختلاف: ${diff.toDisplayString()})`);
    }

    const executeWork = async (tx: DbExecutor) => {
      // v7.0.137 (TD-248): تاریخ سند میلادی ISO؛ ورودی شمسی یا ارقام فارسی تبدیل و نامعتبر 422 (پیش‌تر خام ذخیره می‌شد)
      const voucherDate = requireStorageDate(data.date, 'تاریخ سند') || (await businessTodayIsoDate());

      // Check if fiscal year is closed
      // v7.0.49 (audit P2-5): اسناد اختتامیه هم بررسی می‌شوند؛ در فرایند بستن سال، سال تا پایان همان تراکنش باز
      // است و پس از بستن هیچ سندی (از جمله سند از نوع اختتامیه) وارد آن نمی‌شود
      await this.checkFiscalPeriodOpen(voucherDate, tx);

      const voucherNum = await this.getNextVoucherNumber(tx);
      const [voucher] = await tx.insert(journalVouchers).values({
        manualVoucherNumber: data.manualVoucherNumber?.trim() || '',
        voucherNumber: voucherNum,
        date: voucherDate,
        voucherType: data.voucherType || 'general',
        status: data.status || 'draft',
        totalDebit: money(sumDebit),
        totalCredit: money(sumCredit),
        description: data.description.trim(),
        referenceModule: data.referenceModule || 'manual',
        referenceId: data.referenceId || null,
        referenceNumber: data.referenceNumber?.trim() || '',
        sourceDocumentId: data.sourceDocumentId ?? null,
        sourcePayrollId: data.sourcePayrollId ?? null,
        sourceChequeId: data.sourceChequeId ?? null,
        sourceBomAllocationId: data.sourceBomAllocationId ?? null,
        currency: data.currency || 'IRR',
        attachments: [],
        createdById: data.userId || null,
        createdByUsername: data.username || '',
        // حوزه H (TD-308): سندی که با وضعیت «تأییدشده» ساخته می‌شود تأییدکننده‌اش (ثبت‌کننده) را دارد
        approvedById: data.status === 'approved' ? (data.userId || null) : null,
      }).returning();
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      voucher.attachments = await AttachmentStorageService.attachToNewRecord(tx, 'journal_voucher', voucher.id, data.attachments, data.username);

      updateRequestContext({ entityId: `voucher:${voucherNum}`, transactionId: `vch_num_${voucherNum}` });

      // Insert items
      await insertVoucherItems(tx, data.items.map((item, idx) => ({
        voucherId: voucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName?.trim() || '',
        debit: money(item.debit),
        credit: money(item.credit),
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: item.description?.trim() || data.description.trim(),
      })));

      return voucher.id;
    };

    const createdVoucherId = externalTx ? await executeWork(externalTx) : await orm.transaction(async (tx) => await executeWork(tx));

    return this.getJournalVoucherById(createdVoucherId, externalTx);
  }

  static async updateJournalVoucher(id: number, data: {
    date?: string;
    voucherType?: 'general' | 'opening' | 'closing' | 'sales' | 'purchase' | 'treasury' | 'payroll' | 'adjustment';
    manualVoucherNumber?: string;
    description?: string;
    status?: 'draft' | 'approved' | 'permanent';
    attachments?: unknown[];
    items?: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
      detailedId?: number | null;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[];
  }, externalTx?: DbExecutor): Promise<JournalVoucher> {
    const executeWork = async (tx: DbExecutor) => {
      const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      // P2-03: انجماد اسناد تاییدشده (approved) و دائم (permanent) — ویرایش مستقیم منحصراً برای اسناد با وضعیت پیش‌نویس (draft) مجاز است
      if (existing.status !== 'draft') {
        const statusLabel = existing.status === 'approved' ? 'تاییدشده' : existing.status === 'permanent' ? 'دائم و قطعی' : existing.status;
        throw new BusinessLogicError(
          `اسناد با وضعیت «${statusLabel}» به دلیل رعایت الزامات تغییرناپذیری دفتر روزنامه قابل ویرایش مستقیم نیستند. برای اعمال هرگونه تغییر، منحصراً از فرایند استاندارد «صدور سند اصلاحی» یا «ابطال سند» استفاده نمایید.`
        );
      }

      const updatedDate = data.date ? (requireStorageDate(data.date, 'تاریخ سند') || undefined) : undefined;

      if (updatedDate) {
        await this.checkFiscalPeriodOpen(updatedDate, tx);
      } else {
        await this.checkFiscalPeriodOpen(existing.date, tx);
      }

      let sumDebit = fin(existing.totalDebit);
      let sumCredit = fin(existing.totalCredit);

      if (data.items && data.items.length >= 2) {
        sumDebit = fin(0);
        sumCredit = fin(0);
        for (const item of data.items) {
          const d = fin(item.debit);
          const c = fin(item.credit);
          if (d.isNegative() || c.isNegative()) throw new ValidationError('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند');
          if (d.isZero() && c.isZero()) throw new ValidationError('هر ردیف سند باید دارای مبلغ بدهکار یا بستانکار باشد');
          sumDebit = sumDebit.add(d);
          sumCredit = sumCredit.add(c);
        }
        const diff = sumDebit.subtract(sumCredit).abs();
        if (diff.greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
          throw new UnbalancedVoucherError(`سند تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()} و جمع بستانکار: ${sumCredit.toDisplayString()} می‌باشد (اختلاف: ${diff.toDisplayString()})`);
        }

        // V6.0.21 (TD-157): Soft-delete old items instead of physical hard delete (RULE 09)
        await tx.update(journalVoucherItems).set({ isDeleted: 1 }).where(and(eq(journalVoucherItems.voucherId, id), eq(journalVoucherItems.isDeleted, 0)));

        await insertVoucherItems(tx, data.items.map((item, idx) => ({
          voucherId: id,
          accountId: item.accountId,
          rowOrder: idx + 1,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName?.trim() || '',
          debit: money(item.debit),
          credit: money(item.credit),
          currency: item.currency || 'IRR',
          exchangeRate: moneyOr(item.exchangeRate, 1),
          description: item.description?.trim() || data.description || existing.description,
          isDeleted: 0,
        })));
      }

      const storedAttachments = data.attachments !== undefined
        ? await AttachmentStorageService.normalizeForRecord(tx, 'journal_voucher', id, data.attachments)
        : undefined;
      await tx.update(journalVouchers).set({
        ...(updatedDate ? { date: updatedDate } : {}),
        ...(data.voucherType ? { voucherType: data.voucherType } : {}),
        ...(data.manualVoucherNumber !== undefined ? { manualVoucherNumber: data.manualVoucherNumber.trim() } : {}),
        ...(data.description ? { description: data.description.trim() } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(storedAttachments !== undefined ? { attachments: storedAttachments } : {}),
        totalDebit: money(sumDebit),
        totalCredit: money(sumCredit),
      }).where(eq(journalVouchers.id, id));
    };

    if (externalTx) {
      await executeWork(externalTx);
    } else {
      await orm.transaction(async (tx) => {
        await executeWork(tx);
      });
    }

    return this.getJournalVoucherById(id, externalTx);
  }

  static async deleteJournalVoucher(id: number): Promise<{ success: boolean }> {
    return await orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(journalVouchers).where(and(eq(journalVouchers.id, id), eq(journalVouchers.isDeleted, 0))).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      await this.assertNoActiveReversal(tx, existing, 'حذف نمی‌شود');
      if (existing.status === 'permanent') {
        throw new BusinessLogicError('اسناد دائم و قطعی‌شده حسابداری قابل حذف مستقیم نیستند. برای بی‌اثر کردن سند، از گزینه «صدور سند برگشتی (ابطال سند)» استفاده نمایید.');
      }
      if (existing.status === 'approved') {
        throw new BusinessLogicError('اسناد تاییدشده حسابداری به دلیل اثرگذاری در دفاتر و گزارش‌ها قابل حذف مستقیم نیستند. برای حذف، ابتدا سند را به وضعیت «پیش‌نویس» برگردانید یا در صورت نیاز از «صدور سند برگشتی (ابطال سند)» استفاده نمایید.');
      }

      await this.checkFiscalPeriodOpen(existing.date, tx);

      // V6.0.21 (TD-157): Cascade soft-delete journal voucher and its line items (RULE 09)
      await tx.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, id));
      await tx.update(journalVoucherItems).set({ isDeleted: 1 }).where(and(eq(journalVoucherItems.voucherId, id), eq(journalVoucherItems.isDeleted, 0)));
      return { success: true };
    });
  }

  /**
   * v8.0.2 (TD-251، تصمیم مالک محصول): بی‌اثر کردن سند حسابداری یک منشأ ابطال‌شده (سند انبار/فاکتور، تراکنش خزانه،
   * چک). سند پیش‌نویس هرگز در دفاتر تأییدشده نیامده است، پس حذف نرم می‌شود (با همان کنترل سال مالی باز)؛ سند
   * تأییدشده یا دائم مانند قبل سند معکوس می‌گیرد. پیش‌تر سند پیش‌نویس هم سند معکوس «تأییدشده» می‌گرفت و تراز آزمایشی
   * فقط سند معکوس را می‌دید (حساب دریافتنی و فروش منفی).
   */
  static async voidSourceVoucher(params: {
    voucherId: number;
    date?: string;
    reason?: string;
    userId?: number;
    username?: string;
    externalTx: DbExecutor;
    allowReversalOfReversal?: boolean;
  }): Promise<{ action: 'deleted' | 'reversed'; reversalVoucherId: number | null }> {
    const tx = params.externalTx;
    const [existing] = await tx.select({ id: journalVouchers.id, status: journalVouchers.status, date: journalVouchers.date })
      .from(journalVouchers)
      .where(and(eq(journalVouchers.id, params.voucherId), eq(journalVouchers.isDeleted, 0)))
      .for('update');
    if (!existing) throw new NotFoundError(`سند حسابداری با شناسه ${params.voucherId} یافت نشد.`);

    if (existing.status === 'draft') {
      await this.checkFiscalPeriodOpen(existing.date, tx);
      await tx.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, existing.id));
      await tx.update(journalVoucherItems).set({ isDeleted: 1 })
        .where(and(eq(journalVoucherItems.voucherId, existing.id), eq(journalVoucherItems.isDeleted, 0)));
      return { action: 'deleted', reversalVoucherId: null };
    }

    const reversal = await this.reverseVoucher({
      voucherId: existing.id,
      date: params.date,
      reason: params.reason,
      userId: params.userId,
      username: params.username,
      externalTx: tx,
      allowReversalOfReversal: params.allowReversalOfReversal,
    });
    return { action: 'reversed', reversalVoucherId: reversal?.id ?? null };
  }

  /**
   * v8.0.68 (TD-321): سند برگشتِ فعالِ یک سند — ابطال (REV-V) یا ابطال برای بازثبت (VOID-REPOST-V). هر سند فقط یک بار
   * برگشت می‌خورد؛ پیش‌تر هر مسیر فقط پیشوند خودش را می‌سنجید و «ابطال و بازثبت» پس از ابطال یا اصلاح (و برعکس) سند را دو
   * بار برمی‌گرداند. فراخواننده سند مبدأ را پیش‌تر در همان تراکنش FOR UPDATE قفل کرده است.
   */
  private static async findActiveReversal(tx: DbExecutor, original: { id: number; voucherNumber: string | number }): Promise<{ voucherNumber: string | number } | undefined> {
    const [reversal] = await tx.select({ voucherNumber: journalVouchers.voucherNumber }).from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceId, original.id),
        inArray(journalVouchers.referenceNumber, [`REV-V${original.voucherNumber}`, `VOID-REPOST-V${original.voucherNumber}`]),
        eq(journalVouchers.isDeleted, 0)
      ))
      .limit(1);
    return reversal;
  }

  /**
   * v8.0.70 (TD-323): سندی که سند برگشت فعال دارد به پیش‌نویس برنمی‌گردد و حذف نمی‌شود؛ پیش‌تر برمی‌گشت و حذف می‌شد و سند
   * برگشت بی‌مبدأ می‌ماند (دفتر کل اثر سند را منفی نشان می‌داد).
   */
  private static async assertNoActiveReversal(tx: DbExecutor, voucher: { id: number; voucherNumber: string | number }, action: string): Promise<void> {
    const reversal = await this.findActiveReversal(tx, voucher);
    if (reversal) {
      throw new BusinessLogicError(`سند شماره «${voucher.voucherNumber}» سند برگشت فعال به شماره «${reversal.voucherNumber}» دارد و ${action}. برای بی‌اثر کردن دوباره، سند برگشت را بررسی کنید.`);
    }
  }

  /**
   * Reverse Voucher Pattern (صدور سند عکس / عطف / برگشت)
   * Inverts all debit and credit rows to completely neutralize the financial impact of a voucher.
   */
  static async reverseVoucher(
    params: {
      voucherId: number;
      date?: string;
      reason?: string;
      userId?: number;
      username?: string;
      externalTx?: DbExecutor;
      allowReversalOfReversal?: boolean;
    }
  ): Promise<JournalVoucher> {

    const execute = async (tx: DbExecutor): Promise<number> => {
      // TD-146: قفل سطری سخت‌گیرانه روی سند مبدأ برای جلوگیری از مسابقه همزمانی (Race Condition)
      const [original] = await tx.select().from(journalVouchers)
        .where(and(eq(journalVouchers.id, params.voucherId), eq(journalVouchers.isDeleted, 0)))
        .for('update');

      if (!original) throw new NotFoundError('سند مبدا یافت نشد یا قبلاً حذف شده است');

      // ممانعت از ابطال اسناد اختتامیه
      if (original.voucherType === 'closing') {
        throw new BusinessLogicError(`سند اختتامیه شماره «${original.voucherNumber}» قابل ابطال مستقیم نیست.`);
      }
      // v8.0.70 (TD-323، قاعده TD-251): سند پیش‌نویس سند معکوس تأییدشده نمی‌گیرد؛ پیش‌تر می‌گرفت و دفاتر تأییدشده فقط
      // سند معکوس را می‌دیدند
      if (original.status === 'draft') {
        throw new BusinessLogicError(`سند پیش‌نویس شماره «${original.voucherNumber}» در دفاتر نیامده است و برگشت نمی‌خورد؛ آن را ویرایش یا حذف کنید.`);
      }

      const isReversalOfReversal = Boolean(original.referenceNumber?.startsWith('REV-V') || original.referenceNumber?.startsWith('VOID-REPOST-V'));

      // ممانعت از ابطال سندی که خود سند برگشتی است، مگر در موارد کنترل‌شده خزانه‌داری
      if (isReversalOfReversal && !params.allowReversalOfReversal) {
        throw new ConflictError(`امکان صدور سند معکوس برای سند برگشتی «${original.voucherNumber}» وجود ندارد.`);
      }

      // P2-06: تعیین شماره عطف معکوس — در صورت ابطال سند معکوس، پیشوند RE-REV اختصاص می‌یابد
      const expectedRevRef = isReversalOfReversal ? `RE-REV-V${original.voucherNumber}` : `REV-V${original.voucherNumber}`;
      const existingReversals = await tx.select().from(journalVouchers)
        .where(and(
          eq(journalVouchers.referenceId, original.id),
          eq(journalVouchers.referenceNumber, expectedRevRef),
          eq(journalVouchers.isDeleted, 0)
        ))
        .for('update');

      if (existingReversals.length > 0) {
        throw new ConflictError(
          `برای سند شماره «${original.voucherNumber}» قبلاً سند معکوس به شماره «${existingReversals[0].voucherNumber}» صادر گردیده است و امکان ابطال مجدد وجود ندارد.`
        );
      }
      const otherReversal = isReversalOfReversal ? undefined : await this.findActiveReversal(tx, original);
      if (otherReversal) {
        throw new ConflictError(
          `برای سند شماره «${original.voucherNumber}» قبلاً سند برگشت به شماره «${otherReversal.voucherNumber}» صادر گردیده است و امکان ابطال مجدد وجود ندارد.`
        );
      }

      const originalItems = await tx.select().from(journalVoucherItems)
        .where(and(
          eq(journalVoucherItems.voucherId, original.id),
          eq(journalVoucherItems.isDeleted, 0)
        ))
        .orderBy(journalVoucherItems.rowOrder);

      if (!originalItems || originalItems.length === 0) {
        throw new ValidationError('سند مبدا فاقد ردیف‌های مالی برای برگشت است');
      }

      const reversalDate = requireStorageDate(params.date, 'تاریخ سند برگشت') || (await businessTodayIsoDate());

      await this.checkFiscalPeriodOpen(reversalDate, tx);

      const nextNumber = await this.getNextVoucherNumber(tx);
      const reasonText = params.reason?.trim() ? ` (علت: ${params.reason.trim()})` : '';
      const desc = isReversalOfReversal
        ? `سند اصلاحی معکوسِ معکوس سند حسابداری شماره ${original.voucherNumber}${reasonText}: ${original.description}`
        : `سند برگشت/عطف سند حسابداری شماره ${original.voucherNumber}${reasonText}: ${original.description}`;

      const [voucher] = await tx.insert(journalVouchers).values({
        voucherNumber: nextNumber,
        manualVoucherNumber: '',
        date: reversalDate,
        voucherType: 'adjustment',
        status: 'approved',
        totalDebit: money(original.totalCredit),
        totalCredit: money(original.totalDebit),
        description: desc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: expectedRevRef,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      // Invert rows: debit becomes credit, credit becomes debit
      await insertVoucherItems(tx, originalItems.map((item, idx) => ({
        voucherId: voucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName || '',
        debit: money(item.credit), // Inverted
        credit: money(item.debit), // Inverted
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: `برگشت ردیف ${item.rowOrder || idx + 1}: ${item.description || original.description}`,
      })));

      return voucher.id;
    };

    // V9-1.1: پشتیبانی از تراکنش خارجی برای اجرای اتمیک در تراکنش فراخواننده (حذف سند)
    const reversalVoucherId = params.externalTx
      ? await execute(params.externalTx)
      : await orm.transaction(execute);

    // V9 Phase 6: هنگام اجرا در تراکنش فراخواننده، سند معکوس هنوز commit نشده و
    // خواندن با اتصال orm آن را نمی‌بیند — بازخوانی باید با همان externalTx انجام شود.
    return this.getJournalVoucherById(reversalVoucherId, params.externalTx);
  }

  /**
   * Correction Voucher Pattern (صدور سند اصلاحی)
   * Issues a reversal voucher for the previous voucher and creates the new corrected voucher atomically.
   */
  static async correctVoucher(
    params: {
      voucherId: number;
      date?: string;
      reason: string;
      newItems: {
        accountId: number;
        detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
        detailedId?: number | null;
        detailedName?: string;
        debit: DecimalValue;
        credit: DecimalValue;
        currency?: string;
        exchangeRate?: DecimalValue;
        description?: string;
      }[];
      newDescription?: string;
      userId?: number;
      username?: string;
    }
  ): Promise<{ reversalVoucher: JournalVoucher; correctedVoucher: JournalVoucher; message: string }> {
    if (!params.reason || !params.reason.trim()) {
      throw new Error('ثبت علت اصلاح سند الزامی است');
    }
    if (!params.newItems || params.newItems.length < 2) {
      throw new Error('سند اصلاحی باید حداقل شامل دو ردیف معتبر و تراز باشد');
    }

    const result = await orm.transaction(async (tx) => {
      // v8.0.68 (TD-321): سند مبدأ درون همین تراکنش قفل و زیر قفل خوانده و سنجیده می‌شود، مانند reverseVoucher. پیش‌تر
      // بیرون از تراکنش و بی‌قفل خوانده می‌شد و گارد «سند معکوس فعال قبلی» ردیفی برای قفل نداشت؛ دو اصلاح هم‌زمان (یا
      // اصلاح و ابطال هم‌زمان) هر دو پذیرفته می‌شدند و اثر سند دو بار برمی‌گشت.
      const [lockedOriginal] = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.id, params.voucherId), eq(journalVouchers.isDeleted, 0)))
        .for('update');
      if (!lockedOriginal) throw new NotFoundError('سند مبدا یافت نشد یا قبلاً حذف شده است');
      const original = await this.getJournalVoucherById(params.voucherId, tx);

      // C-03 & P0-06: اسناد قطعی (permanent) از نظر قانونی و سیستمی غیرقابل ابطال یا اصلاح هستند
      if (original.status === 'permanent') {
        throw new BusinessLogicError(`سند قطعی شماره «${original.voucherNumber}» غیرقابل اصلاح یا ابطال است.`);
      }

      if (original.voucherType === 'closing') {
        throw new BusinessLogicError(`سند اختتامیه شماره «${original.voucherNumber}» قابل اصلاح مستقیم نیست.`);
      }
      if (original.status === 'draft') { // v8.0.70 (TD-323)
        throw new BusinessLogicError(`سند پیش‌نویس شماره «${original.voucherNumber}» در دفاتر نیامده است و برگشت نمی‌خورد؛ آن را ویرایش یا حذف کنید.`);
      }

      if (original.referenceNumber?.startsWith('REV-V') || original.referenceNumber?.startsWith('VOID-REPOST-V')) {
        throw new ConflictError(`امکان اصلاح سند معکوس یا برگشتی «${original.voucherNumber}» وجود ندارد.`);
      }

      const correctionDate = requireStorageDate(params.date, 'تاریخ سند اصلاحی') || (await businessTodayIsoDate());
      await this.checkFiscalPeriodOpen(correctionDate, tx);

      // C-03 & P0-06: گارد عدم وجود سند معکوس فعال قبلی (از v8.0.68 هر نوع برگشت، زیر قفل سند مبدأ)
      const existingReversal = await this.findActiveReversal(tx, original);
      if (existingReversal) {
        throw new ConflictError(
          `برای سند شماره «${original.voucherNumber}» قبلاً سند معکوس اصلاحی به شماره «${existingReversal.voucherNumber}» صادر گردیده است.`
        );
      }

      // 1. Create Reversal Voucher
      const revNumber = await this.getNextVoucherNumber(tx);
      const revDesc = `سند برگشت به علت اصلاح سند شماره ${original.voucherNumber} (${params.reason.trim()}): ${original.description}`;

      const [revVoucher] = await tx.insert(journalVouchers).values({
        voucherNumber: revNumber,
        manualVoucherNumber: '',
        date: correctionDate,
        voucherType: 'adjustment',
        status: 'approved',
        totalDebit: money(original.totalCredit),
        totalCredit: money(original.totalDebit),
        description: revDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `REV-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      await insertVoucherItems(tx, original.items!.map((item, idx) => ({
        voucherId: revVoucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName || '',
        debit: money(item.credit),
        credit: money(item.debit),
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: `برگشت ردیف ${item.rowOrder || idx + 1}: ${item.description || original.description}`,
      })));

      // 2. Validate new items
      let sumDebit = fin(0);
      let sumCredit = fin(0);
      for (const it of params.newItems) {
        const d = fin(it.debit);
        const c = fin(it.credit);
        if (d.isNegative() || c.isNegative()) throw new Error('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند');
        if (d.isZero() && c.isZero()) throw new Error('هر ردیف سند باید دارای مبلغ باشد');
        sumDebit = sumDebit.add(d);
        sumCredit = sumCredit.add(c);
      }
      const diff = sumDebit.subtract(sumCredit).abs();
      if (diff.greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
        throw new Error(`سند اصلاحی تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()}، جمع بستانکار: ${sumCredit.toDisplayString()} (اختلاف: ${diff.toDisplayString()})`);
      }

      // 3. Create Corrected Voucher
      const corrNumber = await this.getNextVoucherNumber(tx);
      const corrDesc = `سند اصلاحی جایگزین سند شماره ${original.voucherNumber} (علت: ${params.reason.trim()}): ${params.newDescription?.trim() || original.description}`;

      const [corrVoucher] = await tx.insert(journalVouchers).values({
        voucherNumber: corrNumber,
        manualVoucherNumber: '',
        date: correctionDate,
        voucherType: original.voucherType || 'general',
        status: 'approved',
        totalDebit: money(sumDebit),
        totalCredit: money(sumCredit),
        description: corrDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `CORR-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      await insertVoucherItems(tx, params.newItems.map((item, idx) => ({
        voucherId: corrVoucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName?.trim() || '',
        debit: money(item.debit),
        credit: money(item.credit),
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: item.description?.trim() || corrDesc,
      })));

      return {
        revId: revVoucher.id,
        corrId: corrVoucher.id
      };
    });

    const reversalVoucher = await this.getJournalVoucherById(result.revId);
    const correctedVoucher = await this.getJournalVoucherById(result.corrId);

    return {
      reversalVoucher,
      correctedVoucher,
      message: `سند معکوس شماره #${reversalVoucher.voucherNumber} و سند اصلاحی شماره #${correctedVoucher.voucherNumber} با موفقیت صادر شدند.`
    };
  }

  /**
   * Repost Voucher Workflow (سند ابطال و بازثبت / Repost)
   * Voids the target voucher with an automated reversal voucher and creates the newly reposted voucher,
   * preserving complete audit trail and ledger invariants without direct mutation of posted records.
   */
  static async repostVoucher(params: {
    voucherId: number;
    date?: string;
    reason: string;
    newItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
      detailedId?: number | null;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[];
    newDescription?: string;
    newManualVoucherNumber?: string;
    userId?: number;
    username?: string;
  }): Promise<{
    voidVoucher: JournalVoucher;
    repostedVoucher: JournalVoucher;
    message: string;
  }> {
    if (!params.reason || !params.reason.trim()) {
      throw new Error('علت ابطال و بازثبت سند (Reason) الزامی است');
    }
    if (!params.newItems || params.newItems.length < 2) {
      throw new Error('سند جدید بازثبت‌شده باید حداقل دارای دو ردیف بدهکار و بستانکار باشد');
    }

    const repostDate = requireStorageDate(params.date, 'تاریخ سند') || (await businessTodayIsoDate());

    const result = await orm.transaction(async (tx) => {
      // v8.0.68 (TD-321): سند مبدأ زیر قفل، مانند reverseVoucher و correctVoucher
      await tx.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.id, params.voucherId), eq(journalVouchers.isDeleted, 0)))
        .for('update');
      const original = await this.getJournalVoucherById(params.voucherId, tx);
      if (!original) throw new Error('سند مبدا جهت بازثبت یافت نشد');
      if (original.isDeleted === 1 || original.is_deleted === 1) throw new Error('سند مبدا حذف شده است');

      // C-03 & P0-06: اسناد قطعی (permanent) به هیچ وجه قابل ابطال یا بازثبت نیستند
      if (original.status === 'permanent') {
        throw new BusinessLogicError(`سند قطعی شماره «${original.voucherNumber}» از نظر قانونی و مالی غیرقابل ابطال یا بازثبت است.`);
      }

      if (original.voucherType === 'closing') {
        throw new BusinessLogicError(`سند اختتامیه شماره «${original.voucherNumber}» قابل ابطال یا بازثبت نیست.`);
      }
      if (original.status === 'draft') { // v8.0.70 (TD-323)
        throw new BusinessLogicError(`سند پیش‌نویس شماره «${original.voucherNumber}» در دفاتر نیامده است و برگشت نمی‌خورد؛ آن را ویرایش یا حذف کنید.`);
      }

      if (original.referenceNumber?.startsWith('REV-V') || original.referenceNumber?.startsWith('VOID-REPOST-V')) {
        throw new ConflictError(`امکان بازثبت مجدد سند معکوس یا ابطال‌شده «${original.voucherNumber}» وجود ندارد.`);
      }

      // C-03 & P0-06: گارد عدم وجود سند ابطال/بازثبت قبلی (از v8.0.68 هر نوع برگشت)
      const expectedVoidRef = `VOID-REPOST-V${original.voucherNumber}`;
      const existingReversal = await this.findActiveReversal(tx, original);
      if (existingReversal) {
        throw new ConflictError(
          `برای سند شماره «${original.voucherNumber}» قبلاً سند برگشت به شماره «${existingReversal.voucherNumber}» صادر گردیده است.`
        );
      }

      await this.checkFiscalPeriodOpen(original.date, tx);
      await this.checkFiscalPeriodOpen(repostDate, tx);

      // 1. Issue Void/Reversal Voucher
      const voidVoucherNumber = await this.getNextVoucherNumber(tx);
      const voidDesc = `سند ابطال و برگشت جهت بازثبت سند شماره #${original.voucherNumber} (علت: ${params.reason.trim()}): ${original.description}`;

      const [voidVoucher] = await tx.insert(journalVouchers).values({
        voucherNumber: voidVoucherNumber,
        manualVoucherNumber: '',
        date: repostDate,
        voucherType: 'adjustment',
        status: 'approved',
        totalDebit: money(original.totalCredit),
        totalCredit: money(original.totalDebit),
        description: voidDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: expectedVoidRef,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      await insertVoucherItems(tx, (original.items || []).map((item, idx) => ({
        voucherId: voidVoucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName || '',
        debit: money(item.credit),
        credit: money(item.debit),
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: `ابطال ردیف ${item.rowOrder || idx + 1}: ${item.description || original.description}`,
      })));

      // 2. Validate Reposted Voucher Items Balance
      let sumDebit = fin(0);
      let sumCredit = fin(0);
      for (const it of params.newItems) {
        const d = fin(it.debit);
        const c = fin(it.credit);
        if (d.isNegative() || c.isNegative()) throw new Error('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند');
        if (d.isZero() && c.isZero()) throw new Error('هر ردیف سند باید دارای مبلغ باشد');
        sumDebit = sumDebit.add(d);
        sumCredit = sumCredit.add(c);
      }
      const diff = sumDebit.subtract(sumCredit).abs();
      if (diff.greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
        throw new Error(`سند بازثبت‌شده تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()}، جمع بستانکار: ${sumCredit.toDisplayString()} (اختلاف: ${diff.toDisplayString()})`);
      }

      // 3. Insert the newly reposted voucher
      const repostNumber = await this.getNextVoucherNumber(tx);
      const repostDesc = `سند بازثبت‌شده (Repost) جایگزین سند شماره #${original.voucherNumber} (علت: ${params.reason.trim()}): ${params.newDescription?.trim() || original.description}`;

      const [repostedVoucher] = await tx.insert(journalVouchers).values({
        voucherNumber: repostNumber,
        manualVoucherNumber: params.newManualVoucherNumber?.trim() || '',
        date: repostDate,
        voucherType: original.voucherType || 'general',
        status: 'approved',
        totalDebit: money(sumDebit),
        totalCredit: money(sumCredit),
        description: repostDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `REPOST-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      await insertVoucherItems(tx, params.newItems.map((item, idx) => ({
        voucherId: repostedVoucher.id,
        accountId: item.accountId,
        rowOrder: idx + 1,
        detailedType: item.detailedType || 'none',
        detailedId: item.detailedId || null,
        detailedName: item.detailedName?.trim() || '',
        debit: money(item.debit),
        credit: money(item.credit),
        currency: item.currency || 'IRR',
        exchangeRate: moneyOr(item.exchangeRate, 1),
        description: item.description?.trim() || repostDesc,
      })));

      return {
        voidId: voidVoucher.id,
        repostId: repostedVoucher.id,
      };
    });

    const voidVoucher = await this.getJournalVoucherById(result.voidId);
    const repostedVoucher = await this.getJournalVoucherById(result.repostId);

    return {
      voidVoucher,
      repostedVoucher,
      message: `سند ابطال شماره #${voidVoucher.voucherNumber} و سند بازثبت‌شده جدید شماره #${repostedVoucher.voucherNumber} با موفقیت صادر شدند.`
    };
  }

  /**
   * Finalize Voucher (قطعی‌سازی و تغییر وضعیت به permanent)
   * Locks the voucher permanently against any direct edits or deletions.
   */
  static async finalizeJournalVoucher(id: number, userId?: number, username?: string): Promise<JournalVoucher> {
    await orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      if (existing.isDeleted === 1) throw new NotFoundError('سند حذف شده است');
      if (existing.status === 'permanent') return; // Already permanent

      await this.checkFiscalPeriodOpen(existing.date, tx);

      if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) > VOUCHER_BALANCE_TOLERANCE) {
        throw new UnbalancedVoucherError('امکان قطعی‌سازی سند نامتراز وجود ندارد');
      }

      await tx.update(journalVouchers).set({
        status: 'permanent',
        approvedById: userId || null,
      }).where(eq(journalVouchers.id, id));
    });

    return this.getJournalVoucherById(id);
  }

  /**
   * Batch Finalize Vouchers
   */
  static async finalizeJournalVouchers(ids: number[], userId?: number, username?: string): Promise<{ finalizedCount: number; ids: number[] }> {
    if (!ids || ids.length === 0) return { finalizedCount: 0, ids: [] };

    // Deadlock Prevention: Always sort IDs in ascending order before row-level locking
    const sortedIds = Array.from(new Set(ids.map(Number))).filter(id => !isNaN(id) && id > 0).sort((a, b) => a - b);

    await orm.transaction(async (tx) => {
      for (const id of sortedIds) {
        const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
        if (existing && existing.isDeleted === 0 && existing.status !== 'permanent') {
          await this.checkFiscalPeriodOpen(existing.date, tx);
          if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) <= VOUCHER_BALANCE_TOLERANCE) {
            await tx.update(journalVouchers).set({
              status: 'permanent',
              approvedById: userId || null,
            }).where(eq(journalVouchers.id, id));
          }
        }
      }
    });

    return { finalizedCount: sortedIds.length, ids: sortedIds };
  }

  /**
   * Batch Approve Vouchers (draft -> approved)
   * تایید حسابداری گروهی اسناد پیش‌نویس جهت اثرگذاری در تراز آزمایشی و دفاتر رسمی
   */
  static async approveJournalVouchers(ids: number[], userId?: number, username?: string): Promise<{ approvedCount: number; ids: number[] }> {
    if (!ids || ids.length === 0) return { approvedCount: 0, ids: [] };

    // Deadlock Prevention: Always sort IDs in ascending order before row-level locking
    const sortedIds = Array.from(new Set(ids.map(Number))).filter(id => !isNaN(id) && id > 0).sort((a, b) => a - b);
    let count = 0;

    await orm.transaction(async (tx) => {
      for (const id of sortedIds) {
        const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
        if (existing && existing.isDeleted === 0 && existing.status === 'draft') {
          await this.checkFiscalPeriodOpen(existing.date, tx);
          await tx.update(journalVouchers).set({
            status: 'approved',
            approvedById: userId || null,
          }).where(eq(journalVouchers.id, id));
          count++;
        }
      }
    });

    return { approvedCount: count, ids: sortedIds };
  }

  /**
   * Set Voucher Status (draft, approved, permanent)
   */
  static async setVoucherStatus(id: number, status: 'draft' | 'approved' | 'permanent', userId?: number): Promise<JournalVoucher> {
    await orm.transaction(async (tx) => this.applyVoucherStatus(tx, id, status, userId));
    return this.getJournalVoucherById(id);
  }

  /** v9.0.2 (TD-415): تغییر وضعیت درون تراکنش فراخواننده (اقدام پس از انتقال گردش‌کار سند حسابداری) */
  static async applyVoucherStatus(tx: DbExecutor, id: number, status: 'draft' | 'approved' | 'permanent', userId?: number): Promise<void> {
    const [existing] = await tx.select().from(journalVouchers).where(and(eq(journalVouchers.id, id), eq(journalVouchers.isDeleted, 0))).for('update');
    if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
    if (status === 'draft' && existing.status !== 'draft') await this.assertNoActiveReversal(tx, existing, 'به پیش‌نویس برنمی‌گردد');
    if (existing.status === 'permanent' && status !== 'permanent') {
      throw new BusinessLogicError('اسناد دائم و قطعی‌شده قابل تغییر وضعیت به پیش‌نویس یا تایید نشده نیستند. لطفاً از گزینه «صدور سند برگشتی (ابطال سند)» یا «سند اصلاحی» استفاده فرمایید.');
    }

    await this.checkFiscalPeriodOpen(existing.date, tx);

    if (status === 'permanent') {
      if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) > VOUCHER_BALANCE_TOLERANCE) {
        throw new UnbalancedVoucherError('امکان قطعی‌سازی سند نامتراز وجود ندارد');
      }
    }

    await tx.update(journalVouchers).set({
      status,
      approvedById: status === 'draft' ? null : (userId || existing.approvedById || null)
    }).where(eq(journalVouchers.id, id));
  }
}

