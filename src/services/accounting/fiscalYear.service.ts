import { orm } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { inArray, sql, and, eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';
import { AccountingReportService } from './accountingReport.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { ConflictError } from '../../errors/customErrors.js';
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
  }): Promise<FiscalYearClosingPreview> {
    const currentYear = params.year || 1403;
    const closingDate = params.closingDate || `${currentYear}-12-29`;
    const openingDateNewYear = params.openingDateNewYear || `${Number(currentYear) + 1}-01-01`;

    const trial = await AccountingReportService.getTrialBalance({
      level: 'subsidiary',
      endDate: closingDate
    });

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
    const preview = await this.getFiscalYearClosingPreview({
      year: data.year,
      closingDate: data.closingDate,
      openingDateNewYear: data.openingDateNewYear
    });

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

    // V3.0.6 (BUG-03): گارد Double-Close — اگر هر یک از اسناد بستن/افتتاحیه این سال
    // قبلاً صادر شده باشد، عملیات با خطای Conflict متوقف می‌شود (idempotent execution).
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
    type VoucherItemInput = Parameters<typeof VoucherService.createJournalVoucher>[0]['items'][number];

    // V3.0.6 (BUG-03): کل فرایند بستن سال اکنون در «یک تراکنش اتمیک» اجرا می‌شود؛
    // قفل Advisory تراکنشی از اجرای همزمان دو بستن‌سال جلوگیری می‌کند و
    // خطای وسط کار (مثلاً در سند ۳ یا ۴) کل عملیات را Rollback می‌کند.
    // توجه: getTrialBalance روی اتصال جداگانه می‌خواند و فقط مانده‌های قبل از
    // بستن را می‌بیند — دقیقاً همان رفتار قبلی (وضعیت Committed قبل از شروع).
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

      // VOUCHER 1: بستن حساب‌های موقت به خلاصه سود و زیان
    if (preview.temporaryAccounts.length > 0) {
      const v1Items: VoucherItemInput[] = [];
      let debitSum = 0;
      let creditSum = 0;

      for (const t of preview.temporaryAccounts) {
        if (t.action === 'debit') {
          v1Items.push({
            accountId: t.accountId,
            detailedType: 'other',
            detailedName: t.accountName,
            debit: t.amount,
            credit: 0,
            description: `بستن حساب درآمد/فروش ${t.accountName} به خلاصه سود و زیان`
          });
          debitSum += t.amount;
        } else {
          v1Items.push({
            accountId: t.accountId,
            detailedType: 'other',
            detailedName: t.accountName,
            debit: 0,
            credit: t.amount,
            description: `بستن حساب هزینه/بهای تمام شده ${t.accountName} به خلاصه سود و زیان`
          });
          creditSum += t.amount;
        }
      }

      const diff = debitSum - creditSum;
      if (diff > 0) {
        v1Items.push({
          accountId: summaryProfitAcc.id,
          detailedType: 'other',
          detailedName: 'خلاصه سود و زیان',
          debit: 0,
          credit: diff,
          description: `سود ویژه سال مالی ${data.year} منتقل‌شده به خلاصه سود و زیان`
        });
      } else if (diff < 0) {
        v1Items.push({
          accountId: summaryProfitAcc.id,
          detailedType: 'other',
          detailedName: 'خلاصه سود و زیان',
          debit: Math.abs(diff),
          credit: 0,
          description: `زیان ویژه سال مالی ${data.year} منتقل‌شده به خلاصه سود و زیان`
        });
      }

      if (v1Items.length >= 2) {
        const v1 = await VoucherService.createJournalVoucher({
          date: data.closingDate,
          voucherType: 'closing',
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
    const profit = preview.netProfit;
    if (profit !== 0) {
      const v2Items: VoucherItemInput[] = [];
      if (profit > 0) {
        v2Items.push({
          accountId: summaryProfitAcc.id,
          detailedType: 'other',
          detailedName: 'خلاصه سود و زیان',
          debit: profit,
          credit: 0,
          description: `بستن حساب خلاصه سود و زیان سال مالی ${data.year}`
        });
        v2Items.push({
          accountId: retainedEarningsAcc.id,
          detailedType: 'other',
          detailedName: 'سود انباشته',
          debit: 0,
          credit: profit,
          description: `انتقال سود خالص سال مالی ${data.year} به سود انباشته سنواتی`
        });
      } else {
        const loss = Math.abs(profit);
        v2Items.push({
          accountId: retainedEarningsAcc.id,
          detailedType: 'other',
          detailedName: 'زیان انباشته',
          debit: loss,
          credit: 0,
          description: `انتقال زیان سال مالی ${data.year} به سود (زیان) انباشته سنواتی`
        });
        v2Items.push({
          accountId: summaryProfitAcc.id,
          detailedType: 'other',
          detailedName: 'خلاصه سود و زیان',
          debit: 0,
          credit: loss,
          description: `بستن حساب خلاصه سود و زیان سال مالی ${data.year}`
        });
      }

      const v2 = await VoucherService.createJournalVoucher({
        date: data.closingDate,
        voucherType: 'closing',
        description: `انتقال ${profit > 0 ? 'سود' : 'زیان'} خالص سال مالی ${data.year} به حساب سود (زیان) انباشته سنواتی`,
        referenceModule: 'manual',
        referenceNumber: `CLOSE-PROFIT-${data.year}`,
        userId: data.userId,
        username: data.username,
        items: v2Items
      }, tx);
      createdVouchers.push(v2);
    }

    // VOUCHER 3: سند اختتامیه حساب‌های دائمی (ترازنامه‌ای)
    const postTrial = await AccountingReportService.getTrialBalance({
      level: 'subsidiary',
      endDate: data.closingDate
    });

    const v3Items: VoucherItemInput[] = [];
    let closingDebitSum = 0;
    let closingCreditSum = 0;

    for (const r of postTrial) {
      if (r.accountType === 'asset') {
        const bal = Number(r.debitBalance || 0) - Number(r.creditBalance || 0);
        if (bal > 0) {
          v3Items.push({
            accountId: r.accountId,
            detailedType: 'other',
            detailedName: r.name,
            debit: 0,
            credit: bal,
            description: `بستن مانده بدهکار دارایی ${r.name} در سند اختتامیه`
          });
          closingCreditSum += bal;
        } else if (bal < 0) {
          v3Items.push({
            accountId: r.accountId,
            detailedType: 'other',
            detailedName: r.name,
            debit: Math.abs(bal),
            credit: 0,
            description: `بستن مانده بستانکار دارایی ${r.name} در سند اختتامیه`
          });
          closingDebitSum += Math.abs(bal);
        }
      } else if (r.accountType === 'liability' || r.accountType === 'equity') {
        const bal = Number(r.creditBalance || 0) - Number(r.debitBalance || 0);
        if (bal > 0) {
          v3Items.push({
            accountId: r.accountId,
            detailedType: 'other',
            detailedName: r.name,
            debit: bal,
            credit: 0,
            description: `بستن مانده بستانکار بدهی/حقوق صاحبان سهام ${r.name} در سند اختتامیه`
          });
          closingDebitSum += bal;
        } else if (bal < 0) {
          v3Items.push({
            accountId: r.accountId,
            detailedType: 'other',
            detailedName: r.name,
            debit: 0,
            credit: Math.abs(bal),
            description: `بستن مانده بدهکار ${r.name} در سند اختتامیه`
          });
          closingCreditSum += Math.abs(bal);
        }
      }
    }

    if (v3Items.length >= 2) {
      const v3 = await VoucherService.createJournalVoucher({
        date: data.closingDate,
        voucherType: 'closing',
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
      const newYearDate = data.openingDateNewYear || `${Number(data.year) + 1}-01-01`;
      const v4Items = v3Items.map(it => ({
        accountId: it.accountId,
        detailedType: it.detailedType,
        detailedName: it.detailedName,
        debit: it.credit,
        credit: it.debit,
        description: `ثبت افتتاحیه مانده اول دوره ${it.detailedName} در سال مالی ${Number(data.year) + 1}`
      }));

      const v4 = await VoucherService.createJournalVoucher({
        date: newYearDate,
        voucherType: 'opening',
        description: `سند افتتاحیه سال مالی ${Number(data.year) + 1} (انتقال مانده‌های ابتدای دوره دارایی‌ها، بدهی‌ها و سرمایه از سال مالی ${data.year})`,
        referenceModule: 'manual',
        referenceNumber: `OPENING-${Number(data.year) + 1}`,
        userId: data.userId,
        username: data.username,
        items: v4Items
      }, tx);
      createdVouchers.push(v4);
    }
    }); // پایان تراکنش اتمیک بستن سال

    return {
      success: true,
      message: `عملیات بستن سال مالی ${data.year} با موفقیت انجام شد و ${createdVouchers.length} سند حسابداری در سیستم ثبت گردید.`,
      year: data.year,
      netProfit: preview.netProfit,
      closingVouchers: createdVouchers
    };
  }
}
