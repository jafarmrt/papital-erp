import { orm, type DbExecutor } from '../../db/drizzle.js';
import { accounts, journalVouchers, journalVoucherItems, cheques, bankAccounts, treasuryTransactions, customers, personnel } from '../../db/schema.js';
import { eq, asc, and, or, sql, like, gte, lte, lt, SQL } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { TreasuryService } from './treasury.service.js';
import { normalizeDateToIso } from '../../lib/businessClock.js';
import { fin, FinancialMath, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { 
  TrialBalanceRow, 
  FinancialSummaryStats, 
  FinancialRatiosReport, 
  CurrencyFinancialSummary, 
  Account,
  DetailedPartyLedgerResult,
  DetailedPartyLedgerItem,
  PartyOption
} from '../../types.js';

export class AccountingReportService {
  /**
   * Trial Balance (تراز آزمایشی ۲، ۴، ۶ و ۸ ستونی در هر ۴ سطح: گروه، کل، معین، تفصیلی و درختی جامع با پشتیبانی از فیلتر ارز و تراکنش ایزوله)
   */
  static async getTrialBalance(params: {
    level?: 'group' | 'general' | 'subsidiary' | 'detailed' | 'all' | 'tree';
    startDate?: string;
    endDate?: string;
    currency?: string;
  }, tx?: DbExecutor): Promise<TrialBalanceRow[]> {
    const executor = tx || orm;
    const targetLevel = params.level || 'all';

    // Base conditions for approved or permanent journal vouchers
    const baseConditions = [
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ];

    // v7.0.71 (P2-6 / TD-210 بخش ۳): جمع گردش‌ها در PostgreSQL با numeric دقیق، نه جمع double در JS.
    // گروه‌بندی بر اساس حساب، تفصیلی، ارز و متن تاریخ است؛ تاریخ‌های قدیمی (شمسی یا قالب‌های دیگر) همچنان با
    // normalizeDateToIso در JS دسته‌بندی می‌شوند، پس فقط جمع‌های هر روز به Decimal منتقل می‌شوند.
    const itemCurrencyExpr = sql<string>`UPPER(COALESCE(NULLIF(${journalVoucherItems.currency}, ''), NULLIF(${journalVouchers.currency}, ''), 'IRR'))`;
    const rateExpr = sql`COALESCE(NULLIF(${journalVoucherItems.exchangeRate}, 0), 1)`;
    const groupedItems = await executor.select({
      voucherDate: journalVouchers.date,
      itemCurrency: itemCurrencyExpr,
      accountId: journalVoucherItems.accountId,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      detailedName: journalVoucherItems.detailedName,
      debit: sql<string>`COALESCE(SUM(${journalVoucherItems.debit}), 0)::text`,
      credit: sql<string>`COALESCE(SUM(${journalVoucherItems.credit}), 0)::text`,
      debitIrr: sql<string>`COALESCE(SUM(ROUND(${journalVoucherItems.debit} * ${rateExpr}, 0)), 0)::text`,
      creditIrr: sql<string>`COALESCE(SUM(ROUND(${journalVoucherItems.credit} * ${rateExpr}, 0)), 0)::text`,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(...baseConditions))
    .groupBy(
      journalVouchers.date, itemCurrencyExpr, journalVoucherItems.accountId,
      journalVoucherItems.detailedType, journalVoucherItems.detailedId, journalVoucherItems.detailedName
    );

    interface TurnoverAccumulator {
      initialDebit: FinancialDecimal;
      initialCredit: FinancialDecimal;
      periodDebit: FinancialDecimal;
      periodCredit: FinancialDecimal;
    }
    const emptyTurnover = (): TurnoverAccumulator => ({ initialDebit: fin(0), initialCredit: fin(0), periodDebit: fin(0), periodCredit: fin(0) });
    const addTurnover = (acc: TurnoverAccumulator, isBeforeStart: boolean, d: FinancialDecimal, c: FinancialDecimal) => {
      if (isBeforeStart) {
        acc.initialDebit = acc.initialDebit.add(d);
        acc.initialCredit = acc.initialCredit.add(c);
      } else {
        acc.periodDebit = acc.periodDebit.add(d);
        acc.periodCredit = acc.periodCredit.add(c);
      }
    };

    // AccountId => turnover
    const accountTurnover = new Map<number, TurnoverAccumulator>();

    // Detailed entities map: key = `${accountId}__${detailedName || 'عام'}`
    interface DetailedAccumulator extends TurnoverAccumulator {
      accountId: number;
      detailedType?: string;
      detailedId?: number | null;
      detailedName: string;
    }
    const detailedMap = new Map<string, DetailedAccumulator>();

    // V6.0.3 (TD-142): نرمال‌سازی تاریخ‌های فیلتر به استاندارد ISO جهت پرهیز از عدم تطابق تقویم شمسی/میلادی
    const normStartDate = normalizeDateToIso(params.startDate);
    const normEndDate = normalizeDateToIso(params.endDate);
    const isBaseView = !params.currency || params.currency === 'all';

    for (const it of groupedItems) {
      const itemCur = it.itemCurrency;

      // Currency filtering if specified
      if (!isBaseView && itemCur !== params.currency!.toUpperCase()) {
        continue;
      }

      // V6.0.21: If viewing all currencies (consolidated view), convert foreign currencies to base IRR using exchange rate
      const convert = isBaseView && itemCur !== 'IRR';
      const d = fin(convert ? it.debitIrr : it.debit);
      const c = fin(convert ? it.creditIrr : it.credit);

      const accId = it.accountId;
      const vDate = normalizeDateToIso(it.voucherDate) || String(it.voucherDate || '').slice(0, 10);

      const isBeforeStart = normStartDate ? vDate < normStartDate : false;
      const isAfterEnd = normEndDate ? vDate > normEndDate : false;

      if (isAfterEnd) {
        continue; // Skip transactions beyond end date
      }

      let accTurnover = accountTurnover.get(accId);
      if (!accTurnover) {
        accTurnover = emptyTurnover();
        accountTurnover.set(accId, accTurnover);
      }
      addTurnover(accTurnover, isBeforeStart, d, c);

      // Detailed Tracking
      const dName = (it.detailedName && it.detailedName.trim()) ? it.detailedName.trim() : 'سایر / عمومی';
      const dKey = `${accId}__${dName}`;
      let det = detailedMap.get(dKey);
      if (!det) {
        det = {
          accountId: accId,
          detailedType: it.detailedType || 'other',
          detailedId: it.detailedId,
          detailedName: dName,
          ...emptyTurnover(),
        };
        detailedMap.set(dKey, det);
      }
      addTurnover(det, isBeforeStart, d, c);
    }

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    const accMap = new Map(allAccs.map(a => [a.id, a]));

    // Aggregate from subsidiary up to general and group accounts
    const aggTurnover = new Map<number, TurnoverAccumulator>();
    for (const [accId, turnover] of accountTurnover.entries()) {
      let cur = accMap.get(accId);
      while (cur) {
        let agg = aggTurnover.get(cur.id);
        if (!agg) {
          agg = emptyTurnover();
          aggTurnover.set(cur.id, agg);
        }
        addTurnover(agg, true, turnover.initialDebit, turnover.initialCredit);
        addTurnover(agg, false, turnover.periodDebit, turnover.periodCredit);
        cur = cur.parentId ? accMap.get(cur.parentId) : undefined;
      }
    }

    // ستون‌های مانده از جمع‌های Decimal؛ خروجی (TrialBalanceRow) عدد است
    const balanceColumns = (t: TurnoverAccumulator) => {
      const totD = t.initialDebit.add(t.periodDebit);
      const totC = t.initialCredit.add(t.periodCredit);
      const diff = totD.subtract(totC);
      const initDiff = t.initialDebit.subtract(t.initialCredit);
      const debitBalance = diff.isPositive() ? diff.toNumber() : 0;
      const creditBalance = diff.isNegative() ? diff.abs().toNumber() : 0;
      return {
        initialDebit: initDiff.isPositive() ? initDiff.toNumber() : 0,
        initialCredit: initDiff.isNegative() ? initDiff.abs().toNumber() : 0,
        debitTurnover: t.periodDebit.toNumber(),
        creditTurnover: t.periodCredit.toNumber(),
        totalDebit: totD.toNumber(),
        totalCredit: totC.toNumber(),
        debitBalance,
        creditBalance,
        preClosingDebit: debitBalance,
        preClosingCredit: creditBalance,
      };
    };

    // Build standard account rows
    const buildRow = (acc: Account): TrialBalanceRow => ({
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      level: acc.level,
      parentId: acc.parentId,
      accountType: acc.accountType,
      nature: acc.nature,
      ...balanceColumns(aggTurnover.get(acc.id) ?? emptyTurnover()),
    });

    // If level is single level
    if (targetLevel === 'group' || targetLevel === 'general' || targetLevel === 'subsidiary') {
      return allAccs.filter(a => a.level === targetLevel).map(buildRow);
    }

    // If level is detailed
    if (targetLevel === 'detailed') {
      const detailedRows: TrialBalanceRow[] = [];
      for (const det of detailedMap.values()) {
        const parentAcc = accMap.get(det.accountId);
        detailedRows.push({
          accountId: det.accountId,
          code: `${parentAcc?.code || '0000'}-${det.detailedId || 'D'}`,
          name: `${det.detailedName} (${parentAcc?.name || 'حساب معین'})`,
          level: 'detailed',
          parentId: det.accountId,
          accountType: parentAcc?.accountType || 'asset',
          nature: parentAcc?.nature || 'debit',
          ...balanceColumns(det),
        });
      }
      return detailedRows.sort((a, b) => a.code.localeCompare(b.code));
    }

    // For 'all' or 'tree': Include all 4 levels (Group, General, Subsidiary, Detailed)
    const resultRows: TrialBalanceRow[] = [];
    const groups = allAccs.filter(a => a.level === 'group');

    for (const grp of groups) {
      resultRows.push(buildRow(grp));
      const generals = allAccs.filter(a => a.level === 'general' && a.parentId === grp.id);

      for (const gen of generals) {
        resultRows.push(buildRow(gen));
        const subsidiaries = allAccs.filter(a => a.level === 'subsidiary' && a.parentId === gen.id);

        for (const sub of subsidiaries) {
          resultRows.push(buildRow(sub));

          // Find detailed entries under this subsidiary account
          const dets = Array.from(detailedMap.values()).filter(d => d.accountId === sub.id);
          for (const det of dets) {
            resultRows.push({
              accountId: det.accountId,
              code: `${sub.code}-${det.detailedId || 'D'}`,
              name: `↳ ${det.detailedName}`,
              level: 'detailed',
              parentId: sub.id,
              accountType: sub.accountType,
              nature: sub.nature,
              ...balanceColumns(det),
            });
          }
        }
      }
    }

    return resultRows;
  }

  /**
   * General Journal Book (دفتر روزنامه استاندارد حسابداری با پشتیبانی از ارز)
   */
  static async getJournalBook(params: {
    startDate?: string;
    endDate?: string;
    search?: string;
    currency?: string;
  }): Promise<{
    items: {
      rowNumber: number;
      voucherId: number;
      voucherNumber: number;
      manualVoucherNumber?: string;
      date: string;
      voucherType: string;
      accountCode: string;
      accountName: string;
      accountLevel: string;
      detailedName?: string;
      detailedType?: string;
      currency?: string;
      description: string;
      debit: number;
      credit: number;
      runningBalance: number;
    }[];
    totalDebit: number;
    totalCredit: number;
    vouchersCount: number;
    isBalanced: boolean;
  }> {
    const conditions = [
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ];

    if (params.startDate) {
      conditions.push(gte(journalVouchers.date, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(journalVouchers.date, params.endDate));
    }
    if (params.currency && params.currency !== 'all') {
      conditions.push(or(
        eq(journalVoucherItems.currency, params.currency),
        eq(journalVouchers.currency, params.currency)
      ));
    }

    const rawRows = await orm.select({
      voucherId: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      manualVoucherNumber: journalVouchers.manualVoucherNumber,
      voucherCurrency: journalVouchers.currency,
      itemCurrency: journalVoucherItems.currency,
      date: journalVouchers.date,
      voucherType: journalVouchers.voucherType,
      voucherDescription: journalVouchers.description,
      itemDescription: journalVoucherItems.description,
      accountCode: accounts.code,
      accountName: accounts.name,
      accountLevel: accounts.level,
      detailedName: journalVoucherItems.detailedName,
      detailedType: journalVoucherItems.detailedType,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      rowOrder: journalVoucherItems.rowOrder,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(...conditions))
    .orderBy(asc(journalVouchers.date), asc(journalVouchers.voucherNumber), asc(journalVoucherItems.rowOrder));

    // v7.0.71 (P2-6 بخش ۳): جمع‌ها و مانده جاری با Decimal
    let runningDec = fin(0);
    let totalDebitDec = fin(0);
    let totalCreditDec = fin(0);
    const uniqueVoucherIds = new Set<number>();

    const items = rawRows.map((r, idx) => {
      uniqueVoucherIds.add(r.voucherId);
      const d = fin(r.debit);
      const c = fin(r.credit);
      totalDebitDec = totalDebitDec.add(d);
      totalCreditDec = totalCreditDec.add(c);
      runningDec = runningDec.add(d).subtract(c);

      return {
        rowNumber: idx + 1,
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        manualVoucherNumber: r.manualVoucherNumber || undefined,
        date: r.date,
        voucherType: r.voucherType || 'general',
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountLevel: r.accountLevel,
        detailedName: r.detailedName || undefined,
        detailedType: r.detailedType || undefined,
        currency: r.itemCurrency || r.voucherCurrency || 'IRR',
        description: r.itemDescription || r.voucherDescription || '',
        debit: d.toNumber(),
        credit: c.toNumber(),
        runningBalance: runningDec.toNumber(),
      };
    });

    return {
      items,
      totalDebit: totalDebitDec.toNumber(),
      totalCredit: totalCreditDec.toNumber(),
      vouchersCount: uniqueVoucherIds.size,
      isBalanced: totalDebitDec.subtract(totalCreditDec).abs().lessThan(0.01),
    };
  }

  /**
   * v7.0.71 (P2-6 / TD-210 بخش ۳): گردش بدهکار و بستانکار هر ارز با SUM دقیق PostgreSQL (اسناد تأییدشده/دائم،
   * ردیف‌های حذف‌نشده)؛ خروجی عدد.
   */
  private static async currencyTurnovers(extraConditions: Array<SQL | undefined>): Promise<CurrencyFinancialSummary[]> {
    const currencyExpr = sql<string>`COALESCE(NULLIF(${journalVoucherItems.currency}, ''), NULLIF(${journalVouchers.currency}, ''), 'IRR')`;
    const rows = await orm.select({
      currency: currencyExpr,
      totalDebit: sql<string>`COALESCE(SUM(${journalVoucherItems.debit}), 0)::text`,
      totalCredit: sql<string>`COALESCE(SUM(${journalVoucherItems.credit}), 0)::text`,
      vouchersCount: sql<number>`COUNT(DISTINCT ${journalVouchers.id})::int`,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent')),
      ...extraConditions
    ))
    .groupBy(currencyExpr);

    return rows.map(r => ({
      currency: r.currency,
      totalDebit: fin(r.totalDebit).toNumber(),
      totalCredit: fin(r.totalCredit).toNumber(),
      netBalance: fin(r.totalDebit).subtract(r.totalCredit).toNumber(),
      vouchersCount: Number(r.vouchersCount),
    }));
  }

  /**
   * Financial Ratios & Health Indicators (نسبت‌های مالی استاندارد، شاخص‌های سلامت مالی و تفکیک ارزی)
   */
  static async getFinancialRatios(params: { asOfDate?: string; currency?: string }): Promise<FinancialRatiosReport> {
    const bs = await this.getBalanceSheet({ date: params.asOfDate, currency: params.currency });
    const is = await this.getIncomeStatement({ endDate: params.asOfDate, currency: params.currency });

    const totalCurrentAssets = bs.totalCurrentAssets || 0;
    const totalNonCurrentAssets = bs.totalNonCurrentAssets || 0;
    const totalCurrentLiabilities = bs.totalCurrentLiabilities || 0;
    const totalAssets = (bs.totalAssets && bs.totalAssets > 0) ? bs.totalAssets : 1;
    const totalLiabilities = totalCurrentLiabilities;
    const totalEquity = (bs.totalEquity + bs.netProfitPeriod) || 1;
    const totalRevenue = is.totalRevenue || 0;
    const grossProfit = is.grossProfit || 0;
    const operatingProfit = is.operatingProfit || 0;
    const netProfit = is.netProfit || 0;

    // Estimate Cash & Bank from Code 10 / 11
    const cashItems = bs.currentAssets.filter(a => a.code.startsWith('10') || a.code.startsWith('11'));
    const cashAndBankBalance = FinancialMath.sum(cashItems.map(a => a.amount)).toNumber();

    // Inventory estimate from code 14
    const inventoryItem = bs.currentAssets.find(a => a.code.startsWith('14'));
    const inventoryBalance = inventoryItem ? inventoryItem.amount : 0;

    // Receivables estimate from code 12
    const receivablesItem = bs.currentAssets.find(a => a.code.startsWith('12'));
    const receivablesBalance = receivablesItem ? receivablesItem.amount : 0;

    // Liquidity Ratios
    const currentRatio = totalCurrentLiabilities > 0 ? (totalCurrentAssets / totalCurrentLiabilities) : (totalCurrentAssets > 0 ? 99 : 0);
    const quickRatio = totalCurrentLiabilities > 0 ? ((totalCurrentAssets - inventoryBalance) / totalCurrentLiabilities) : 0;
    const cashRatio = totalCurrentLiabilities > 0 ? (cashAndBankBalance / totalCurrentLiabilities) : 0;
    const netWorkingCapital = totalCurrentAssets - totalCurrentLiabilities;

    // Solvency & Leverage Ratios
    const debtRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;
    const debtToEquityRatio = totalEquity > 0 ? (totalLiabilities / totalEquity) * 100 : 0;
    const equityRatio = totalAssets > 0 ? (totalEquity / totalAssets) * 100 : 0;

    // Profitability Ratios
    const safeRevenue = totalRevenue > 0 ? totalRevenue : 1;
    const grossMargin = totalRevenue > 0 ? (grossProfit / safeRevenue) * 100 : 0;
    const operatingMargin = totalRevenue > 0 ? (operatingProfit / safeRevenue) * 100 : 0;
    const netProfitMargin = totalRevenue > 0 ? (netProfit / safeRevenue) * 100 : 0;
    const returnOnAssets = totalAssets > 0 ? (netProfit / totalAssets) * 100 : 0;
    const returnOnEquity = totalEquity > 0 ? (netProfit / totalEquity) * 100 : 0;

    // Activity & Turnover Ratios
    const assetTurnover = totalAssets > 0 ? Number((totalRevenue / totalAssets).toFixed(2)) : 0;
    const safeReceivables = receivablesBalance > 0 ? receivablesBalance : 1;
    const receivablesTurnover = totalRevenue > 0 ? Number((totalRevenue / safeReceivables).toFixed(2)) : 0;
    const safeInventory = inventoryBalance > 0 ? inventoryBalance : 1;
    const inventoryTurnover = is.totalCostOfSales > 0 ? Number((is.totalCostOfSales / safeInventory).toFixed(2)) : 0;
    const inventoryTurnoverDays = inventoryTurnover > 0 ? Math.round(365 / inventoryTurnover) : 0;

    // Currency Breakdowns across all active vouchers (v7.0.71: جمع در SQL)
    const currencyBreakdowns = await AccountingReportService.currencyTurnovers([]);

    // Calculate Overall Health Score (0-100)
    let score = 50;
    if (currentRatio >= 1.5) score += 15;
    else if (currentRatio >= 1.0) score += 5;
    else score -= 15;

    if (quickRatio >= 1.0) score += 10;
    else if (quickRatio < 0.7) score -= 10;

    if (debtRatio <= 50) score += 15;
    else if (debtRatio > 70) score -= 15;

    if (netProfitMargin >= 15) score += 15;
    else if (netProfitMargin >= 5) score += 5;
    else if (netProfitMargin < 0) score -= 20;

    score = Math.max(0, Math.min(100, score));

    return {
      asOfDate: params.asOfDate,
      currency: params.currency,
      currentRatio: Number(currentRatio.toFixed(2)),
      quickRatio: Number(quickRatio.toFixed(2)),
      cashRatio: Number(cashRatio.toFixed(2)),
      netWorkingCapital,
      debtRatio: Number(debtRatio.toFixed(1)),
      debtToEquityRatio: Number(debtToEquityRatio.toFixed(1)),
      equityRatio: Number(equityRatio.toFixed(1)),
      grossMargin: Number(grossMargin.toFixed(1)),
      operatingMargin: Number(operatingMargin.toFixed(1)),
      netProfitMargin: Number(netProfitMargin.toFixed(1)),
      returnOnAssets: Number(returnOnAssets.toFixed(1)),
      returnOnEquity: Number(returnOnEquity.toFixed(1)),
      assetTurnover,
      receivablesTurnover,
      inventoryTurnover,
      inventoryTurnoverDays,
      totalAssets,
      totalCurrentAssets,
      totalNonCurrentAssets,
      totalCurrentLiabilities,
      totalLiabilities,
      totalEquity,
      totalRevenue,
      grossProfit,
      operatingProfit,
      netProfit,
      cashAndBankBalance,
      inventoryBalance,
      receivablesBalance,
      status: {
        liquidity: currentRatio >= 2.0 ? 'excellent' : currentRatio >= 1.2 ? 'good' : currentRatio >= 1.0 ? 'warning' : 'danger',
        solvency: debtRatio <= 40 ? 'excellent' : debtRatio <= 65 ? 'good' : 'warning',
        profitability: netProfitMargin >= 20 ? 'excellent' : netProfitMargin >= 8 ? 'good' : netProfitMargin >= 0 ? 'warning' : 'danger',
        efficiency: assetTurnover >= 1.5 ? 'excellent' : assetTurnover >= 0.8 ? 'good' : 'warning',
        overallScore: score,
      },
      currencyBreakdowns,
    };
  }

  /**
   * Detailed Account Card / Customer & Personnel Ledger Card (کارت حساب تفصیلی با پشتیبانی از ارز)
   */
  static async getDetailedAccountCard(params: {
    accountId?: number;
    detailedType?: 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'other' | string;
    detailedId?: number;
    detailedName?: string;
    startDate?: string;
    endDate?: string;
    currency?: string;
  }): Promise<{
    items: {
      voucherId: number;
      voucherNumber: number;
      date: string;
      description?: string | null;
      accountName: string;
      accountCode: string;
      detailedName?: string;
      detailedType?: string;
      detailedId?: number | null;
      currency?: string;
      debit: number;
      credit: number;
      runningBalance: number;
      isOpening?: boolean;
    }[];
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    finalBalance: number;
  }> {
    // V2.0.0: فیلترهای دوره — مانده ابتدای دوره جداگانه محاسبه می‌شود
    const periodConditions = [
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ];

    if (params.accountId) {
      periodConditions.push(eq(journalVoucherItems.accountId, params.accountId));
    }
    if (params.detailedType && params.detailedType !== 'all') {
      periodConditions.push(eq(journalVoucherItems.detailedType, params.detailedType));
    }
    if (params.detailedId) {
      periodConditions.push(eq(journalVoucherItems.detailedId, params.detailedId));
    }
    if (params.detailedName) {
      periodConditions.push(like(journalVoucherItems.detailedName, containsLikePattern(params.detailedName.trim())));
    }
    if (params.startDate) {
      periodConditions.push(gte(journalVouchers.date, params.startDate));
    }
    if (params.endDate) {
      periodConditions.push(lte(journalVouchers.date, params.endDate));
    }
    if (params.currency && params.currency !== 'all') {
      periodConditions.push(or(
        eq(journalVoucherItems.currency, params.currency),
        eq(journalVouchers.currency, params.currency)
      ));
    }

    const rawRows = await orm.select({
      voucherId: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      voucherCurrency: journalVouchers.currency,
      itemCurrency: journalVoucherItems.currency,
      date: journalVouchers.date,
      itemDescription: journalVoucherItems.description,
      voucherDescription: journalVouchers.description,
      accountName: accounts.name,
      accountCode: accounts.code,
      detailedName: journalVoucherItems.detailedName,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(...periodConditions))
    .orderBy(asc(journalVouchers.date), asc(journalVouchers.voucherNumber), asc(journalVoucherItems.rowOrder));

    // V2.0.0: مانده ابتدای دوره — تجمیع اسناد قبل از startDate (با همان فیلترهای حساب/تفصیلی)
    // v7.0.71 (P2-6 بخش ۳): جمع در SQL و مانده‌ها با Decimal
    let openingDec = fin(0);
    if (params.startDate) {
      // بازسازی شرط‌ها بدون شرط startDate: همان فیلترها ولی date < startDate
      const priorConds: (SQL | undefined)[] = [
        eq(journalVouchers.isDeleted, 0),
        eq(journalVoucherItems.isDeleted, 0),
        or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
      ];
      if (params.accountId) priorConds.push(eq(journalVoucherItems.accountId, params.accountId));
      if (params.detailedType && params.detailedType !== 'all') priorConds.push(eq(journalVoucherItems.detailedType, params.detailedType));
      if (params.detailedId) priorConds.push(eq(journalVoucherItems.detailedId, params.detailedId));
      if (params.detailedName) priorConds.push(like(journalVoucherItems.detailedName, containsLikePattern(params.detailedName.trim())));
      if (params.currency && params.currency !== 'all') priorConds.push(or(
        eq(journalVoucherItems.currency, params.currency),
        eq(journalVouchers.currency, params.currency)
      ));
      if (params.startDate) priorConds.push(lt(journalVouchers.date, params.startDate));

      const [prior] = await orm.select({ balance: sql<string>`COALESCE(SUM(${journalVoucherItems.debit} - ${journalVoucherItems.credit}), 0)::text` })
      .from(journalVoucherItems)
      .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
      .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
      .where(and(...priorConds.filter((c): c is SQL => c !== undefined)));
      openingDec = fin(prior?.balance).round(4);
    }
    const openingBalance = openingDec.toNumber();

    let runningDec = openingDec;
    let totalDebitDec = fin(0);
    let totalCreditDec = fin(0);

    interface LedgerOutputRow {
      voucherId: number;
      voucherNumber: number;
      date: string;
      description?: string | null;
      accountName: string;
      accountCode: string;
      detailedName?: string;
      detailedType?: string;
      detailedId?: number | null;
      currency?: string;
      debit: number;
      credit: number;
      runningBalance: number;
      isOpening?: boolean;
    }

    const items: LedgerOutputRow[] = rawRows.map(r => {
      const d = fin(r.debit);
      const c = fin(r.credit);
      totalDebitDec = totalDebitDec.add(d);
      totalCreditDec = totalCreditDec.add(c);
      runningDec = runningDec.add(d).subtract(c);

      return {
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        date: r.date,
        description: r.itemDescription || r.voucherDescription,
        accountName: r.accountName,
        accountCode: r.accountCode,
        detailedName: r.detailedName || undefined,
        detailedType: r.detailedType || undefined,
        detailedId: r.detailedId,
        currency: r.itemCurrency || r.voucherCurrency || 'IRR',
        debit: d.toNumber(),
        credit: c.toNumber(),
        runningBalance: runningDec.toNumber(),
      };
    });

    // V2.0.0: ردیف «مانده ابتدای دوره» به ابتدای لیست (وقتی بازه تعیین شده و مانده صفر نیست)
    if (params.startDate && openingBalance !== 0) {
      items.unshift({
        voucherId: 0,
        voucherNumber: 0,
        date: params.startDate,
        description: 'مانده ابتدای دوره',
        accountName: '',
        accountCode: '',
        currency: params.currency && params.currency !== 'all' ? params.currency : 'IRR',
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
        runningBalance: openingBalance,
        isOpening: true,
      });
    }

    return {
      items,
      openingBalance,
      totalDebit: totalDebitDec.toNumber(),
      totalCredit: totalCreditDec.toNumber(),
      finalBalance: runningDec.toNumber(),
    };
  }

  /**
   * Fast list of parties (customers, suppliers, personnel) for instant lookup
   */
  static async getPartiesList(params?: { search?: string; type?: string }): Promise<PartyOption[]> {
    const search = params?.search ? params.search.trim().toLowerCase() : '';
    const typeFilter = params?.type || 'all';

    const result: PartyOption[] = [];

    // 1. Customers and Suppliers
    if (typeFilter === 'all' || typeFilter === 'customer' || typeFilter === 'supplier') {
      const custRows = await orm.select({
        id: customers.id,
        name: customers.name,
        partyType: customers.partyType,
        phone: customers.phone,
        city: customers.city,
      })
      .from(customers)
      .where(eq(customers.isDeleted, 0));

      for (const c of custRows) {
        const pType = c.partyType || 'customer';
        if (typeFilter === 'supplier' && pType !== 'supplier' && pType !== 'both') continue;
        if (typeFilter === 'customer' && pType === 'supplier') continue;

        if (search) {
          const matchName = c.name?.toLowerCase().includes(search);
          const matchPhone = c.phone?.toLowerCase().includes(search);
          const matchCity = c.city?.toLowerCase().includes(search);
          if (!matchName && !matchPhone && !matchCity) continue;
        }

        result.push({
          id: c.id,
          name: c.name,
          partyType: (pType === 'both' ? (typeFilter === 'supplier' ? 'supplier' : 'customer') : pType) as PartyOption['partyType'],
          phone: c.phone || undefined,
          city: c.city || undefined,
        });
      }
    }

    // 2. Personnel
    if (typeFilter === 'all' || typeFilter === 'personnel') {
      const persRows = await orm.select({
        id: personnel.id,
        fullName: personnel.fullName,
        personnelCode: personnel.personnelCode,
        phone: personnel.phone,
        jobTitle: personnel.jobTitle,
      })
      .from(personnel)
      .where(eq(personnel.isDeleted, 0));

      for (const p of persRows) {
        if (search) {
          const matchName = p.fullName?.toLowerCase().includes(search);
          const matchCode = p.personnelCode?.toLowerCase().includes(search);
          const matchPhone = p.phone?.toLowerCase().includes(search);
          if (!matchName && !matchCode && !matchPhone) continue;
        }

        result.push({
          id: p.id,
          name: p.fullName,
          partyType: 'personnel',
          phone: p.phone || undefined,
          code: p.personnelCode || undefined,
          city: p.jobTitle || undefined,
        });
      }
    }

    // Sort alphabetically by Persian name
    return result.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }

  /**
   * Floating Detailed Party Ledger (صورت‌حساب جامع و ریزگردش تفصیلی اشخاص و طرف‌حساب‌ها)
   * استخراج سریع تمامی آرتیکل‌های مالی مرتبط با شخص (مشتری، تامین‌کننده، پرسنل) در تمام معین‌ها
   */
  static async getDetailedPartyLedger(params: {
    partyId?: number;
    partyType?: 'customer' | 'supplier' | 'personnel' | 'other' | 'all' | string;
    partyName?: string;
    startDate?: string;
    endDate?: string;
    currency?: string;
    includeDrafts?: boolean;
  }): Promise<DetailedPartyLedgerResult> {
    let partyInfo: {
      id?: number;
      name: string;
      partyType: string;
      phone?: string;
      code?: string;
      city?: string;
    } | null = null;

    // Resolve party details from database
    if (params.partyId) {
      if (params.partyType === 'personnel') {
        const [p] = await orm.select().from(personnel).where(and(eq(personnel.id, params.partyId), eq(personnel.isDeleted, 0)));
        if (p) {
          partyInfo = {
            id: p.id,
            name: p.fullName,
            partyType: 'personnel',
            phone: p.phone || undefined,
            code: p.personnelCode || undefined,
            city: p.jobTitle || undefined,
          };
        }
      } else {
        const [c] = await orm.select().from(customers).where(and(eq(customers.id, params.partyId), eq(customers.isDeleted, 0)));
        if (c) {
          partyInfo = {
            id: c.id,
            name: c.name,
            partyType: c.partyType || 'customer',
            phone: c.phone || undefined,
            city: c.city || undefined,
          };
        }
      }
    }

    if (!partyInfo && params.partyName) {
      const pName = params.partyName.trim();
      const [c] = await orm.select().from(customers).where(and(eq(customers.name, pName), eq(customers.isDeleted, 0)));
      if (c) {
        partyInfo = {
          id: c.id,
          name: c.name,
          partyType: c.partyType || 'customer',
          phone: c.phone || undefined,
          city: c.city || undefined,
        };
      } else {
        const [p] = await orm.select().from(personnel).where(and(eq(personnel.fullName, pName), eq(personnel.isDeleted, 0)));
        if (p) {
          partyInfo = {
            id: p.id,
            name: p.fullName,
            partyType: 'personnel',
            phone: p.phone || undefined,
            code: p.personnelCode || undefined,
            city: p.jobTitle || undefined,
          };
        } else {
          partyInfo = {
            id: params.partyId,
            name: pName,
            partyType: (params.partyType && params.partyType !== 'all') ? params.partyType : 'طرف‌حساب',
          };
        }
      }
    }

    const effectivePartyName = partyInfo?.name || params.partyName?.trim() || '';
    const effectivePartyId = partyInfo?.id || params.partyId;

    // Conditions for party matching in voucher items
    // An item matches if:
    // 1) detailedId = effectivePartyId
    // OR 2) detailedName = effectivePartyName
    const partyMatchConditions: SQL[] = [];
    if (effectivePartyId && effectivePartyName) {
      partyMatchConditions.push(
        or(
          eq(journalVoucherItems.detailedId, effectivePartyId),
          eq(journalVoucherItems.detailedName, effectivePartyName),
          like(journalVoucherItems.detailedName, containsLikePattern(effectivePartyName))
        )!
      );
    } else if (effectivePartyId) {
      partyMatchConditions.push(eq(journalVoucherItems.detailedId, effectivePartyId));
    } else if (effectivePartyName) {
      partyMatchConditions.push(
        or(
          eq(journalVoucherItems.detailedName, effectivePartyName),
          like(journalVoucherItems.detailedName, containsLikePattern(effectivePartyName))
        )!
      );
    }

    // Base conditions for valid vouchers
    const voucherStatusCondition = params.includeDrafts
      ? or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'), eq(journalVouchers.status, 'draft'))
      : or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'));

    const baseConditions: (SQL | undefined)[] = [
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      voucherStatusCondition,
      ...partyMatchConditions
    ];

    if (params.currency && params.currency !== 'all') {
      baseConditions.push(
        or(
          eq(journalVoucherItems.currency, params.currency),
          eq(journalVouchers.currency, params.currency)
        )
      );
    }

    // 1. Calculate opening balance (prior to startDate) — v7.0.71 (P2-6 بخش ۳): جمع در SQL و مانده‌ها با Decimal
    let openingDec = fin(0);
    if (params.startDate) {
      const priorConditions = [
        ...baseConditions,
        lt(journalVouchers.date, params.startDate)
      ].filter((c): c is SQL => c !== undefined);

      const [prior] = await orm.select({ balance: sql<string>`COALESCE(SUM(${journalVoucherItems.debit} - ${journalVoucherItems.credit}), 0)::text` })
      .from(journalVoucherItems)
      .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
      .where(and(...priorConditions));
      openingDec = fin(prior?.balance).round(4);
    }
    const openingBalance = openingDec.toNumber();

    const openingBalanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب' =
      openingBalance > 0 ? 'بدهکار' : openingBalance < 0 ? 'بستانکار' : 'بی‌حساب';

    // 2. Query period items
    const periodConditions = [
      ...baseConditions,
      params.startDate ? gte(journalVouchers.date, params.startDate) : undefined,
      params.endDate ? lte(journalVouchers.date, params.endDate) : undefined,
    ].filter((c): c is SQL => c !== undefined);

    const rawRows = await orm.select({
      voucherId: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      manualVoucherNumber: journalVouchers.manualVoucherNumber,
      voucherCurrency: journalVouchers.currency,
      itemCurrency: journalVoucherItems.currency,
      date: journalVouchers.date,
      itemDescription: journalVoucherItems.description,
      voucherDescription: journalVouchers.description,
      accountName: accounts.name,
      accountCode: accounts.code,
      detailedName: journalVoucherItems.detailedName,
      detailedType: journalVoucherItems.detailedType,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      rowOrder: journalVoucherItems.rowOrder,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(...periodConditions))
    .orderBy(asc(journalVouchers.date), asc(journalVouchers.voucherNumber), asc(journalVoucherItems.rowOrder));

    let runningDec = openingDec;
    let totalDebitDec = fin(0);
    let totalCreditDec = fin(0);

    const items: DetailedPartyLedgerItem[] = [];

    // Add opening balance row if there is a start date and opening balance is non-zero
    if (params.startDate && openingBalance !== 0) {
      items.push({
        rowNumber: 0,
        voucherId: 0,
        voucherNumber: 0,
        date: params.startDate,
        description: 'مانده ابتدای دوره (انتقال از قبل)',
        accountCode: '—',
        accountName: 'مانده دفتری',
        currency: params.currency && params.currency !== 'all' ? params.currency : 'IRR',
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
        runningBalance: openingBalance,
        balanceType: openingBalanceType,
        isOpening: true,
      });
    }

    rawRows.forEach((r, idx) => {
      const d = fin(r.debit);
      const c = fin(r.credit);
      totalDebitDec = totalDebitDec.add(d);
      totalCreditDec = totalCreditDec.add(c);
      runningDec = runningDec.add(d).subtract(c);
      const runningBalance = runningDec.toNumber();

      const balanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب' =
        runningBalance > 0 ? 'بدهکار' : runningBalance < 0 ? 'بستانکار' : 'بی‌حساب';

      items.push({
        rowNumber: idx + 1,
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        manualVoucherNumber: r.manualVoucherNumber || undefined,
        date: r.date,
        description: r.itemDescription || r.voucherDescription || 'ثبت سند حسابداری',
        accountCode: r.accountCode,
        accountName: r.accountName,
        detailedName: r.detailedName || undefined,
        detailedType: r.detailedType || undefined,
        currency: r.itemCurrency || r.voucherCurrency || 'IRR',
        debit: d.toNumber(),
        credit: c.toNumber(),
        runningBalance,
        balanceType,
      });
    });

    const finalBalance = runningDec.round(4).toNumber();
    const finalBalanceType: 'بدهکار' | 'بستانکار' | 'بی‌حساب' =
      finalBalance > 0 ? 'بدهکار' : finalBalance < 0 ? 'بستانکار' : 'بی‌حساب';

    let netStatusText = 'حساب تسویه و بی‌حساب است';
    const curLabel = (params.currency && params.currency !== 'all') ? params.currency : 'ریال';
    if (finalBalance > 0) {
      netStatusText = `وضعیت حساب: ${Math.abs(finalBalance).toLocaleString('fa-IR')} ${curLabel} بدهکار است (طلب شرکت از طرف‌حساب)`;
    } else if (finalBalance < 0) {
      netStatusText = `وضعیت حساب: ${Math.abs(finalBalance).toLocaleString('fa-IR')} ${curLabel} بستانکار است (بدهی شرکت به طرف‌حساب)`;
    }

    return {
      party: partyInfo,
      openingBalance,
      openingBalanceType,
      totalDebit: totalDebitDec.round(4).toNumber(),
      totalCredit: totalCreditDec.round(4).toNumber(),
      finalBalance,
      finalBalanceType,
      netStatusText,
      items,
    };
  }

  /**
   * Income Statement / Profit & Loss (صورت سود و زیان با پشتیبانی از ارز)
   */
  static async getIncomeStatement(params: { startDate?: string; endDate?: string; currency?: string }, tx?: DbExecutor): Promise<{
    revenues: { code: string; name: string; amount: number }[];
    totalRevenue: number;
    costOfSales: { code: string; name: string; amount: number }[];
    totalCostOfSales: number;
    grossProfit: number;
    operatingExpenses: { code: string; name: string; amount: number }[];
    totalOperatingExpenses: number;
    operatingProfit: number;
    netProfit: number;
  }> {
    const trial = await this.getTrialBalance({ level: 'subsidiary', ...params }, tx);

    const revenues: { code: string; name: string; amount: number }[] = [];
    const costOfSales: { code: string; name: string; amount: number }[] = [];
    const operatingExpenses: { code: string; name: string; amount: number }[] = [];

    // v7.0.71 (P2-6 بخش ۳): جمع‌ها با Decimal
    let totalRevenue = fin(0);
    let totalCostOfSales = fin(0);
    let totalOperatingExpenses = fin(0);

    for (const r of trial) {
      if (r.accountType === 'revenue') {
        const netAmt = fin(r.creditTurnover).subtract(r.debitTurnover);
        if (!netAmt.isZero()) {
          revenues.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
          totalRevenue = totalRevenue.add(netAmt);
        }
      } else if (r.accountType === 'cost_of_sales') {
        const netAmt = fin(r.debitTurnover).subtract(r.creditTurnover);
        if (!netAmt.isZero()) {
          costOfSales.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
          totalCostOfSales = totalCostOfSales.add(netAmt);
        }
      } else if (r.accountType === 'expense') {
        const netAmt = fin(r.debitTurnover).subtract(r.creditTurnover);
        if (!netAmt.isZero()) {
          operatingExpenses.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
          totalOperatingExpenses = totalOperatingExpenses.add(netAmt);
        }
      }
    }

    const grossProfit = totalRevenue.subtract(totalCostOfSales);
    const operatingProfit = grossProfit.subtract(totalOperatingExpenses);

    return {
      revenues,
      totalRevenue: totalRevenue.toNumber(),
      costOfSales,
      totalCostOfSales: totalCostOfSales.toNumber(),
      grossProfit: grossProfit.toNumber(),
      operatingExpenses,
      totalOperatingExpenses: totalOperatingExpenses.toNumber(),
      operatingProfit: operatingProfit.toNumber(),
      netProfit: operatingProfit.toNumber(),
    };
  }

  /**
   * Balance Sheet (ترازنامه با پشتیبانی از ارز)
   */
  static async getBalanceSheet(params: { date?: string; currency?: string }, tx?: DbExecutor): Promise<{
    currentAssets: { code: string; name: string; amount: number }[];
    totalCurrentAssets: number;
    nonCurrentAssets: { code: string; name: string; amount: number }[];
    totalNonCurrentAssets: number;
    totalAssets: number;
    currentLiabilities: { code: string; name: string; amount: number }[];
    totalCurrentLiabilities: number;
    equity: { code: string; name: string; amount: number }[];
    totalEquity: number;
    netProfitPeriod: number;
    totalLiabilitiesAndEquity: number;
  }> {
    const trial = await this.getTrialBalance({ level: 'subsidiary', endDate: params.date, currency: params.currency }, tx);

    const currentAssets: { code: string; name: string; amount: number }[] = [];
    const nonCurrentAssets: { code: string; name: string; amount: number }[] = [];
    const currentLiabilities: { code: string; name: string; amount: number }[] = [];
    const equity: { code: string; name: string; amount: number }[] = [];

    // v7.0.71 (P2-6 بخش ۳): جمع‌ها با Decimal
    let totalCurrentAssets = fin(0);
    let totalNonCurrentAssets = fin(0);
    let totalCurrentLiabilities = fin(0);
    let totalEquity = fin(0);

    let periodRevenues = fin(0);
    let periodExpenses = fin(0);

    for (const r of trial) {
      if (r.accountType === 'asset') {
        const netAmt = fin(r.debitBalance).subtract(r.creditBalance);
        if (r.code.startsWith('1')) {
          currentAssets.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
          totalCurrentAssets = totalCurrentAssets.add(netAmt);
        } else {
          nonCurrentAssets.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
          totalNonCurrentAssets = totalNonCurrentAssets.add(netAmt);
        }
      } else if (r.accountType === 'liability') {
        const netAmt = fin(r.creditBalance).subtract(r.debitBalance);
        currentLiabilities.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
        totalCurrentLiabilities = totalCurrentLiabilities.add(netAmt);
      } else if (r.accountType === 'equity') {
        const netAmt = fin(r.creditBalance).subtract(r.debitBalance);
        equity.push({ code: r.code, name: r.name, amount: netAmt.toNumber() });
        totalEquity = totalEquity.add(netAmt);
      } else if (r.accountType === 'revenue') {
        periodRevenues = periodRevenues.add(fin(r.creditTurnover).subtract(r.debitTurnover));
      } else if (r.accountType === 'expense' || r.accountType === 'cost_of_sales') {
        periodExpenses = periodExpenses.add(fin(r.debitTurnover).subtract(r.creditTurnover));
      }
    }

    const netProfitPeriod = periodRevenues.subtract(periodExpenses);
    const totalAssets = totalCurrentAssets.add(totalNonCurrentAssets);
    const totalLiabilitiesAndEquity = totalCurrentLiabilities.add(totalEquity).add(netProfitPeriod);

    return {
      currentAssets,
      totalCurrentAssets: totalCurrentAssets.toNumber(),
      nonCurrentAssets,
      totalNonCurrentAssets: totalNonCurrentAssets.toNumber(),
      totalAssets: totalAssets.toNumber(),
      currentLiabilities,
      totalCurrentLiabilities: totalCurrentLiabilities.toNumber(),
      equity,
      totalEquity: totalEquity.toNumber(),
      netProfitPeriod: netProfitPeriod.toNumber(),
      totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toNumber(),
    };
  }

  /**
   * Multi-Currency Portfolio Summary (گزارش جامع وضعیت ارزی و پرتفوی ارزهای خارجی)
   */
  static async getMultiCurrencySummary(params?: { startDate?: string; endDate?: string }): Promise<{
    currencies: CurrencyFinancialSummary[];
    totalCurrenciesCount: number;
    activeCurrencies: string[];
  }> {
    const dateConditions: SQL[] = [];
    if (params?.startDate) {
      dateConditions.push(gte(journalVouchers.date, params.startDate));
    }
    if (params?.endDate) {
      dateConditions.push(lte(journalVouchers.date, params.endDate));
    }

    // v7.0.71: ردیف‌های حذف‌شده سند (journal_voucher_items.is_deleted) هم دیگر شمرده نمی‌شوند
    const currencies = await AccountingReportService.currencyTurnovers(dateConditions);

    return {
      currencies,
      totalCurrenciesCount: currencies.length,
      activeCurrencies: currencies.map(c => c.currency),
    };
  }

  /**
   * Financial Overview Stats for Accounting Dashboard
   */
  static async getFinancialOverviewStats(): Promise<FinancialSummaryStats> {
    // v7.0.71 (P2-6 بخش ۳): جمع‌ها با Decimal و جمع چک‌ها در SQL
    const banks = await TreasuryService.getBankAccounts();
    const totalCashAndBank = FinancialMath.sum(banks.map(b => b.currentBalance));

    const trial = await this.getTrialBalance({ level: 'general' });

    let totalReceivables = fin(0);
    let totalPayables = fin(0);
    let totalRevenues = fin(0);
    let totalCostOfSales = fin(0);
    let totalExpenses = fin(0);

    for (const r of trial) {
      if (r.code === '12' || r.code === '11') {
        totalReceivables = totalReceivables.add(r.debitBalance);
      } else if (r.code === '30' || r.code === '31' || r.code === '32') {
        totalPayables = totalPayables.add(r.creditBalance);
      } else if (r.accountType === 'revenue') {
        totalRevenues = totalRevenues.add(fin(r.creditTurnover).subtract(r.debitTurnover));
      } else if (r.accountType === 'cost_of_sales') {
        totalCostOfSales = totalCostOfSales.add(fin(r.debitTurnover).subtract(r.creditTurnover));
      } else if (r.accountType === 'expense') {
        totalExpenses = totalExpenses.add(fin(r.debitTurnover).subtract(r.creditTurnover));
      }
    }

    // Cheques stats
    const isReceived = sql`${cheques.type} = 'received'`;
    const [chequeSums] = await orm.select({
      received: sql<string>`COALESCE(SUM(${cheques.amount}) FILTER (WHERE ${isReceived}), 0)::text`,
      inCollection: sql<string>`COALESCE(SUM(${cheques.amount}) FILTER (WHERE ${isReceived} AND ${cheques.status} IN ('in_collection', 'in_treasury', 'received')), 0)::text`,
      paid: sql<string>`COALESCE(SUM(${cheques.amount}) FILTER (WHERE ${cheques.type} IS DISTINCT FROM 'received' AND ${cheques.status} IS DISTINCT FROM 'passed' AND ${cheques.status} IS DISTINCT FROM 'returned'), 0)::text`,
    }).from(cheques).where(eq(cheques.isDeleted, 0));

    const [vCount] = await orm.select({ count: sql<number>`count(*)` })
      .from(journalVouchers)
      .where(eq(journalVouchers.isDeleted, 0));

    return {
      totalCashAndBank: totalCashAndBank.toNumber(),
      totalReceivables: totalReceivables.toNumber(),
      totalPayables: totalPayables.toNumber(),
      totalChequesInCollection: fin(chequeSums?.inCollection).toNumber(),
      totalChequesReceived: fin(chequeSums?.received).toNumber(),
      totalChequesPaid: fin(chequeSums?.paid).toNumber(),
      totalRevenues: totalRevenues.toNumber(),
      totalCostOfSales: totalCostOfSales.toNumber(),
      totalExpenses: totalExpenses.toNumber(),
      netProfit: totalRevenues.subtract(totalCostOfSales).subtract(totalExpenses).toNumber(),
      totalVouchersCount: Number(vCount?.count) || 0,
    };
  }

  /**
   * V1.6.0 — گزارش جریان نقدی خزانه
   * بر مبنای تراکنش‌های واقعی خزانه (نه صرفاً اسناد): برای هر حساب
   * مانده ابتدای دوره، جمع دریافت‌ها/پرداخت‌ها و مانده پایان دوره + روند ماهانه.
   */
  static async getCashFlowReport(params: {
    startDate?: string;
    endDate?: string;
  }): Promise<{
    period: { startDate: string; endDate: string };
    rows: Array<{
      accountId: number;
      title: string;
      type: string;
      currency: string;
      opening: number;
      receipts: number;
      payments: number;
      closing: number;
    }>;
    months: Array<{ month: string; receipts: number; payments: number; net: number }>;
    totals: { opening: number; receipts: number; payments: number; closing: number };
  }> {
    const banks = await orm.select().from(bankAccounts)
      .where(and(eq(bankAccounts.isDeleted, 0), eq(bankAccounts.isActive, 1)))
      .orderBy(asc(bankAccounts.id));

    const txs = await orm.select({
      bankAccountId: treasuryTransactions.bankAccountId,
      type: treasuryTransactions.type,
      amount: treasuryTransactions.amount,
      date: treasuryTransactions.date,
      status: treasuryTransactions.status,
    })
    .from(treasuryTransactions)
    .where(eq(treasuryTransactions.isDeleted, 0))
    .orderBy(asc(treasuryTransactions.date), asc(treasuryTransactions.id));

    const start = params.startDate || '';
    const end = params.endDate || '9999-12-31';

    // v7.0.71 (P2-6 بخش ۳): جمع‌ها با Decimal
    const rows = banks.map(b => {
      let opening = fin(b.initialBalance);
      let receipts = fin(0);
      let payments = fin(0);
      for (const t of txs) {
        if (Number(t.bankAccountId) !== b.id || t.status === 'voided') continue;
        const inPeriod = (!start || String(t.date).slice(0, 10) >= start) && (String(t.date).slice(0, 10) <= end);
        if (inPeriod) {
          if (t.type === 'receipt') receipts = receipts.add(t.amount); else payments = payments.add(t.amount);
        } else if (!start || String(t.date).slice(0, 10) < start) {
          opening = t.type === 'receipt' ? opening.add(t.amount) : opening.subtract(t.amount);
        }
      }
      return {
        accountId: b.id,
        title: b.title,
        type: b.type,
        currency: b.currency || 'IRR',
        opening: opening.round(4).toNumber(),
        receipts: receipts.round(4).toNumber(),
        payments: payments.round(4).toNumber(),
        closing: opening.add(receipts).subtract(payments).round(4).toNumber(),
      };
    });

    // روند ماهانه بر مبنای همه حساب‌ها در بازه
    const monthMap = new Map<string, { receipts: FinancialDecimal; payments: FinancialDecimal }>();
    for (const t of txs) {
      if (t.status === 'voided') continue;
      const d = String(t.date).slice(0, 10);
      if (start && d < start) continue;
      if (d > end) continue;
      const monthKey = d.slice(0, 7);
      const agg = monthMap.get(monthKey) || { receipts: fin(0), payments: fin(0) };
      if (t.type === 'receipt') agg.receipts = agg.receipts.add(t.amount);
      else agg.payments = agg.payments.add(t.amount);
      monthMap.set(monthKey, agg);
    }
    const months = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        receipts: v.receipts.round(4).toNumber(),
        payments: v.payments.round(4).toNumber(),
        net: v.receipts.subtract(v.payments).round(4).toNumber(),
      }));

    const totals = {
      opening: FinancialMath.sum(rows.map(r => r.opening)).toNumber(),
      receipts: FinancialMath.sum(rows.map(r => r.receipts)).toNumber(),
      payments: FinancialMath.sum(rows.map(r => r.payments)).toNumber(),
      closing: FinancialMath.sum(rows.map(r => r.closing)).toNumber(),
    };

    return { period: { startDate: start, endDate: end }, rows, months, totals };
  }

  /**
   * V1.6.0 — آشتی‌سنجی دفتر چک صیادی با دفاتر دوبل
   * برای هر حساب اسناد (1101/1102/1103/3101): مانده دفتری از اسناد دوبل
   * در برابر مانده موردانتظار محاسبه‌شده از جدول cheques.
   */
  static async getChequeReconciliationReport(): Promise<Array<{
    code: string;
    title: string;
    ledgerBalance: number;
    expectedBalance: number;
    discrepancy: number;
    counts: { ledger: number; cheques: number };
  }>> {
    // مانده دفتری هر کد از اقلام اسناد دوبل نهایی‌شده
    const ledgerRows = await orm
      .select({
        code: accounts.code,
        title: accounts.name,
        debit: sql<string>`COALESCE(SUM(${journalVoucherItems.debit}), 0)::text`,
        credit: sql<string>`COALESCE(SUM(${journalVoucherItems.credit}), 0)::text`,
      })
      .from(journalVoucherItems)
      .innerJoin(accounts, eq(journalVoucherItems.accountId, accounts.id))
      .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
      .where(and(
        eq(journalVouchers.isDeleted, 0),
        eq(journalVoucherItems.isDeleted, 0),
        sql`${journalVouchers.status} IN ('approved', 'permanent')`,
        sql`${accounts.code} IN ('1101', '1102', '1103', '3101')`
      ))
      .groupBy(accounts.code, accounts.name);

    const allCheques = await orm.select({
      type: cheques.type,
      status: cheques.status,
      amount: cheques.amount,
    }).from(cheques).where(eq(cheques.isDeleted, 0));

    const statusToCode: Record<string, { code: string; type?: string }> = {
      received: { code: '1101', type: 'received' },
      in_treasury: { code: '1101', type: 'received' },
      in_safe: { code: '1101', type: 'received' },
      in_collection: { code: '1102', type: 'received' },
      bounced: { code: '1103', type: 'received' },
    };
    // چک پرداختی صادره/در جریان → 3101 (تا زمان پاس شدن)
    const expected: Record<string, FinancialDecimal> = { '1101': fin(0), '1102': fin(0), '1103': fin(0), '3101': fin(0) };
    const counts: Record<string, number> = { '1101': 0, '1102': 0, '1103': 0, '3101': 0 };
    for (const c of allCheques) {
      let codeKey: string | null = null;
      if (c.type === 'received') {
        codeKey = statusToCode[String(c.status)]?.code || null;
      } else if (String(c.status) !== 'passed') {
        codeKey = '3101';
      }
      if (codeKey) {
        expected[codeKey] = expected[codeKey].add(c.amount);
        counts[codeKey] += 1;
      }
    }

    const titles: Record<string, string> = {
      '1101': 'اسناد دریافتنی نزد صندوق',
      '1102': 'اسناد در جریان وصول',
      '1103': 'اسناد واخواستی (برگشتی)',
      '3101': 'اسناد پرداختنی تجاری',
    };

    const codes = ['1101', '1102', '1103', '3101'];
    return codes.map(code => {
      const lr = ledgerRows.find(l => l.code === code);
      const ledgerBalance = fin(lr?.debit).subtract(lr?.credit ?? 0).round(4);
      const expectedBalance = expected[code].round(4);
      return {
        code,
        title: lr?.title || titles[code],
        ledgerBalance: ledgerBalance.toNumber(),
        expectedBalance: expectedBalance.toNumber(),
        discrepancy: ledgerBalance.subtract(expectedBalance).toNumber(),
        counts: { ledger: 0, cheques: counts[code] || 0 },
      };
    });
  }
}
