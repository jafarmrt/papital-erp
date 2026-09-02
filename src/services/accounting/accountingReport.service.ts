import { orm } from '../../db/drizzle.js';
import { accounts, journalVouchers, journalVoucherItems, cheques, bankAccounts, treasuryTransactions } from '../../db/schema.js';
import { eq, asc, and, or, sql, like, gte, lte, lt, desc } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { TreasuryService } from './treasury.service.js';
import type { TrialBalanceRow, FinancialSummaryStats, FinancialRatiosReport, CurrencyFinancialSummary } from '../../types.js';

export class AccountingReportService {
  /**
   * Trial Balance (تراز آزمایشی ۲، ۴، ۶ و ۸ ستونی در هر ۴ سطح: گروه، کل، معین، تفصیلی و درختی جامع با پشتیبانی از فیلتر ارز)
   */
  static async getTrialBalance(params: {
    level?: 'group' | 'general' | 'subsidiary' | 'detailed' | 'all' | 'tree';
    startDate?: string;
    endDate?: string;
    currency?: string;
  }): Promise<TrialBalanceRow[]> {
    const targetLevel = params.level || 'all';

    // Base conditions for approved or permanent journal vouchers
    const baseConditions = [
      eq(journalVouchers.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ];

    // Fetch all journal items
    const allItems = await orm.select({
      voucherId: journalVouchers.id,
      voucherDate: journalVouchers.date,
      voucherNumber: journalVouchers.voucherNumber,
      voucherCurrency: journalVouchers.currency,
      itemCurrency: journalVoucherItems.currency,
      accountId: journalVoucherItems.accountId,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      detailedName: journalVoucherItems.detailedName,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      description: journalVoucherItems.description,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(...baseConditions));

    // Maps for turnovers
    // AccountId => turnover
    const initialDebitMap = new Map<number, number>();
    const initialCreditMap = new Map<number, number>();
    const periodDebitMap = new Map<number, number>();
    const periodCreditMap = new Map<number, number>();

    // Detailed entities map: key = `${accountId}_${detailedName || 'عام'}`
    interface DetailedAccumulator {
      accountId: number;
      detailedType?: string;
      detailedId?: number | null;
      detailedName: string;
      initialDebit: number;
      initialCredit: number;
      periodDebit: number;
      periodCredit: number;
    }
    const detailedMap = new Map<string, DetailedAccumulator>();

    for (const it of allItems) {
      // Currency filtering if specified
      if (params.currency && params.currency !== 'all') {
        const itemCur = it.itemCurrency || it.voucherCurrency || 'IRR';
        if (itemCur !== params.currency) {
          continue;
        }
      }

      const d = Number(it.debit || 0);
      const c = Number(it.credit || 0);
      const accId = it.accountId;
      const vDate = it.voucherDate;

      const isBeforeStart = params.startDate ? vDate < params.startDate : false;
      const isAfterEnd = params.endDate ? vDate > params.endDate : false;

      if (isAfterEnd) {
        continue; // Skip transactions beyond end date
      }

      if (isBeforeStart) {
        initialDebitMap.set(accId, (initialDebitMap.get(accId) || 0) + d);
        initialCreditMap.set(accId, (initialCreditMap.get(accId) || 0) + c);
      } else {
        periodDebitMap.set(accId, (periodDebitMap.get(accId) || 0) + d);
        periodCreditMap.set(accId, (periodCreditMap.get(accId) || 0) + c);
      }

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
          initialDebit: 0,
          initialCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
        };
        detailedMap.set(dKey, det);
      }

      if (isBeforeStart) {
        det.initialDebit += d;
        det.initialCredit += c;
      } else {
        det.periodDebit += d;
        det.periodCredit += c;
      }
    }

    const allAccs = await ChartOfAccountsService.getAllAccounts();
    const accMap = new Map(allAccs.map(a => [a.id, a]));

    // Aggregate from subsidiary up to general and group accounts
    const aggInitialDebit = new Map<number, number>();
    const aggInitialCredit = new Map<number, number>();
    const aggPeriodDebit = new Map<number, number>();
    const aggPeriodCredit = new Map<number, number>();

    for (const [accId, debit] of initialDebitMap.entries()) {
      let cur = accMap.get(accId);
      while (cur) {
        aggInitialDebit.set(cur.id, (aggInitialDebit.get(cur.id) || 0) + debit);
        cur = cur.parentId ? accMap.get(cur.parentId) : undefined;
      }
    }
    for (const [accId, credit] of initialCreditMap.entries()) {
      let cur = accMap.get(accId);
      while (cur) {
        aggInitialCredit.set(cur.id, (aggInitialCredit.get(cur.id) || 0) + credit);
        cur = cur.parentId ? accMap.get(cur.parentId) : undefined;
      }
    }
    for (const [accId, debit] of periodDebitMap.entries()) {
      let cur = accMap.get(accId);
      while (cur) {
        aggPeriodDebit.set(cur.id, (aggPeriodDebit.get(cur.id) || 0) + debit);
        cur = cur.parentId ? accMap.get(cur.parentId) : undefined;
      }
    }
    for (const [accId, credit] of periodCreditMap.entries()) {
      let cur = accMap.get(accId);
      while (cur) {
        aggPeriodCredit.set(cur.id, (aggPeriodCredit.get(cur.id) || 0) + credit);
        cur = cur.parentId ? accMap.get(cur.parentId) : undefined;
      }
    }

    // Build standard account rows
    const buildRow = (acc: any): TrialBalanceRow => {
      const initD = aggInitialDebit.get(acc.id) || 0;
      const initC = aggInitialCredit.get(acc.id) || 0;
      const perD = aggPeriodDebit.get(acc.id) || 0;
      const perC = aggPeriodCredit.get(acc.id) || 0;

      const totD = initD + perD;
      const totC = initC + perC;
      const diff = totD - totC;
      const debitBalance = diff > 0 ? diff : 0;
      const creditBalance = diff < 0 ? Math.abs(diff) : 0;

      const initDiff = initD - initC;
      const initialDebitBalance = initDiff > 0 ? initDiff : 0;
      const initialCreditBalance = initDiff < 0 ? Math.abs(initDiff) : 0;

      return {
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        level: acc.level,
        parentId: acc.parentId,
        accountType: acc.accountType,
        nature: acc.nature,
        initialDebit: initialDebitBalance,
        initialCredit: initialCreditBalance,
        debitTurnover: perD,
        creditTurnover: perC,
        totalDebit: totD,
        totalCredit: totC,
        debitBalance,
        creditBalance,
        preClosingDebit: debitBalance,
        preClosingCredit: creditBalance,
      };
    };

    // If level is single level
    if (targetLevel === 'group' || targetLevel === 'general' || targetLevel === 'subsidiary') {
      return allAccs.filter(a => a.level === targetLevel).map(buildRow);
    }

    // If level is detailed
    if (targetLevel === 'detailed') {
      const detailedRows: TrialBalanceRow[] = [];
      for (const det of detailedMap.values()) {
        const parentAcc = accMap.get(det.accountId);
        const totD = det.initialDebit + det.periodDebit;
        const totC = det.initialCredit + det.periodCredit;
        const diff = totD - totC;
        const debitBalance = diff > 0 ? diff : 0;
        const creditBalance = diff < 0 ? Math.abs(diff) : 0;

        const initDiff = det.initialDebit - det.initialCredit;

        detailedRows.push({
          accountId: det.accountId,
          code: `${parentAcc?.code || '0000'}-${det.detailedId || 'D'}`,
          name: `${det.detailedName} (${parentAcc?.name || 'حساب معین'})`,
          level: 'detailed',
          parentId: det.accountId,
          accountType: parentAcc?.accountType || 'asset',
          nature: parentAcc?.nature || 'debit',
          initialDebit: initDiff > 0 ? initDiff : 0,
          initialCredit: initDiff < 0 ? Math.abs(initDiff) : 0,
          debitTurnover: det.periodDebit,
          creditTurnover: det.periodCredit,
          totalDebit: totD,
          totalCredit: totC,
          debitBalance,
          creditBalance,
          preClosingDebit: debitBalance,
          preClosingCredit: creditBalance,
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
            const totD = det.initialDebit + det.periodDebit;
            const totC = det.initialCredit + det.periodCredit;
            const diff = totD - totC;
            const debitBalance = diff > 0 ? diff : 0;
            const creditBalance = diff < 0 ? Math.abs(diff) : 0;
            const initDiff = det.initialDebit - det.initialCredit;

            resultRows.push({
              accountId: det.accountId,
              code: `${sub.code}-${det.detailedId || 'D'}`,
              name: `↳ ${det.detailedName}`,
              level: 'detailed',
              parentId: sub.id,
              accountType: sub.accountType,
              nature: sub.nature,
              initialDebit: initDiff > 0 ? initDiff : 0,
              initialCredit: initDiff < 0 ? Math.abs(initDiff) : 0,
              debitTurnover: det.periodDebit,
              creditTurnover: det.periodCredit,
              totalDebit: totD,
              totalCredit: totC,
              debitBalance,
              creditBalance,
              preClosingDebit: debitBalance,
              preClosingCredit: creditBalance,
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

    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const uniqueVoucherIds = new Set<number>();

    const items = rawRows.map((r, idx) => {
      uniqueVoucherIds.add(r.voucherId);
      const d = Number(r.debit) || 0;
      const c = Number(r.credit) || 0;
      totalDebit += d;
      totalCredit += c;
      runningBalance += (d - c);

      return {
        rowNumber: idx + 1,
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        manualVoucherNumber: r.manualVoucherNumber || undefined,
        date: r.date,
        voucherType: r.voucherType,
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountLevel: r.accountLevel,
        detailedName: r.detailedName || undefined,
        detailedType: r.detailedType || undefined,
        currency: r.itemCurrency || r.voucherCurrency || 'IRR',
        description: r.itemDescription || r.voucherDescription || '',
        debit: d,
        credit: c,
        runningBalance,
      };
    });

    return {
      items,
      totalDebit,
      totalCredit,
      vouchersCount: uniqueVoucherIds.size,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
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
    const cashAndBankBalance = cashItems.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

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

    // Currency Breakdowns across all active vouchers
    const currencyVoucherItems = await orm.select({
      itemCurrency: journalVoucherItems.currency,
      voucherCurrency: journalVouchers.currency,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      voucherId: journalVouchers.id,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(
      eq(journalVouchers.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ));

    const curMap = new Map<string, { totalDebit: number; totalCredit: number; vouchers: Set<number> }>();
    for (const row of currencyVoucherItems) {
      const cur = row.itemCurrency || row.voucherCurrency || 'IRR';
      let entry = curMap.get(cur);
      if (!entry) {
        entry = { totalDebit: 0, totalCredit: 0, vouchers: new Set() };
        curMap.set(cur, entry);
      }
      entry.totalDebit += Number(row.debit || 0);
      entry.totalCredit += Number(row.credit || 0);
      entry.vouchers.add(row.voucherId);
    }

    const currencyBreakdowns: CurrencyFinancialSummary[] = Array.from(curMap.entries()).map(([cur, data]) => ({
      currency: cur,
      totalDebit: data.totalDebit,
      totalCredit: data.totalCredit,
      netBalance: data.totalDebit - data.totalCredit,
      vouchersCount: data.vouchers.size,
    }));

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
      description: string;
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
      periodConditions.push(like(journalVoucherItems.detailedName, `%${params.detailedName.trim()}%`));
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
    let openingBalance = 0;
    if (params.startDate) {
      const priorConditions = periodConditions.filter(c => c !== undefined);
      // بازسازی شرط‌ها بدون شرط startDate: همان فیلترها ولی date < startDate
      const priorConds: any[] = [
        eq(journalVouchers.isDeleted, 0),
        or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
      ];
      if (params.accountId) priorConds.push(eq(journalVoucherItems.accountId, params.accountId));
      if (params.detailedType && params.detailedType !== 'all') priorConds.push(eq(journalVoucherItems.detailedType, params.detailedType));
      if (params.detailedId) priorConds.push(eq(journalVoucherItems.detailedId, params.detailedId));
      if (params.detailedName) priorConds.push(like(journalVoucherItems.detailedName, `%${params.detailedName.trim()}%`));
      if (params.currency && params.currency !== 'all') priorConds.push(or(
        eq(journalVoucherItems.currency, params.currency),
        eq(journalVouchers.currency, params.currency)
      ));
      if (params.startDate) priorConds.push(lt(journalVouchers.date, params.startDate));

      const priorRows = await orm.select({
        debit: journalVoucherItems.debit,
        credit: journalVoucherItems.credit,
      })
      .from(journalVoucherItems)
      .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
      .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
      .where(and(...priorConds));

      for (const r of priorRows) {
        openingBalance += (Number(r.debit) || 0) - (Number(r.credit) || 0);
      }
    }
    openingBalance = Math.round(openingBalance * 10000) / 10000;

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const items = rawRows.map(r => {
      const d = Number(r.debit) || 0;
      const c = Number(r.credit) || 0;
      totalDebit += d;
      totalCredit += c;
      runningBalance += (d - c);

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
        debit: d,
        credit: c,
        runningBalance,
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
      } as any);
    }

    return {
      items,
      openingBalance,
      totalDebit,
      totalCredit,
      finalBalance: runningBalance,
    };
  }

  /**
   * Income Statement / Profit & Loss (صورت سود و زیان با پشتیبانی از ارز)
   */
  static async getIncomeStatement(params: { startDate?: string; endDate?: string; currency?: string }): Promise<{
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
    const trial = await this.getTrialBalance({ level: 'subsidiary', ...params });

    const revenues: { code: string; name: string; amount: number }[] = [];
    const costOfSales: { code: string; name: string; amount: number }[] = [];
    const operatingExpenses: { code: string; name: string; amount: number }[] = [];

    let totalRevenue = 0;
    let totalCostOfSales = 0;
    let totalOperatingExpenses = 0;

    for (const r of trial) {
      if (r.accountType === 'revenue') {
        const netAmt = r.creditTurnover - r.debitTurnover;
        if (netAmt !== 0) {
          revenues.push({ code: r.code, name: r.name, amount: netAmt });
          totalRevenue += netAmt;
        }
      } else if (r.accountType === 'cost_of_sales') {
        const netAmt = r.debitTurnover - r.creditTurnover;
        if (netAmt !== 0) {
          costOfSales.push({ code: r.code, name: r.name, amount: netAmt });
          totalCostOfSales += netAmt;
        }
      } else if (r.accountType === 'expense') {
        const netAmt = r.debitTurnover - r.creditTurnover;
        if (netAmt !== 0) {
          operatingExpenses.push({ code: r.code, name: r.name, amount: netAmt });
          totalOperatingExpenses += netAmt;
        }
      }
    }

    const grossProfit = totalRevenue - totalCostOfSales;
    const operatingProfit = grossProfit - totalOperatingExpenses;
    const netProfit = operatingProfit;

    return {
      revenues,
      totalRevenue,
      costOfSales,
      totalCostOfSales,
      grossProfit,
      operatingExpenses,
      totalOperatingExpenses,
      operatingProfit,
      netProfit,
    };
  }

  /**
   * Balance Sheet (ترازنامه با پشتیبانی از ارز)
   */
  static async getBalanceSheet(params: { date?: string; currency?: string }): Promise<{
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
    const trial = await this.getTrialBalance({ level: 'subsidiary', endDate: params.date, currency: params.currency });

    const currentAssets: { code: string; name: string; amount: number }[] = [];
    const nonCurrentAssets: { code: string; name: string; amount: number }[] = [];
    const currentLiabilities: { code: string; name: string; amount: number }[] = [];
    const equity: { code: string; name: string; amount: number }[] = [];

    let totalCurrentAssets = 0;
    let totalNonCurrentAssets = 0;
    let totalCurrentLiabilities = 0;
    let totalEquity = 0;

    let periodRevenues = 0;
    let periodExpenses = 0;

    for (const r of trial) {
      if (r.accountType === 'asset') {
        const netAmt = r.debitBalance - r.creditBalance;
        if (r.code.startsWith('1')) {
          currentAssets.push({ code: r.code, name: r.name, amount: netAmt });
          totalCurrentAssets += netAmt;
        } else {
          nonCurrentAssets.push({ code: r.code, name: r.name, amount: netAmt });
          totalNonCurrentAssets += netAmt;
        }
      } else if (r.accountType === 'liability') {
        const netAmt = r.creditBalance - r.debitBalance;
        currentLiabilities.push({ code: r.code, name: r.name, amount: netAmt });
        totalCurrentLiabilities += netAmt;
      } else if (r.accountType === 'equity') {
        const netAmt = r.creditBalance - r.debitBalance;
        equity.push({ code: r.code, name: r.name, amount: netAmt });
        totalEquity += netAmt;
      } else if (r.accountType === 'revenue') {
        periodRevenues += (r.creditTurnover - r.debitTurnover);
      } else if (r.accountType === 'expense' || r.accountType === 'cost_of_sales') {
        periodExpenses += (r.debitTurnover - r.creditTurnover);
      }
    }

    const netProfitPeriod = periodRevenues - periodExpenses;
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
    const totalLiabilitiesAndEquity = totalCurrentLiabilities + totalEquity + netProfitPeriod;

    return {
      currentAssets,
      totalCurrentAssets,
      nonCurrentAssets,
      totalNonCurrentAssets,
      totalAssets,
      currentLiabilities,
      totalCurrentLiabilities,
      equity,
      totalEquity,
      netProfitPeriod,
      totalLiabilitiesAndEquity,
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
    const conditions = [
      eq(journalVouchers.isDeleted, 0),
      or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))
    ];

    if (params?.startDate) {
      conditions.push(gte(journalVouchers.date, params.startDate));
    }
    if (params?.endDate) {
      conditions.push(lte(journalVouchers.date, params.endDate));
    }

    const currencyItems = await orm.select({
      itemCurrency: journalVoucherItems.currency,
      voucherCurrency: journalVouchers.currency,
      debit: journalVoucherItems.debit,
      credit: journalVoucherItems.credit,
      voucherId: journalVouchers.id,
    })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(...conditions));

    const curMap = new Map<string, { totalDebit: number; totalCredit: number; vouchers: Set<number> }>();
    for (const row of currencyItems) {
      const cur = row.itemCurrency || row.voucherCurrency || 'IRR';
      let entry = curMap.get(cur);
      if (!entry) {
        entry = { totalDebit: 0, totalCredit: 0, vouchers: new Set() };
        curMap.set(cur, entry);
      }
      entry.totalDebit += Number(row.debit || 0);
      entry.totalCredit += Number(row.credit || 0);
      entry.vouchers.add(row.voucherId);
    }

    const currencies: CurrencyFinancialSummary[] = Array.from(curMap.entries()).map(([cur, data]) => ({
      currency: cur,
      totalDebit: data.totalDebit,
      totalCredit: data.totalCredit,
      netBalance: data.totalDebit - data.totalCredit,
      vouchersCount: data.vouchers.size,
    }));

    return {
      currencies,
      totalCurrenciesCount: currencies.length,
      activeCurrencies: Array.from(curMap.keys()),
    };
  }

  /**
   * Financial Overview Stats for Accounting Dashboard
   */
  static async getFinancialOverviewStats(): Promise<FinancialSummaryStats> {
    const banks = await TreasuryService.getBankAccounts();
    const totalCashAndBank = banks.reduce((sum, b) => sum + (Number(b.currentBalance) || 0), 0);

    const trial = await this.getTrialBalance({ level: 'general' });

    let totalReceivables = 0;
    let totalPayables = 0;
    let totalRevenues = 0;
    let totalCostOfSales = 0;
    let totalExpenses = 0;

    for (const r of trial) {
      if (r.code === '12' || r.code === '11') {
        totalReceivables += r.debitBalance;
      } else if (r.code === '30' || r.code === '31' || r.code === '32') {
        totalPayables += r.creditBalance;
      } else if (r.accountType === 'revenue') {
        totalRevenues += (r.creditTurnover - r.debitTurnover);
      } else if (r.accountType === 'cost_of_sales') {
        totalCostOfSales += (r.debitTurnover - r.creditTurnover);
      } else if (r.accountType === 'expense') {
        totalExpenses += (r.debitTurnover - r.creditTurnover);
      }
    }

    // Cheques stats
    const allCheques = await orm.select().from(cheques).where(eq(cheques.isDeleted, 0));
    let totalChequesInCollection = 0;
    let totalChequesReceived = 0;
    let totalChequesPaid = 0;

    for (const c of allCheques) {
      const amt = Number(c.amount) || 0;
      if (c.type === 'received') {
        totalChequesReceived += amt;
        if (c.status === 'in_collection' || c.status === 'in_treasury' || c.status === 'received') {
          totalChequesInCollection += amt;
        }
      } else {
        if (c.status !== 'passed' && c.status !== 'returned') {
          totalChequesPaid += amt;
        }
      }
    }

    const [vCount] = await orm.select({ count: sql<number>`count(*)` })
      .from(journalVouchers)
      .where(eq(journalVouchers.isDeleted, 0));

    return {
      totalCashAndBank,
      totalReceivables,
      totalPayables,
      totalChequesInCollection,
      totalChequesReceived,
      totalChequesPaid,
      totalRevenues,
      totalCostOfSales,
      totalExpenses,
      netProfit: totalRevenues - totalCostOfSales - totalExpenses,
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

    const rows = banks.map(b => {
      let opening = Number(b.initialBalance) || 0;
      let receipts = 0;
      let payments = 0;
      for (const t of txs) {
        if (Number(t.bankAccountId) !== b.id || t.status === 'voided') continue;
        const inPeriod = (!start || String(t.date).slice(0, 10) >= start) && (String(t.date).slice(0, 10) <= end);
        const amt = Number(t.amount) || 0;
        if (inPeriod) {
          if (t.type === 'receipt') receipts += amt; else payments += amt;
        } else if (!start || String(t.date).slice(0, 10) < start) {
          opening += t.type === 'receipt' ? amt : -amt;
        }
      }
      return {
        accountId: b.id,
        title: b.title,
        type: b.type,
        currency: b.currency || 'IRR',
        opening: Math.round(opening * 10000) / 10000,
        receipts: Math.round(receipts * 10000) / 10000,
        payments: Math.round(payments * 10000) / 10000,
        closing: Math.round((opening + receipts - payments) * 10000) / 10000,
      };
    });

    // روند ماهانه بر مبنای همه حساب‌ها در بازه
    const monthMap = new Map<string, { receipts: number; payments: number }>();
    for (const t of txs) {
      if (t.status === 'voided') continue;
      const d = String(t.date).slice(0, 10);
      if (start && d < start) continue;
      if (d > end) continue;
      const monthKey = d.slice(0, 7);
      const agg = monthMap.get(monthKey) || { receipts: 0, payments: 0 };
      if (t.type === 'receipt') agg.receipts += Number(t.amount) || 0;
      else agg.payments += Number(t.amount) || 0;
      monthMap.set(monthKey, agg);
    }
    const months = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        receipts: Math.round(v.receipts * 10000) / 10000,
        payments: Math.round(v.payments * 10000) / 10000,
        net: Math.round((v.receipts - v.payments) * 10000) / 10000,
      }));

    const totals = rows.reduce((acc, r) => ({
      opening: acc.opening + r.opening,
      receipts: acc.receipts + r.receipts,
      payments: acc.payments + r.payments,
      closing: acc.closing + r.closing,
    }), { opening: 0, receipts: 0, payments: 0, closing: 0 });

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
        debit: sql<number>`COALESCE(SUM(${journalVoucherItems.debit}), 0)`,
        credit: sql<number>`COALESCE(SUM(${journalVoucherItems.credit}), 0)`,
      })
      .from(journalVoucherItems)
      .innerJoin(accounts, eq(journalVoucherItems.accountId, accounts.id))
      .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
      .where(and(
        eq(journalVouchers.isDeleted, 0),
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
    const expected: Record<string, number> = { '1101': 0, '1102': 0, '1103': 0, '3101': 0 };
    const counts: Record<string, number> = { '1101': 0, '1102': 0, '1103': 0, '3101': 0 };
    for (const c of allCheques) {
      let codeKey: string | null = null;
      if (c.type === 'received') {
        codeKey = statusToCode[String(c.status)]?.code || null;
      } else if (String(c.status) !== 'passed') {
        codeKey = '3101';
      }
      if (codeKey) {
        expected[codeKey] += Number(c.amount) || 0;
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
      const ledgerBalance = Math.round(((Number(lr?.debit) || 0) - (Number(lr?.credit) || 0)) * 10000) / 10000;
      const expectedBalance = Math.round((expected[code] || 0) * 10000) / 10000;
      return {
        code,
        title: lr?.title || titles[code],
        ledgerBalance,
        expectedBalance,
        discrepancy: Math.round((ledgerBalance - expectedBalance) * 10000) / 10000,
        counts: { ledger: 0, cheques: counts[code] || 0 },
      };
    });
  }
}
