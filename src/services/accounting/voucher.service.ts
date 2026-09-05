import { orm, type DbExecutor } from '../../db/drizzle.js';
import { accounts, journalVouchers, journalVoucherItems } from '../../db/schema.js';
import { eq, desc, asc, and, or, sql, like, inArray, gte, lte } from 'drizzle-orm';
import type { JournalVoucher, JournalVoucherItem } from '../../types.js';
import { updateRequestContext } from '../../lib/requestContext.js';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { getTodayJalaliDate } from '../../utils.js';
import { NotFoundError, ValidationError, UnbalancedVoucherError, BusinessLogicError } from '../../errors/customErrors.js';

export class VoucherService {
  static async getNextVoucherNumber(tx?: DbExecutor): Promise<number> {
    const executor = tx || orm;
    const result = await executor.execute(sql`SELECT nextval('journal_voucher_number_seq') AS num`);
    return Number(result.rows?.[0]?.num);
  }

  /**
   * Check whether the fiscal year corresponding to the voucher date is closed.
   * If closed, operations modifying or creating vouchers are prohibited.
   */
  static async checkFiscalPeriodOpen(date: string, tx?: DbExecutor): Promise<void> {
    if (!date) return;
    const executor = tx || orm;
    // V10-1.2: year extraction unified on the Jalali fiscal key (business clock rule),
    // because dates are now stored in normalized Gregorian ISO format.
    const { resolveJalaliFiscalYear } = await import('../../lib/businessClock.js');
    const year = String(resolveJalaliFiscalYear(date));

    const [closingVoucher] = await executor.select()
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.isDeleted, 0),
        eq(journalVouchers.voucherType, 'closing'),
        or(
          like(journalVouchers.referenceNumber, `%CLOSING-${year}%`),
          like(journalVouchers.referenceNumber, `%CLOSE-%${year}%`)
        )
      ))
      .limit(1);

    if (closingVoucher) {
      throw new BusinessLogicError(`سال مالی ${year} با ثبت سند اختتامیه شماره #${closingVoucher.voucherNumber} بسته شده است و امکان صدور یا ویرایش سند در این سال مالی وجود ندارد`);
    }
  }

  /**
   * Helper to check if a specific date or fiscal period is closed.
   */
  static async isPeriodClosed(date: string, tx?: DbExecutor): Promise<boolean> {
    if (!date) return false;
    try {
      await this.checkFiscalPeriodOpen(date, tx);
      return false;
    } catch {
      return true;
    }
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
      const q = `%${params.search.trim()}%`;
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
      .where(inArray(journalVoucherItems.voucherId, voucherIds))
      .orderBy(asc(journalVoucherItems.rowOrder));

      for (const item of rawItems) {
        const list = itemsMap.get(item.voucherId) || [];
        list.push({
          ...item,
          detailedType: item.detailedType as JournalVoucherItem['detailedType'],
          detailed_type: item.detailedType as JournalVoucherItem['detailedType'],
          account_id: item.accountId,
          voucher_id: item.voucherId,
          row_order: item.rowOrder ?? 1,
        });
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
      total_debit: Number(v.totalDebit),
      total_credit: Number(v.totalCredit),
      totalDebit: Number(v.totalDebit),
      totalCredit: Number(v.totalCredit),
      referenceModule: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_module: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_id: v.referenceId,
      reference_number: v.referenceNumber || '',
      created_by_username: v.createdByUsername || '',
      items: itemsMap.get(v.id) || []
    }));

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
    .where(eq(journalVoucherItems.voucherId, id))
    .orderBy(asc(journalVoucherItems.rowOrder));

    return {
      ...v,
      voucher_number: v.voucherNumber,
      manual_voucher_number: v.manualVoucherNumber || '',
      voucher_type: v.voucherType as JournalVoucher['voucherType'],
      voucherType: v.voucherType as JournalVoucher['voucherType'],
      status: v.status as JournalVoucher['status'],
      total_debit: Number(v.totalDebit),
      total_credit: Number(v.totalCredit),
      totalDebit: Number(v.totalDebit),
      totalCredit: Number(v.totalCredit),
      referenceModule: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_module: (v.referenceModule || 'manual') as JournalVoucher['referenceModule'],
      reference_id: v.referenceId,
      reference_number: v.referenceNumber || '',
      created_by_username: v.createdByUsername || '',
      items: rawItems.map(item => ({
        ...item,
        debit: Number(item.debit),
        credit: Number(item.credit),
        detailedType: item.detailedType as JournalVoucherItem['detailedType'],
        detailed_type: item.detailedType as JournalVoucherItem['detailedType'],
        account_id: item.accountId,
        voucher_id: item.voucherId,
        row_order: item.rowOrder ?? 1,
      }))
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
    currency?: string;
    userId?: number;
    username?: string;
    items: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
      detailedId?: number | null;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
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

    // Verify double-entry balance with precision tolerance (< 0.0001)
    const diff = sumDebit.subtract(sumCredit).abs();
    if (diff.greaterThan(0.0001)) {
      throw new UnbalancedVoucherError(`سند تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()} و جمع بستانکار: ${sumCredit.toDisplayString()} می‌باشد (اختلاف: ${diff.toDisplayString()})`);
    }

    const executeWork = async (tx: DbExecutor) => {
      // Check if fiscal year is closed
      if (data.voucherType !== 'closing') {
        await this.checkFiscalPeriodOpen(data.date, tx);
      }

      const voucherNum = await this.getNextVoucherNumber(tx);
      const [voucher] = await tx.insert(journalVouchers).values({
        manualVoucherNumber: data.manualVoucherNumber?.trim() || '',
        voucherNumber: voucherNum,
        date: data.date.trim(),
        voucherType: data.voucherType || 'general',
        status: data.status || 'approved',
        totalDebit: sumDebit.toNumber(),
        totalCredit: sumCredit.toNumber(),
        description: data.description.trim(),
        referenceModule: data.referenceModule || 'manual',
        referenceId: data.referenceId || null,
        referenceNumber: data.referenceNumber?.trim() || '',
        currency: data.currency || 'IRR',
        createdById: data.userId || null,
        createdByUsername: data.username || '',
      }).returning();

      updateRequestContext({ entityId: `voucher:${voucherNum}`, transactionId: `vch_num_${voucherNum}` });

      // Insert items
      let row = 1;
      for (const item of data.items) {
        await tx.insert(journalVoucherItems).values({
          voucherId: voucher.id,
          accountId: item.accountId,
          rowOrder: row++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName?.trim() || '',
          debit: Number(item.debit) || 0,
          credit: Number(item.credit) || 0,
          currency: item.currency || 'IRR',
          exchangeRate: Number(item.exchangeRate) || 1,
          description: item.description?.trim() || data.description.trim(),
        });
      }

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
    items?: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
      detailedId?: number | null;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
      description?: string;
    }[];
  }, externalTx?: DbExecutor): Promise<JournalVoucher> {
    const executeWork = async (tx: DbExecutor) => {
      const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      if (existing.isDeleted === 1) throw new NotFoundError('سند حذف شده است');

      // Strict Invariant: Permanent / Posted finalized financial documents cannot be directly edited.
      if (existing.status === 'permanent') {
        throw new BusinessLogicError('اسناد دائم و قطعی‌شده به دلیل رعایت الزامات تغییرناپذیری دفتر کل قابل ویرایش مستقیم نیستند. لطفاً از گزینه‌های استاندارد «صدور سند برگشتی (ابطال سند)» یا «صدور سند اصلاحی» استفاده فرمایید.');
      }

      if (data.date) {
        await this.checkFiscalPeriodOpen(data.date, tx);
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
        if (diff.greaterThan(0.0001)) {
          throw new UnbalancedVoucherError(`سند تراز نیست! جمع بدهکار: ${sumDebit.toDisplayString()} و جمع بستانکار: ${sumCredit.toDisplayString()} می‌باشد (اختلاف: ${diff.toDisplayString()})`);
        }

        // Delete old items and re-insert
        await tx.delete(journalVoucherItems).where(eq(journalVoucherItems.voucherId, id));

        let row = 1;
        for (const item of data.items) {
          await tx.insert(journalVoucherItems).values({
            voucherId: id,
            accountId: item.accountId,
            rowOrder: row++,
            detailedType: item.detailedType || 'none',
            detailedId: item.detailedId || null,
            detailedName: item.detailedName?.trim() || '',
            debit: fin(item.debit).toNumber(),
            credit: fin(item.credit).toNumber(),
            currency: item.currency || 'IRR',
            exchangeRate: Number(item.exchangeRate) || 1,
            description: item.description?.trim() || data.description || existing.description,
          });
        }
      }

      await tx.update(journalVouchers).set({
        ...(data.date ? { date: data.date.trim() } : {}),
        ...(data.voucherType ? { voucherType: data.voucherType } : {}),
        ...(data.manualVoucherNumber !== undefined ? { manualVoucherNumber: data.manualVoucherNumber.trim() } : {}),
        ...(data.description ? { description: data.description.trim() } : {}),
        ...(data.status ? { status: data.status } : {}),
        totalDebit: sumDebit.toNumber(),
        totalCredit: sumCredit.toNumber(),
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
      const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      if (existing.status === 'permanent') {
        throw new BusinessLogicError('اسناد دائم و قطعی‌شده حسابداری قابل حذف مستقیم نیستند. برای بی‌اثر کردن سند، از گزینه «صدور سند برگشتی (ابطال سند)» استفاده نمایید.');
      }
      if (existing.status === 'approved') {
        throw new BusinessLogicError('اسناد تاییدشده حسابداری به دلیل اثرگذاری در دفاتر و گزارش‌ها قابل حذف مستقیم نیستند. برای حذف، ابتدا سند را به وضعیت «پیش‌نویس» برگردانید یا در صورت نیاز از «صدور سند برگشتی (ابطال سند)» استفاده نمایید.');
      }

      await this.checkFiscalPeriodOpen(existing.date, tx);

      await tx.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, id));
      return { success: true };
    });
  }

  /**
   * Reverse Voucher Pattern (صدور سند عکس / عطف / برگشت)
   * Inverts all debit and credit rows to completely neutralize the financial impact of a voucher.
   */
  static async reverseVoucher(
    paramsOrId: number | {
      voucherId: number;
      date?: string;
      reason?: string;
      userId?: number;
      username?: string;
      externalTx?: DbExecutor;
    },
    legacyOptions?: { date?: string; reason?: string; userId?: number; username?: string }
  ): Promise<JournalVoucher> {
    const params = typeof paramsOrId === 'number'
      ? { voucherId: paramsOrId, ...legacyOptions }
      : paramsOrId;

    const execute = async (tx: DbExecutor): Promise<number> => {
      // V3.0.7 (TD-061): سند اصلی باید «داخل تراکنش اجرایی» خوانده شود؛
      // خواندن قبلی با اتصال orm خارج از externalTx می‌توانست snapshot منقضی
      // (ویرایش همزمان سند) را مبنای سند معکوس قرار دهد.
      const original = await this.getJournalVoucherById(params.voucherId, tx);
      if (!original) throw new Error('سند مبدا یافت نشد');
      if (!original.items || original.items.length === 0) {
        throw new Error('سند مبدا فاقد ردیف‌های مالی برای برگشت است');
      }

      const reversalDate = params.date?.trim() || original.date;

      await this.checkFiscalPeriodOpen(reversalDate, tx);

      const nextNumber = await this.getNextVoucherNumber(tx);
      const reasonText = params.reason?.trim() ? ` (علت: ${params.reason.trim()})` : '';
      const desc = `سند برگشت/عطف سند حسابداری شماره ${original.voucherNumber}${reasonText}: ${original.description}`;

      const [voucher] = await tx.insert(journalVouchers).values({
        voucherNumber: nextNumber,
        manualVoucherNumber: '',
        date: reversalDate,
        voucherType: 'adjustment',
        status: 'approved',
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        description: desc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `REV-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      // Invert rows: debit becomes credit, credit becomes debit
      let row = 1;
      for (const item of original.items!) {
        await tx.insert(journalVoucherItems).values({
          voucherId: voucher.id,
          accountId: item.accountId,
          rowOrder: row++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName || '',
          debit: item.credit, // Inverted
          credit: item.debit, // Inverted
          currency: item.currency || 'IRR',
          exchangeRate: item.exchangeRate || 1,
          description: `برگشت ردیف ${item.rowOrder || row - 1}: ${item.description || original.description}`,
        });
      }

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
    paramsOrId: number | {
      voucherId: number;
      date?: string;
      reason: string;
      newItems: {
        accountId: number;
        detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
        detailedId?: number | null;
        detailedName?: string;
        debit: number;
        credit: number;
        currency?: string;
        exchangeRate?: number;
        description?: string;
      }[];
      newDescription?: string;
      userId?: number;
      username?: string;
    },
    legacyOptions?: {
      date?: string;
      reason: string;
      newItems: Array<{
        accountId: number;
        detailedType?: string;
        detailedId?: number | null;
        detailedName?: string;
        debit: number;
        credit: number;
        currency?: string;
        exchangeRate?: number;
        description?: string;
      }>;
      newDescription?: string;
      userId?: number;
      username?: string;
    }
  ): Promise<{ reversalVoucher: JournalVoucher; correctedVoucher: JournalVoucher; message: string }> {
    const params = (typeof paramsOrId === 'number'
      ? { voucherId: paramsOrId, ...legacyOptions }
      : paramsOrId) as {
        voucherId: number;
        date?: string;
        reason: string;
        newItems: Array<{
          accountId: number;
          detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other' | 'supplier' | string;
          detailedId?: number | null;
          detailedName?: string;
          debit: number;
          credit: number;
          currency?: string;
          exchangeRate?: number;
          description?: string;
        }>;
        newDescription?: string;
        userId?: number;
        username?: string;
      };

    if (!params.reason || !params.reason.trim()) {
      throw new Error('ثبت علت اصلاح سند الزامی است');
    }
    if (!params.newItems || params.newItems.length < 2) {
      throw new Error('سند اصلاحی باید حداقل شامل دو ردیف معتبر و تراز باشد');
    }

    const original = await this.getJournalVoucherById(params.voucherId);
    if (!original) throw new Error('سند مبدا یافت نشد');

    const result = await orm.transaction(async (tx) => {
      const correctionDate = params.date?.trim() || original.date;
      await this.checkFiscalPeriodOpen(correctionDate, tx);

      // 1. Create Reversal Voucher
      const revNumber = await this.getNextVoucherNumber(tx);
      const revDesc = `سند برگشت به علت اصلاح سند شماره ${original.voucherNumber} (${params.reason.trim()}): ${original.description}`;

      const [revVoucher] = await tx.insert(journalVouchers).values({
        voucherNumber: revNumber,
        manualVoucherNumber: '',
        date: correctionDate,
        voucherType: 'adjustment',
        status: 'approved',
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        description: revDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `REV-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      let revRow = 1;
      for (const item of original.items!) {
        await tx.insert(journalVoucherItems).values({
          voucherId: revVoucher.id,
          accountId: item.accountId,
          rowOrder: revRow++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName || '',
          debit: item.credit,
          credit: item.debit,
          currency: item.currency || 'IRR',
          exchangeRate: item.exchangeRate || 1,
          description: `برگشت ردیف ${item.rowOrder || revRow - 1}: ${item.description || original.description}`,
        });
      }

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
      if (diff.greaterThan(0.0001)) {
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
        totalDebit: sumDebit.toNumber(),
        totalCredit: sumCredit.toNumber(),
        description: corrDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `CORR-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      let corrRow = 1;
      for (const item of params.newItems) {
        await tx.insert(journalVoucherItems).values({
          voucherId: corrVoucher.id,
          accountId: item.accountId,
          rowOrder: corrRow++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName?.trim() || '',
          debit: fin(item.debit).toNumber(),
          credit: fin(item.credit).toNumber(),
          currency: item.currency || 'IRR',
          exchangeRate: Number(item.exchangeRate) || 1,
          description: item.description?.trim() || corrDesc,
        });
      }

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
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
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

    const repostDate = params.date ? params.date.trim() : getTodayJalaliDate();

    const result = await orm.transaction(async (tx) => {
      const original = await this.getJournalVoucherById(params.voucherId, tx);
      if (!original) throw new Error('سند مبدا جهت بازثبت یافت نشد');
      if (original.isDeleted === 1 || original.is_deleted === 1) throw new Error('سند مبدا حذف شده است');

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
        totalDebit: original.totalDebit,
        totalCredit: original.totalCredit,
        description: voidDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `VOID-REPOST-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      let voidRow = 1;
      for (const item of original.items || []) {
        await tx.insert(journalVoucherItems).values({
          voucherId: voidVoucher.id,
          accountId: item.accountId,
          rowOrder: voidRow++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName || '',
          debit: item.credit,
          credit: item.debit,
          currency: item.currency || 'IRR',
          exchangeRate: item.exchangeRate || 1,
          description: `ابطال ردیف ${item.rowOrder || voidRow - 1}: ${item.description || original.description}`,
        });
      }

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
      if (diff.greaterThan(0.0001)) {
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
        totalDebit: sumDebit.toNumber(),
        totalCredit: sumCredit.toNumber(),
        description: repostDesc,
        referenceModule: original.referenceModule || 'manual',
        referenceId: original.id,
        referenceNumber: `REPOST-V${original.voucherNumber}`,
        currency: original.currency || 'IRR',
        createdById: params.userId || null,
        createdByUsername: params.username || '',
      }).returning();

      let repostRow = 1;
      for (const item of params.newItems) {
        await tx.insert(journalVoucherItems).values({
          voucherId: repostedVoucher.id,
          accountId: item.accountId,
          rowOrder: repostRow++,
          detailedType: item.detailedType || 'none',
          detailedId: item.detailedId || null,
          detailedName: item.detailedName?.trim() || '',
          debit: fin(item.debit).toNumber(),
          credit: fin(item.credit).toNumber(),
          currency: item.currency || 'IRR',
          exchangeRate: Number(item.exchangeRate) || 1,
          description: item.description?.trim() || repostDesc,
        });
      }

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

      if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) > 0.01) {
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
          if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) <= 0.01) {
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
   * Set Voucher Status (draft, approved, permanent)
   */
  static async setVoucherStatus(id: number, status: 'draft' | 'approved' | 'permanent', userId?: number): Promise<JournalVoucher> {
    await orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(journalVouchers).where(eq(journalVouchers.id, id)).for('update');
      if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');
      if (existing.status === 'permanent' && status !== 'permanent') {
        throw new BusinessLogicError('اسناد دائم و قطعی‌شده قابل تغییر وضعیت به پیش‌نویس یا تایید نشده نیستند. لطفاً از گزینه «صدور سند برگشتی (ابطال سند)» یا «سند اصلاحی» استفاده فرمایید.');
      }

      await this.checkFiscalPeriodOpen(existing.date, tx);

      if (status === 'permanent') {
        if (Math.abs(Number(existing.totalDebit) - Number(existing.totalCredit)) > 0.01) {
          throw new UnbalancedVoucherError('امکان قطعی‌سازی سند نامتراز وجود ندارد');
        }
      }

      await tx.update(journalVouchers).set({
        status,
        approvedById: status === 'draft' ? null : (userId || existing.approvedById || null)
      }).where(eq(journalVouchers.id, id));
    });

    return this.getJournalVoucherById(id);
  }
}

