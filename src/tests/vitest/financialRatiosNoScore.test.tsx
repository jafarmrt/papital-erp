import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FinancialRatiosView } from '../../components/accounting/reports/FinancialRatiosView';
import type { FinancialRatiosReport } from '../../types';

afterEach(cleanup);

const banner = () => screen.getByText('امتیاز سلامت و پایداری مالی شرکت').closest('div.space-y-1\\.5') as HTMLElement;

// v9.0.119 (TD-575, B03-33): before any data arrived (or after an error) the ratios page showed a health score of «۷۵ از ۱۰۰»
// and «بحرانی» on every status, numbers the server never sent.
describe('financial ratios without data show no score (TD-575)', () => {
  it('no data: no score, no «از ۱۰۰», no status badge and no ratio values', () => {
    const { container } = render(<FinancialRatiosView ratiosData={null} onFetchFinancialRatios={() => {}} />);
    expect(banner().textContent).not.toContain('۷۵');
    expect(banner().textContent).not.toContain('از ۱۰۰');
    expect(banner().textContent).toContain('هنوز محاسبه نشده است');
    expect(container.textContent).not.toContain('بحرانی');
    expect(screen.getByText('نسبت جاری').parentElement!.textContent).toContain('—');
  });

  it('while loading it says so', () => {
    render(<FinancialRatiosView ratiosData={null} loading onFetchFinancialRatios={() => {}} />);
    expect(banner().textContent).toContain('در حال محاسبه…');
  });

  it('with data it shows the server score and statuses', () => {
    const report = {
      currentRatio: 1.8, quickRatio: 1.1, cashRatio: 0.4, netWorkingCapital: 5_000_000, debtRatio: 42,
      status: { liquidity: 'good', solvency: 'excellent', profitability: 'warning', efficiency: 'good', overallScore: 62 },
      currencyBreakdowns: [],
    } as unknown as FinancialRatiosReport;
    render(<FinancialRatiosView ratiosData={report} onFetchFinancialRatios={() => {}} />);
    expect(banner().textContent).toContain('۶۲');
    expect(banner().textContent).toContain('از ۱۰۰');
    expect(screen.getAllByText('مطلوب').length).toBeGreaterThan(0);
  });
});
