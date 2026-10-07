/**
 * v9.0.108 (TD-563، B03-21): قرارداد مشترک سرور و مرورگر برای صورت سود و زیان و ترازنامه.
 * `AccountingReportService.getIncomeStatement` / `getBalanceSheet` همین شکل را برمی‌گردانند و نماهای
 * `IncomeStatementView` / `BalanceSheetView` همین کلیدها را می‌خوانند؛ پیش‌تر نوع مرورگر کلیدهای دیگری
 * (`totalRevenues`، `expenses`، `assets`، `liabilities`) اعلام می‌کرد و صفحه سرجمع درآمد ۰ و ردیف‌های خالی نشان می‌داد.
 */

export interface StatementRow {
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatementReport {
  revenues: StatementRow[];
  totalRevenue: number;
  costOfSales: StatementRow[];
  totalCostOfSales: number;
  grossProfit: number;
  operatingExpenses: StatementRow[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  currentAssets: StatementRow[];
  totalCurrentAssets: number;
  nonCurrentAssets: StatementRow[];
  totalNonCurrentAssets: number;
  totalAssets: number;
  currentLiabilities: StatementRow[];
  totalCurrentLiabilities: number;
  equity: StatementRow[];
  totalEquity: number;
  /** سود (زیان) حساب‌های موقت تا تاریخ ترازنامه که هنوز به حقوق صاحبان سهام بسته نشده است */
  netProfitPeriod: number;
  totalLiabilitiesAndEquity: number;
}

/** حاشیه سود خالص به درصد (سود خالص ÷ درآمد × ۱۰۰)؛ بی درآمد `null` */
export function netProfitMarginPercent(report: Pick<IncomeStatementReport, 'netProfit' | 'totalRevenue'> | null | undefined): number | null {
  const revenue = Number(report?.totalRevenue ?? 0);
  if (!Number.isFinite(revenue) || revenue === 0) return null;
  return (Number(report?.netProfit ?? 0) / revenue) * 100;
}

/** ردیف‌های امن یک بخش (پاسخ ناقص یا قدیمی آرایه نمی‌دهد) */
export function statementRows(rows: unknown): StatementRow[] {
  return Array.isArray(rows) ? (rows as StatementRow[]) : [];
}
