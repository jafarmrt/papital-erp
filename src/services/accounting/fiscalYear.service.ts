import { orm, type DbExecutor } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { inArray, sql, and, eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';
import { FiscalPeriodService } from './fiscalPeriod.service.js';
import { AccountingReportService } from './accountingReport.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { ConflictError } from '../../errors/customErrors.js';
import { normalizeDateToIso } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import type { 
  FiscalYearClosingPreview, 
  FiscalYearClosingResult, 
  FiscalClosingAccountRow, 
  JournalVoucher 
} from '../../types.js';

// V3.0.6 (BUG-03): کلید قفل Advisory برای سریال‌سازی همزمانی بستن سال مالی
const FISCAL_CLOSING_LOCK_NAMESPACE = 918273;

export class FiscalYearService {
  /**
   * Fiscal Year Closing Preview
   */
  static async getFiscalYearClosingPreview(params: {
    year?: number | string;
    closingDate?: string;
    openingDateNewYear?: string;
    externalTx?: DbExecutor;
  }): Promise<FiscalYearClosingPreview> {
    const currentYear = params.year || 1403;
    const closingDate = params.closingDate || `${currentYear}-12-29`;
    const openingDateNewYear = params.openingDateNewYear || `${Number(currentYear) + 1}-01-01`;

    const normClosingDate = normalizeDateToIso(closingDate) || closingDate;

    const trial = await AccountingReportService.getTrialBalance({
      level: 'subsidiary',
      endDate: normClosingDate
    }, params.externalTx);

    const temporaryAccounts: FiscalClosingAccountRow[] = [];
    const permanentAccounts: FiscalClosingAccountRow[] = [];

    let totalRevenues = 0;
    let totalCostOfSales = 0;
    let totalExpenses = 0;

    let totalTemporaryDebit = 0;
    let totalTemporaryCredit = 0;

    for (const r of trial) {
      const isTemporary = r.accountType === 'revenue' || r.accountType === 'cost_of_sales' || r.accountType === 'expense';
      
      if (isTemporary) {
        if (r.accountType === 'revenue') {
          const netCredit = Number(r.creditTurnover || 0) - Number(r.debitTurnover || 0);
          if (netCredit !== 0) {
            totalRevenues += netCredit;
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
            if (action === 'debit') totalTemporaryDebit += amount;
            else totalTemporaryCredit += amount;
          }
        } else if (r.accountType === 'cost_of_sales') {
          const netDebit = Number(r.debitTurnover || 0) - Number(r.creditTurnover || 0);
          if (netDebit !== 0) {
            totalCostOfSales += netDebit;
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
            if (action === 'credit') totalTemporaryCredit += amount;
            else totalTemporaryDebit += amount;
          }
        } else if (r.accountType === 'expense') {
          const netDebit = Number(r.debitTurnover || 0) - Number(r.creditTurnover || 0);
          if (netDebit !== 0) {
            totalExpenses += netDebit;
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
            if (action === 'credit') totalTemporaryCredit += amount;
            else totalTemporaryDebit += amount;
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

    const netProfit = totalRevenues - totalCostOfSales - totalExpenses;
    const isProfit = netProfit >= 0;

    const summaryVouchersPreview = [
      {
        title: '۱. سند بستن حساب‌های موقت (سود و زیانی)',
        voucherType: 'closing' as const,
        date: closingDate,
        description: `بستن حساب‌های موقت (درآمد و هزینه) به حساب خلاصه سود و زیان سال مالی ${currentYear}`,
        itemsCount: temporaryAccounts.length + 1,
        totalAmount: Math.max(totalTemporaryDebit, totalTemporaryCredit) + Math.abs(netProfit)
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
        totalAmount: permanentAccounts.reduce((s, a) => s + a.amount, 0) / 2
      },
      {
        title: '۴. سند افتتاحیه سال مالی جدید',
        voucherType: 'opening' as const,
        date: openingDateNewYear,
        description: `سند افتتاحیه سال مالی ${Number(currentYear) + 1} (انتقال مانده‌های ابتدای دوره از سال مالی قبل)`,
        itemsCount: permanentAccounts.length,
        totalAmount: permanentAccounts.reduce((s, a) => s + a.amount, 0) / 2
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
      summaryVouchersPreview
    };
  }

  /**
   * Execute Fiscal Year Closing Process
   */
  static async executeFiscalYearClosing(data: {
    year: number | string;
    closingDate: string;
    openingDateNewYear?: string;
    createOpeningVoucher?: boolean;
    userId?: number;
    username?: string;
  }): Promise<FiscalYearClosingResult> {
    const normClosingDate = normalizeDateToIso(data.closingDate) || data.closingDate;
    const normOpeningDate = normalizeDateToIso(data.openingDateNewYear || `${Number(data.year) + 1}-01-01`) || `${Number(data.year) + 1}-01-01`;

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
      `CLOSE-TEMP-${data.year}`,
      `CLOSE-PROFIT-${data.year}`,
      `CLOSING-${data.year}`,
      `OPENING-${Number(data.year) + 1}`
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
        `سال مالی ${data.year} قبلاً بسته شده است (سند شماره ${existingClosing.map(v => `#${v.id}`).join('، ')} موجود است). بستن مجدد سال مجاز نیست.`,
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
        sql`SELECT pg_try_advisory_xact_lock(${FISCAL_CLOSING_LOCK_NAMESPACE}, ${Number(data.year)}) AS acquired`
      );
      const lockRows = (lockRes as unknown as { rows?: Array<{ acquired?: boolean }> }).rows || [];
      if (!lockRows[0]?.acquired) {
        throw new ConflictError(
          `عملیات بستن سال مالی ${data.year} هم‌اکنون توسط دیگری در حال اجراست. لطفاً بعداً تلاش کنید.`,
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
          `سال مالی ${data.year} قبلاً بسته شده است (سند شماره ${existingClosingInTx.map(v => `#${v.id}`).join('، ')} موجود است). بستن مجدد سال مجاز نیست.`,
          'FISCAL_YEAR_ALREADY_CLOSED'
        );
      }

      // v7.0.49 (audit P2-5): قفل انحصاری ردیف سال در fiscal_periods — منتظر اسنادی می‌ماند که هم‌اکنون در این سال
      // ثبت می‌شوند و تا پایان این تراکنش هیچ سند تازه‌ای وارد سال نمی‌شود؛ مانده‌ها پس از این قفل محاسبه می‌شوند
      await FiscalPeriodService.lockForClosing(tx, Number(data.year));

      // C-02 & P0-05: محاسبه تراز اختتامیه و ارقام به صورت تازه در داخل تراکنش و زیر چتر قفل
      const preview = await this.getFiscalYearClosingPreview({
        year: data.year,
        closingDate: normClosingDate,
        openingDateNewYear: normOpeningDate,
        externalTx: tx
      });
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
            description: `سود ویژه سال مالی ${data.year} منتقل‌شده به خلاصه سود و زیان`
          });
        } else if (diff.lessThan(0)) {
          v1Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: diff.abs().round(4).toNumber(),
            credit: 0,
            description: `زیان ویژه سال مالی ${data.year} منتقل‌شده به خلاصه سود و زیان`
          });
        }

        if (v1Items.length >= 2) {
          const v1 = await VoucherService.createJournalVoucher({
            date: normClosingDate,
            voucherType: 'closing',
            status: 'approved',
            description: `بستن حساب‌های موقت (درآمدها، بهای تمام شده و هزینه‌ها) به حساب خلاصه سود و زیان سال مالی ${data.year}`,
            referenceModule: 'manual',
            referenceNumber: `CLOSE-TEMP-${data.year}`,
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
            description: `بستن حساب خلاصه سود و زیان سال مالی ${data.year}`
          });
          v2Items.push({
            accountId: retainedEarningsAcc.id,
            detailedType: 'other',
            detailedName: 'سود انباشته',
            debit: 0,
            credit: profitNum,
            description: `انتقال سود خالص سال مالی ${data.year} به سود انباشته سنواتی`
          });
        } else {
          const lossNum = profitFin.abs().round(4).toNumber();
          v2Items.push({
            accountId: retainedEarningsAcc.id,
            detailedType: 'other',
            detailedName: 'زیان انباشته',
            debit: lossNum,
            credit: 0,
            description: `انتقال زیان سال مالی ${data.year} به سود (زیان) انباشته سنواتی`
          });
          v2Items.push({
            accountId: summaryProfitAcc.id,
            detailedType: 'other',
            detailedName: 'خلاصه سود و زیان',
            debit: 0,
            credit: lossNum,
            description: `بستن حساب خلاصه سود و زیان سال مالی ${data.year}`
          });
        }

        const v2 = await VoucherService.createJournalVoucher({
          date: normClosingDate,
          voucherType: 'closing',
          status: 'approved',
          description: `انتقال ${profitFin.greaterThan(0) ? 'سود' : 'زیان'} خالص سال مالی ${data.year} به حساب سود (زیان) انباشته سنواتی`,
          referenceModule: 'manual',
          referenceNumber: `CLOSE-PROFIT-${data.year}`,
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
        endDate: normClosingDate
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
          description: `سند اختتامیه سال مالی ${data.year} (بستن کلیه حساب‌های ترازنامه‌ای، دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام)`,
          referenceModule: 'manual',
          referenceNumber: `CLOSING-${data.year}`,
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
          description: `ثبت افتتاحیه مانده اول دوره ${it.detailedName} در سال مالی ${Number(data.year) + 1}`
        }));

        const v4 = await VoucherService.createJournalVoucher({
          date: normOpeningDate,
          voucherType: 'opening',
          status: 'approved',
          description: `سند افتتاحیه سال مالی ${Number(data.year) + 1} (انتقال مانده‌های ابتدای دوره دارایی‌ها، بدهی‌ها و سرمایه از سال مالی ${data.year})`,
          referenceModule: 'manual',
          referenceNumber: `OPENING-${Number(data.year) + 1}`,
          userId: data.userId,
          username: data.username,
          items: v4Items
        }, tx);
        createdVouchers.push(v4);
      }

      // v7.0.49 (audit P2-5): وضعیت بسته سال در fiscal_periods (در همان تراکنش، پیش از آزاد شدن قفل)
      const closingVoucher = createdVouchers.find(v => v.referenceNumber === `CLOSING-${data.year}`)
        ?? [...createdVouchers].reverse().find(v => v.voucherType === 'closing');
      await FiscalPeriodService.markClosed(tx, Number(data.year), closingVoucher?.id ?? null, data.username);
    }); // پایان تراکنش اتمیک بستن سال

    return {
      success: true,
      message: `عملیات بستن سال مالی ${data.year} با موفقیت انجام شد و ${createdVouchers.length} سند حسابداری در سیستم ثبت گردید.`,
      year: data.year,
      netProfit: finalNetProfit,
      closingVouchers: createdVouchers
    };
  }
}

