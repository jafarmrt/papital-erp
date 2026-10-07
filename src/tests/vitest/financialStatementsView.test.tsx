import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { IncomeStatementView } from '../../components/accounting/reports/IncomeStatementView';
import { BalanceSheetView } from '../../components/accounting/reports/BalanceSheetView';
import type { BalanceSheetReport, IncomeStatementReport } from '../../lib/accounting/financialStatements';

/**
 * v9.0.108 (TD-563، B03-21): صورت سود و زیان و ترازنامه کلیدهای پاسخ سرور را می‌خوانند.
 * پاسخ‌ها با نوع مشترک سرور (`getIncomeStatement` / `getBalanceSheet` همین نوع را برمی‌گردانند) ساخته می‌شوند.
 * روی v9.0.107 سرجمع درآمد ۰، حاشیه ۰٪، ردیف هزینه خالی و ترازنامه بی ردیف دارایی و بدهی بود.
 */

afterEach(cleanup);

// درآمد ۱٬۰۰۰٬۰۰۰٬۰۰۰، بهای فروش ۶۰۰٬۰۰۰٬۰۰۰، هزینه اداری ۱۵۰٬۰۰۰٬۰۰۰ ← سود ناخالص ۴۰۰ و سود خالص ۲۵۰ میلیون، حاشیه ۲۵٪
const incomeStatement: IncomeStatementReport = {
  revenues: [{ code: '5001', name: 'فروش کالا', amount: 1_000_000_000 }],
  totalRevenue: 1_000_000_000,
  costOfSales: [{ code: '6001', name: 'بهای تمام‌شده کالای فروش‌رفته', amount: 600_000_000 }],
  totalCostOfSales: 600_000_000,
  grossProfit: 400_000_000,
  operatingExpenses: [{ code: '6101', name: 'هزینه حقوق اداری', amount: 150_000_000 }],
  totalOperatingExpenses: 150_000_000,
  operatingProfit: 250_000_000,
  netProfit: 250_000_000,
};

// صندوق ۳۰۰ (جاری) + ماشین‌آلات ۲۰۰ (غیرجاری) = ۵۰۰؛ پرداختنی ۱۲۰ + سرمایه ۳۰۰ + سود دوره ۸۰ = ۵۰۰ میلیون
const balanceSheet: BalanceSheetReport = {
  currentAssets: [{ code: '1001', name: 'صندوق', amount: 300_000_000 }],
  totalCurrentAssets: 300_000_000,
  nonCurrentAssets: [{ code: '2001', name: 'ماشین‌آلات', amount: 200_000_000 }],
  totalNonCurrentAssets: 200_000_000,
  totalAssets: 500_000_000,
  currentLiabilities: [{ code: '3001', name: 'حساب‌های پرداختنی تجاری', amount: 120_000_000 }],
  totalCurrentLiabilities: 120_000_000,
  equity: [{ code: '4001', name: 'سرمایه', amount: 300_000_000 }],
  totalEquity: 300_000_000,
  netProfitPeriod: 80_000_000,
  totalLiabilitiesAndEquity: 500_000_000,
};

describe('financial statements read the server keys (TD-563)', () => {
  it('income statement: revenue total, a 25% net margin in Persian digits and the expense rows', () => {
    render(<IncomeStatementView incomeStatement={incomeStatement} startDate="" endDate="" onPeriodChange={() => {}} onApplyIncomeFilter={() => {}} />);
    const revenueHeader = screen.getByText('درآمدهای عملیاتی و فروش (الف)').parentElement!;
    expect(revenueHeader.textContent).toContain('۱,۰۰۰,۰۰۰,۰۰۰');
    expect(screen.getByText('حاشیه سود خالص:').parentElement!.textContent).toContain('۲۵٪');
    const expenseBox = screen.getByText('هزینه‌های عمومی، اداری و تشکیلاتی (ج)').closest('div.border') as HTMLElement;
    expect(within(expenseBox).getByText('6101 - هزینه حقوق اداری')).toBeTruthy();
    expect(within(expenseBox).queryByText('ثبتی یافت نشد')).toBeNull();
    const costBox = screen.getByText('بهای تمام شده کالای فروش رفته (ب)').parentElement!;
    expect(costBox.textContent).toContain('۶۰۰,۰۰۰,۰۰۰');
  });

  it('income statement without revenue shows no margin instead of ۰٪', () => {
    render(<IncomeStatementView incomeStatement={{ ...incomeStatement, revenues: [], totalRevenue: 0, netProfit: -150_000_000 }} startDate="" endDate="" onPeriodChange={() => {}} onApplyIncomeFilter={() => {}} />);
    expect(screen.getByText('حاشیه سود خالص:').parentElement!.textContent).not.toContain('٪');
  });

  it('balance sheet: asset, liability and equity rows and the period profit add up to both totals', () => {
    const { container } = render(<BalanceSheetView balanceSheet={balanceSheet} asOfDate="" onAsOfDateChange={() => {}} onApplyBalanceSheetFilter={() => {}} />);
    const text = container.textContent || '';
    expect(text).toContain('1001 - صندوق');
    expect(text).toContain('2001 - ماشین‌آلات');
    expect(text).toContain('3001 - حساب‌های پرداختنی تجاری');
    expect(text).toContain('4001 - سرمایه');
    expect(screen.getByText('سود (زیان) دوره').parentElement!.textContent).toContain('۸۰,۰۰۰,۰۰۰');
    expect(screen.getByText('دارایی‌های جاری').parentElement!.textContent).toContain('۳۰۰,۰۰۰,۰۰۰');
    expect(screen.getByText('دارایی‌های غیرجاری').parentElement!.textContent).toContain('۲۰۰,۰۰۰,۰۰۰');
    expect(screen.getAllByText('۵۰۰,۰۰۰,۰۰۰')).toHaveLength(2);
    expect(screen.queryByText('اطلاعاتی ثبت نشده است')).toBeNull();
  });
});
