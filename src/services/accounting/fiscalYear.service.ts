import { orm, type DbExecutor } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { inArray, sql, and, eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';
import { FiscalPeriodService } from './fiscalPeriod.service.js';
import { AccountingReportService } from './accountingReport.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { jalaliYearBounds, isoToJalaliDate, toStorageDate } from '../../utils/calendarDate.js';
import { toEnglishDigits } from '../../utils/persianNumber.js';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import type {
  FiscalYearClosingPreview,
  FiscalYearClosingResult,
  FiscalClosingAccountRow,
  FiscalClosingDraftVoucher,
  JournalVoucher
} from '../../types.js';

// V3.0.6 (BUG-03): کلید قفل Advisory برای سریال‌سازی همزمانی بستن سال مالی
const FISCAL_CLOSING_LOCK_NAMESPACE = 918273;

/** v8.0.2 (TD-252): بیشترین تعداد سند پیش‌نویس که پیش‌نمایش بستن سال فهرست می‌کند */
export const FISCAL_CLOSING_DRAFT_LIST_LIMIT = 50;

/**
 * v8.0.47 (TD-310، تصمیم مالک محصول): سال مالی همان سال شمسی است، پس سند اختتامیه همیشه به آخرین روز سال (۲۹ یا ۳۰
 * اسفند) و سند افتتاحیه به ۱ فروردین سال بعد صادر می‌شود و مانده‌ها تا آخرین روز سال حساب می‌شوند. پیش‌تر فرم بستن سال
 * ۲۹ اسفند را پیش‌فرض می‌گذاشت و هر تاریخی پذیرفته می‌شد: اسناد ۳۰ اسفند سال کبیسه (و هر سند پس از تاریخ دلخواه)
 * در بستن حساب‌ها نمی‌آمدند و سال با حساب‌های موقتِ صفرنشده بسته می‌شد. تاریخ ارسالی فقط اگر همین تاریخ‌ها باشد
 * پذیرفته می‌شود.
 */
export function resolveFiscalClosingDates(
  rawYear: unknown,
  closingDateInput?: string | null,
  openingDateInput?: string | null
): { year: number; startDate: string; closingDate: string; openingDate: string } {
  const yearText = toEnglishDigits(String(rawYear ?? '')).trim();
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
  const bounds = jalaliYearBounds(year);
  if (!bounds) {
    throw new ValidationError(`سال مالی «${String(rawYear ?? '')}» معتبر نیست؛ سال شمسی چهاررقمی مانند ۱۴۰۴ وارد کنید.`, { field: 'year' });
  }
  const mustEqual = (input: string | null | undefined, expected: string, label: string, rule: string): void => {
    if (input === undefined || input === null || String(input).trim() === '') return;
    if (toStorageDate(input) !== expected) {
      throw new ValidationError(
        `تاریخ ${label} سال مالی ${year} باید ${rule} (${isoToJalaliDate(expected)}) باشد؛ «${String(input)}» داده شد.`,
        { field: label, expected }
      );
    }
  };
  mustEqual(closingDateInput, bounds.lastDay, 'سند اختتامیه', 'آخرین روز همان سال');
  mustEqual(openingDateInput, bounds.nextFirstDay, 'سند افتتاحیه', 'نخستین روز سال بعد');
  return { year, startDate: bounds.firstDay, closingDate: bounds.lastDay, openingDate: bounds.nextFirstDay };
}

export class FiscalYearService {
  /**
   * v8.0.2 (TD-252، تصمیم مالک محصول): اسناد حسابداری پیش‌نویسِ یک سال مالی (جلالی). بستن سال روی تراز آزمایشی
   * (فقط اسناد تأییدشده و دائم) ساخته می‌شود؛ پیش‌تر اسناد پیش‌نویس — از جمله همه اسناد خودکار فروش، خرید، انبار و
   * حقوق — بی‌هشدار بیرون می‌ماندند و پس از بستن دیگر تأییدشدنی نبودند. اکنون تا وقتی چنین سندی هست بستن رد می‌شود.
   */
  static async findDraftVouchersOfYear(year: number, tx?: DbExecutor): Promise<FiscalClosingDraftVoucher[]> {
    const executor = tx || orm;
    const { startDate: startIso, openingDate: endIso } = resolveFiscalClosingDates(year);
    const rows = await executor.select({
      id: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      date: journalVouchers.date,
      totalDebit: journalVouchers.totalDebit,
      description: journalVouchers.description,
      sourceDocumentId: journalVouchers.sourceDocumentId,
    })
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.isDeleted, 0),
        eq(journalVouchers.status, 'draft'),
        // تاریخ ISO در بازه سال؛ تاریخ‌های قدیمی جلالی یا غیر ISO با yearOf همان سال سنجیده می‌شوند
        sql`((${journalVouchers.date} >= ${startIso} AND ${journalVouchers.date} < ${endIso})
             OR ${journalVouchers.date} !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
             OR ${journalVouchers.date} ~ '^1[345][0-9]{2}[-/]')`
      ))
      .orderBy(journalVouchers.date, journalVouchers.voucherNumber);
    return rows
      .filter(r => FiscalPeriodService.yearOf(r.date) === year)
      .map(r => ({
        id: r.id,
        voucherNumber: r.voucherNumber,
        date: r.date,
        totalDebit: fin(r.totalDebit).toNumber(),
        description: r.description,
        sourceDocumentId: r.sourceDocumentId ?? null,
      }));
  }

  /**
   * Fiscal Year Closing Preview
   */
  static async getFiscalYearClosingPreview(params: {
    year?: number | string;
    closingDate?: string;
    openingDateNewYear?: string;
    externalTx?: DbExecutor;
  }): Promise<FiscalYearClosingPreview> {
    const { year: currentYear, closingDate, openingDate: openingDateNewYear } =
      resolveFiscalClosingDates(params.year, params.closingDate, params.openingDateNewYear);

    const normClosingDate = closingDate;
    const draftVouchers = await this.findDraftVouchersOfYear(currentYear, params.externalTx);

    // v9.0.120 (TD-545): بستن سال مانده واقعی دفتر را می‌خواهد، پس اسناد اختتامیه (و برگشت آن‌ها پس از بازگشایی) هم شمرده می‌شوند
    const trial = await AccountingReportService.getTrialBalance({
      level: 'subsidiary',
      endDate: normClosingDate,
      includeClosing: true,
    }, params.externalTx);

    const temporaryAccounts: FiscalClosingAccountRow[] = [];
    const permanentAccounts: FiscalClosingAccountRow[] = [];

    // v7.0.71 (P2-6 بخش ۳): جمع‌ها با Decimal؛ سود خالص پیش‌نمایش مستقیم در سند بستن حساب‌ها استفاده می‌شود
    let totalRevenuesDec = fin(0);
    let totalCostOfSalesDec = fin(0);
    let totalExpensesDec = fin(0);

    let totalTemporaryDebitDec = fin(0);
    let totalTemporaryCreditDec = fin(0);

    for (const r of trial) {
      const isTemporary = r.accountType === 'revenue' || r.accountType === 'cost_of_sales' || r.accountType === 'expense';
      
      if (isTemporary) {
        if (r.accountType === 'revenue') {
          const netCredit = Number(r.creditTurnover || 0) - Number(r.debitTurnover || 0);
          if (netCredit !== 0) {
            totalRevenuesDec = totalRevenuesDec.add(netCredit);
            const action = netCredit > 0 ? 'debit' : 'credit';
            const amount = Math.abs(netCredit);
            temporaryAccounts.push({
              accountId: r.accountId,
              accountCode: r.code,
              accountName: r.name,
              accountType: r.accountType,
              balance: netCredit,
              action,
              amount
            });
            if (action === 'debit') totalTemporaryDebitDec = totalTemporaryDebitDec.add(amount);
            else totalTemporaryCreditDec = totalTemporaryCreditDec.add(amount);
          }
        } else if (r.accountType === 'cost_of_sales') {
          const netDebit = Number(r.debitTurnover || 0) - Number(r.creditTurnover || 0);
          if (netDebit !== 0) {
            totalCostOfSalesDec = totalCostOfSalesDec.add(netDebit);
            const action = netDebit > 0 ? 'credit' : 'debit';
            const amount = Math.abs(netDebit);
            temporaryAccounts.push({
              accountId: r.accountId,
              accountCode: r.code,
              accountName: r.name,
              accountType: r.accountType,
              balance: netDebit,
              action,
              amount
            });
            if (action === 'credit') totalTemporaryCreditDec = totalTemporaryCreditDec.add(amount);
            else totalTemporaryDebitDec = totalTemporaryDebitDec.add(amount);
          }
        } else if (r.accountType === 'expense') {
          const netDebit = Number(r.debitTurnover || 0) - Number(r.creditTurnover || 0);
          if (netDebit !== 0) {
            totalExpensesDec = totalExpensesDec.add(netDebit);
            const action = netDebit > 0 ? 'credit' : 'debit';
            const amount = Math.abs(netDebit);
            temporaryAccounts.push({
              accountId: r.accountId,
              accountCode: r.code,
              accountName: r.name,
              accountType: r.accountType,
              balance: netDebit,
              action,
              amount
            });
            if (action === 'credit') totalTemporaryCreditDec = totalTemporaryCreditDec.add(amount);
            else totalTemporaryDebitDec = totalTemporaryDebitDec.add(amount);
          }
        }
      } else {
        if (r.accountType === 'asset') {
          const bal = Number(r.debitBalance || 0) - Number(r.creditBalance || 0);
          if (bal !== 0) {
            permanentAccounts.push({
              accountId: r.accountId,
              accountCode: r.code,
              accountName: r.name,
              accountType: r.accountType,
              balance: bal,
              action: bal > 0 ? 'credit' : 'debit',
              amount: Math.abs(bal)
            });
          }
        } else if (r.accountType === 'liability' || r.accountType === 'equity') {
          const bal = Number(r.creditBalance || 0) - Number(r.debitBalance || 0);
          if (bal !== 0) {
            permanentAccounts.push({
              accountId: r.accountId,
              accountCode: r.code,
              accountName: r.name,
              accountType: r.accountType,
              balance: bal,
              action: bal > 0 ? 'debit' : 'credit',
              amount: Math.abs(bal)
            });
          }
        }
      }
    }

    const totalRevenues = totalRevenuesDec.toNumber();
    const totalCostOfSales = totalCostOfSalesDec.toNumber();
    const totalExpenses = totalExpensesDec.toNumber();
    const totalTemporaryDebit = totalTemporaryDebitDec.toNumber();
    const totalTemporaryCredit = totalTemporaryCreditDec.toNumber();
    const netProfit = totalRevenuesDec.subtract(totalCostOfSalesDec).subtract(totalExpensesDec).toNumber();
    const isProfit = netProfit >= 0;

    const summaryVouchersPreview = [
      {
        title: '۱. سند بستن حساب‌های موقت (سود و زیانی)',
        voucherType: 'closing' as const,
        date: closingDate,
        description: `بستن حساب‌های موقت (درآمد و هزینه) به حساب خلاصه سود و زیان سال مالی ${currentYear}`,
        itemsCount: temporaryAccounts.length + 1,
        totalAmount: fin(Math.max(totalTemporaryDebit, totalTemporaryCredit)).add(Math.abs(netProfit)).toNumber()
      },
      {
        title: '۲. سند انتقال سود/زیان سال جاری به سود انباشته',
        voucherType: 'closing' as const,
        date: closingDate,
        description: `انتقال ${isProfit ? 'سود' : 'زیان'} ویژه سال مالی ${currentYear} از حساب خلاصه سود و زیان به حساب سود (زیان) انباشته سنواتی`,
        itemsCount: 2,
        totalAmount: Math.abs(netProfit)
      },
      {
        title: '۳. سند اختتامیه حساب‌های دائمی (ترازنامه‌ای)',
        voucherType: 'closing' as const,
        date: closingDate,
        description: `سند اختتامیه و بستن حساب‌های ترازنامه‌ای (دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام) در پایان سال مالی ${currentYear}`,
        itemsCount: permanentAccounts.length,
        totalAmount: FinancialMath.sum(permanentAccounts.map(a => a.amount)).divide(2).toNumber()
      },
      {
        title: '۴. سند افتتاحیه سال مالی جدید',
        voucherType: 'opening' as const,
        date: openingDateNewYear,
        description: `سند افتتاحیه سال مالی ${Number(currentYear) + 1} (انتقال مانده‌های ابتدای دوره از سال مالی قبل)`,
        itemsCount: permanentAccounts.length,
        totalAmount: FinancialMath.sum(permanentAccounts.map(a => a.amount)).divide(2).toNumber()
      }
    ];

    return {
      year: currentYear,
      closingDate,
      openingDateNewYear,
      totalRevenues,
      totalRevenue: totalRevenues,
      totalCostOfSales,
      totalExpenses,
      totalTemporaryDebit,
      totalTemporaryCredit,
      netProfit,
      isProfit,
      temporaryAccounts,
      permanentAccounts,
      summary: {
        totalRevenue: totalRevenues,
        totalExpenses: totalExpenses + totalCostOfSales,
        totalCostOfSales,
        netProfit,
        isProfit,
        temporaryCount: temporaryAccounts.length,
        permanentCount: permanentAccounts.length
      },
      summaryVouchersPreview,
      draftVouchers: draftVouchers.slice(0, FISCAL_CLOSING_DRAFT_LIST_LIMIT),
      draftVoucherCount: draftVouchers.length,
    };
  }

  /**
   * Execute Fiscal Year Closing Process
   */
  static async executeFiscalYearClosing(data: {
    year: number | string;
    closingDate?: string;
    openingDateNewYear?: string;
    createOpeningVoucher?: boolean;
    userId?: number;
    username?: string;
  }): Promise<FiscalYearClosingResult> {
    // v8.0.47 (TD-310): تاریخ‌ها همیشه آخرین روز سال و ۱ فروردین سال بعد؛ تاریخ دیگر رد می‌شود
    const { year, closingDate: normClosingDate, openingDate: normOpeningDate } =
      resolveFiscalClosingDates(data.year, data.closingDate, data.openingDateNewYear);

    // Conceptual Account Resolution (Subphase 9.2: Summary Profit/Loss and Retained Earnings)
    let summaryProfitAcc = await AccountMappingService.getSummaryProfitLossAccount();
    if (!summaryProfitAcc) {
      summaryProfitAcc = await ChartOfAccountsService.createAccount({
        code: '4301',
        name: 'خلاصه سود و زیان سال جاری',
        level: 'subsidiary',
        accountType: 'equity',
        nature: 'both',
        description: 'حساب واسط بستن حساب‌های درآمد و هزینه'
      });
    }

    let retainedEarningsAcc = await AccountMappingService.getRetainedEarningsAccount();
    if (!retainedEarningsAcc) {
      retainedEarningsAcc = await ChartOfAccountsService.createAccount({
        code: '4201',
        name: 'سود (زیان) انباشته سنواتی',
        level: 'subsidiary',
        accountType: 'equity',
        nature: 'credit',
        description: 'سود یا زیان انباشته سنوات قبل و جاری'
      });
    }

    // V3.0.6 (BUG-03): گارد Double-Close اولیه
    const closingRefNumbers = [
      `CLOSE-TEMP-${year}`,
      `CLOSE-PROFIT-${year}`,
      `CLOSING-${year}`,
      `OPENING-${year + 1}`
    ];
    const existingClosing = await orm
      .select({ id: journalVouchers.id, referenceNumber: journalVouchers.referenceNumber })
      .from(journalVouchers)
      .where(and(
        inArray(journalVouchers.referenceNumber, closingRefNumbers),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existingClosing.length > 0) {
      throw new ConflictError(
        `سال مالی ${year} قبلاً بسته شده است (سند شماره ${existingClosing.map(v => `#${v.id}`).join('، ')} موجود است). بستن مجدد سال مجاز نیست.`,
        'FISCAL_YEAR_ALREADY_CLOSED'
      );
    }

    const createdVouchers: JournalVoucher[] = [];
    let finalNetProfit = 0;
    type VoucherItemInput = Parameters<typeof VoucherService.createJournalVoucher>[0]['items'][number];

    // V6.0.3 (TD-141 & C-02): کل فرایند بستن سال در یک تراکنش اتمیک با قفل Advisory تراکنشی اجرا می‌شود؛
    // پیش‌نمایش و تراز آزمایشی منحصراً درون تراکنش (tx) و پس از اخذ قفل محاسبه می‌شوند.
    await orm.transaction(async (tx) => {
      const lockRes = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${FISCAL_CLOSING_LOCK_NAMESPACE}, ${year}) AS acquired`
      );
      const lockRows = (lockRes as unknown as { rows?: Array<{ acquired?: boolean }> }).rows || [];
      if (!lockRows[0]?.acquired) {
        throw new ConflictError(
          `عملیات بستن سال مالی ${year} هم‌اکنون توسط دیگری در حال اجراست. لطفاً بعداً تلاش کنید.`,
          'FISCAL_CLOSING_LOCKED'
        );
      }

      // C-02 & P0-05: اعتبارسنجی مجدد و قطعی عدم بسته‌شدن سال مالی بلافاصله پس از اخذ قفل Advisory در همان تراکنش
      const existingClosingInTx = await tx
        .select({ id: journalVouchers.id, referenceNumber: journalVouchers.referenceNumber })
        .from(journalVouchers)
        .where(and(
          inArray(journalVouchers.referenceNumber, closingRefNumbers),
          eq(journalVouchers.isDeleted, 0)
        ));
      if (existingClosingInTx.length > 0) {
        throw new ConflictError(
          `سال مالی ${year} قبلاً بسته شده است (سند شماره ${existingClosingInTx.map(v => `#${v.id}`).join('، ')} موجود است). بستن مجدد سال مجاز نیست.`,
          'FISCAL_YEAR_ALREADY_CLOSED'
        );
      }

      // v7.0.49 (audit P2-5): قفل انحصاری ردیف سال در fiscal_periods — منتظر اسنادی می‌ماند که هم‌اکنون در این سال
      // ثبت می‌شوند و تا پایان این تراکنش هیچ سند تازه‌ای وارد سال نمی‌شود؛ مانده‌ها پس از این قفل محاسبه می‌شوند
      await FiscalPeriodService.lockForClosing(tx, year);

      // C-02 & P0-05: محاسبه تراز اختتامیه و ارقام به صورت تازه در داخل تراکنش و زیر چتر قفل
      const preview = await this.getFiscalYearClosingPreview({
        year,
        closingDate: normClosingDate,
        openingDateNewYear: normOpeningDate,
        externalTx: tx
      });

      // v8.0.2 (TD-252، تصمیم مالک محصول): سال با سند حسابداری پیش‌نویس بسته نمی‌شود — پس از قفل سال، پس هیچ سند
      // تازه‌ای در این فاصله وارد سال نمی‌شود
      const draftCount = preview.draftVoucherCount ?? 0;
      if (draftCount > 0) {
        const shown = (preview.draftVouchers ?? []).slice(0, 10).map(v => `#${v.voucherNumber}`).join('، ');
        throw new ConflictError(
          `سال مالی ${year} ${draftCount} سند حسابداری پیش‌نویس دارد (${shown}${draftCount > 10 ? ' و …' : ''}). ` +
          'پیش از بستن سال، این اسناد را تأیید یا حذف کنید؛ سند پیش‌نویس در بستن حساب‌ها شمرده نمی‌شود و پس از بستن سال دیگر تأییدشدنی نیست.',
          'FISCAL_YEAR_HAS_DRAFT_VOUCHERS'
        );
      }
      finalNetProfit = preview.netProfit;

      // VOUCHER 1: بستن حساب‌های موقت به خلاصه سود و زیان
      if (preview.temporaryAccounts.length > 0) {
        const v1Items: VoucherItemInput[] = [];
        let debitSum = fin(0);
        let creditSum = fin(0);

        for (const t of preview.temporaryAccounts) {
          const itemAmt = fin(t.amount);
          if (t.action === 'debit') {
            v1Items.push({
              accountId: t.accountId,
              detailedType: 'other',
              detailedName: t.accountName,
              debit: itemAmt.toNumber(),
              credit: 0,
              description: `بستن حساب درآمد/فروش ${t.accountName} به خلاصه سود و زیان`
            });
            debitSum = debitSum.add(itemAmt);
          } else {
            v1Items.push({
              accountId: t.accountId,
              detailedType: 'other',
              detailedName: t.accountName,
              debit: 0,
              credit: itemAmt.toNumber(),
              description: `بستن حساب هزینه/بهای تمام شده ${t.accountName} به خلاصه سود و زیان`
            });
            creditSum = creditSum.add(itemAmt);
          }
        }

        const diff = debitSum.subtract(creditSum);
        if (diff.greaterThan(0)) {
          v1Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: 0,
            credit: diff.round(4).toNumber(),
            description: `سود ویژه سال مالی ${year} منتقل‌شده به خلاصه سود و زیان`
          });
        } else if (diff.lessThan(0)) {
          v1Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: diff.abs().round(4).toNumber(),
            credit: 0,
            description: `زیان ویژه سال مالی ${year} منتقل‌شده به خلاصه سود و زیان`
          });
        }

        if (v1Items.length >= 2) {
          const v1 = await VoucherService.createJournalVoucher({
            date: normClosingDate,
            voucherType: 'closing',
            status: 'approved',
            description: `بستن حساب‌های موقت (درآمدها، بهای تمام شده و هزینه‌ها) به حساب خلاصه سود و زیان سال مالی ${year}`,
            referenceModule: 'manual',
            referenceNumber: `CLOSE-TEMP-${year}`,
            sourceFiscalYear: year,
            userId: data.userId,
            username: data.username,
            items: v1Items
          }, tx);
          createdVouchers.push(v1);
        }
      }

      // VOUCHER 2: انتقال سود/زیان سال از خلاصه به سود انباشته
      const profitFin = fin(preview.netProfit);
      if (!profitFin.isZero()) {
        const v2Items: VoucherItemInput[] = [];
        if (profitFin.greaterThan(0)) {
          const profitNum = profitFin.round(4).toNumber();
          v2Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: profitNum,
            credit: 0,
            description: `بستن حساب خلاصه سود و زیان سال مالی ${year}`
          });
          v2Items.push({
            accountId: retainedEarningsAcc.id,
            detailedType: 'other',
            detailedName: 'سود انباشته',
            debit: 0,
            credit: profitNum,
            description: `انتقال سود خالص سال مالی ${year} به سود انباشته سنواتی`
          });
        } else {
          const lossNum = profitFin.abs().round(4).toNumber();
          v2Items.push({
            accountId: retainedEarningsAcc.id,
            detailedType: 'other',
            detailedName: 'زیان انباشته',
            debit: lossNum,
            credit: 0,
            description: `انتقال زیان سال مالی ${year} به سود (زیان) انباشته سنواتی`
          });
          v2Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: 0,
            credit: lossNum,
            description: `بستن حساب خلاصه سود و زیان سال مالی ${year}`
          });
        }

        const v2 = await VoucherService.createJournalVoucher({
          date: normClosingDate,
          voucherType: 'closing',
          status: 'approved',
          description: `انتقال ${profitFin.greaterThan(0) ? 'سود' : 'زیان'} خالص سال مالی ${year} به حساب سود (زیان) انباشته سنواتی`,
          referenceModule: 'manual',
          referenceNumber: `CLOSE-PROFIT-${year}`,
          sourceFiscalYear: year,
          userId: data.userId,
          username: data.username,
          items: v2Items
        }, tx);
        createdVouchers.push(v2);
      }

      // VOUCHER 3: سند اختتامیه حساب‌های دائمی (ترازنامه‌ای)
      // V6.0.3 (TD-141): ارسال tx جهت خواندن مانده‌های به‌روزرسانی شده سود انباشته داخل همین تراکنش
      const postTrial = await AccountingReportService.getTrialBalance({
        level: 'subsidiary',
        endDate: normClosingDate,
        includeClosing: true,
      }, tx);

      const v3Items: VoucherItemInput[] = [];
      let closingDebitSum = fin(0);
      let closingCreditSum = fin(0);

      for (const r of postTrial) {
        if (r.accountType === 'asset') {
          const bal = fin(r.debitBalance || 0).subtract(r.creditBalance || 0);
          if (bal.greaterThan(0)) {
            v3Items.push({
              accountId: r.accountId,
              detailedType: 'other',
              detailedName: r.name,
              debit: 0,
              credit: bal.round(4).toNumber(),
              description: `بستن مانده بدهکار دارایی ${r.name} در سند اختتامیه`
            });
            closingCreditSum = closingCreditSum.add(bal);
          } else if (bal.lessThan(0)) {
            const absBal = bal.abs();
            v3Items.push({
              accountId: r.accountId,
              detailedType: 'other',
              detailedName: r.name,
              debit: absBal.round(4).toNumber(),
              credit: 0,
              description: `بستن مانده بستانکار دارایی ${r.name} در سند اختتامیه`
            });
            closingDebitSum = closingDebitSum.add(absBal);
          }
        } else if (r.accountType === 'liability' || r.accountType === 'equity') {
          const bal = fin(r.creditBalance || 0).subtract(r.debitBalance || 0);
          if (bal.greaterThan(0)) {
            v3Items.push({
              accountId: r.accountId,
              detailedType: 'other',
              detailedName: r.name,
              debit: bal.round(4).toNumber(),
              credit: 0,
              description: `بستن مانده بستانکار بدهی/حقوق صاحبان سهام ${r.name} در سند اختتامیه`
            });
            closingDebitSum = closingDebitSum.add(bal);
          } else if (bal.lessThan(0)) {
            const absBal = bal.abs();
            v3Items.push({
              accountId: r.accountId,
              detailedType: 'other',
              detailedName: r.name,
              debit: 0,
              credit: absBal.round(4).toNumber(),
              description: `بستن مانده بدهکار ${r.name} در سند اختتامیه`
            });
            closingCreditSum = closingCreditSum.add(absBal);
          }
        }
      }

      if (v3Items.length >= 2) {
        const v3 = await VoucherService.createJournalVoucher({
          date: normClosingDate,
          voucherType: 'closing',
          status: 'approved',
          description: `سند اختتامیه سال مالی ${year} (بستن کلیه حساب‌های ترازنامه‌ای، دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام)`,
          referenceModule: 'manual',
          referenceNumber: `CLOSING-${year}`,
          sourceFiscalYear: year,
          userId: data.userId,
          username: data.username,
          items: v3Items
        }, tx);
        createdVouchers.push(v3);
      }

      // VOUCHER 4: سند افتتاحیه سال مالی جدید (معکوس اختتامیه)
      if (data.createOpeningVoucher !== false && v3Items.length >= 2) {
        const v4Items = v3Items.map(it => ({
          accountId: it.accountId,
          detailedType: it.detailedType,
          detailedName: it.detailedName,
          debit: it.credit,
          credit: it.debit,
          description: `ثبت افتتاحیه مانده اول دوره ${it.detailedName} در سال مالی ${year + 1}`
        }));

        const v4 = await VoucherService.createJournalVoucher({
          date: normOpeningDate,
          voucherType: 'opening',
          status: 'approved',
          description: `سند افتتاحیه سال مالی ${year + 1} (انتقال مانده‌های ابتدای دوره دارایی‌ها، بدهی‌ها و سرمایه از سال مالی ${year})`,
          referenceModule: 'manual',
          referenceNumber: `OPENING-${year + 1}`,
          sourceFiscalYear: year,
          userId: data.userId,
          username: data.username,
          items: v4Items
        }, tx);
        createdVouchers.push(v4);
      }

      // v7.0.49 (audit P2-5): وضعیت بسته سال در fiscal_periods (در همان تراکنش، پیش از آزاد شدن قفل)
      const closingVoucher = createdVouchers.find(v => v.referenceNumber === `CLOSING-${year}`)
        ?? [...createdVouchers].reverse().find(v => v.voucherType === 'closing');
      await FiscalPeriodService.markClosed(tx, year, closingVoucher?.id ?? null, data.username);
    }); // پایان تراکنش اتمیک بستن سال

    return {
      success: true,
      message: `عملیات بستن سال مالی ${year} با موفقیت انجام شد و ${createdVouchers.length} سند حسابداری در سیستم ثبت گردید.`,
      year,
      netProfit: finalNetProfit,
      closingVouchers: createdVouchers
    };
  }
}

