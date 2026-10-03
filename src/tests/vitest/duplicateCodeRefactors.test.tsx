import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FinancialRatiosView } from '../../components/accounting/reports/FinancialRatiosView';
import { MaterialAttributeFields, MaterialNumberField, MaterialUnitSelect } from '../../components/project/materialFormFields';
import { CurrentStockCell, MaterialNameCell, NotesCell, ProcurementStatusCell } from '../../components/project/inventoryRowCells';
import type { FinancialRatiosReport } from '../../types';

afterEach(cleanup);

// v7.0.140: کد مشترک استخراج‌شده (حذف تکرار) همان خروجی و رفتار قبلی را دارد
describe('FinancialRatiosView (data-driven cards)', () => {
  it('renders the four sections with every ratio, its value and the status badges', () => {
    const report = {
      currentRatio: 1.8, quickRatio: 1.1, cashRatio: 0.4, netWorkingCapital: 5000000,
      debtRatio: 42, debtToEquityRatio: 70, equityRatio: 58,
      grossMargin: 35, operatingMargin: 20, netProfitMargin: 12, returnOnAssets: 9, returnOnEquity: 15,
      assetTurnover: 2, receivablesTurnover: 6, inventoryTurnover: 4, inventoryTurnoverDays: 90,
      status: { liquidity: 'excellent', solvency: 'good', profitability: 'warning', efficiency: 'unknown', overallScore: 80 },
      currencyBreakdowns: [],
    } as unknown as FinancialRatiosReport;
    const { container } = render(<FinancialRatiosView ratiosData={report} onFetchFinancialRatios={() => {}} />);
    for (const title of ['۱. نسبت‌های نقدینگی (Liquidity Ratios)', '۲. نسبت‌های اهرمی و ساختار سرمایه (Solvency Ratios)', '۳. نسبت‌های سودآوری و بازدهی (Profitability Ratios)', '۴. نسبت‌های کارایی و گردش دارایی‌ها (Activity Ratios)']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(container.querySelectorAll('.shadow-xs.space-y-2').length).toBe(15);
    expect(screen.getByText('نسبت جاری (Current)')).toBeTruthy();
    expect(screen.getByText('دارایی جاری ÷ بدهی جاری (معیار: > ۱.۵)')).toBeTruthy();
    expect(screen.getByText('کل بدهی‌ها به کل دارایی‌ها (معیار: < ۵۰٪)')).toBeTruthy();
    expect(screen.getByText('۴۲٪')).toBeTruthy();
    expect(screen.getAllByText('روز').length).toBe(1);
    expect(screen.getAllByText('مرتبه').length).toBe(2);
    // نشان وضعیت: بالای صفحه ۴ و روی ۴ کارت؛ وضعیت نامشخص «بحرانی»
    expect(screen.getAllByText('عالی').length).toBe(2);
    expect(screen.getAllByText('بحرانی').length).toBe(2);
  });
});

describe('material form fields', () => {
  it('report numbers, units and attribute edits to the owning form', () => {
    const onNumber = vi.fn();
    const onUnit = vi.fn();
    const onAttr = vi.fn();
    render(
      <div>
        <MaterialNumberField label="نقطه سفارش اولیه" value={3} onChange={onNumber} />
        <MaterialUnitSelect value="عدد" onChange={onUnit} units={['عدد', 'متر']} />
        <MaterialAttributeFields color="سفید" material="" size="" onChange={onAttr} />
      </div>
    );
    fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '7.5' } });
    expect(onNumber).toHaveBeenLastCalledWith(7.5);
    fireEvent.change(screen.getByDisplayValue('عدد'), { target: { value: 'متر' } });
    expect(onUnit).toHaveBeenLastCalledWith('متر');
    fireEvent.change(screen.getByDisplayValue('سفید'), { target: { value: 'مشکی' } });
    expect(onAttr).toHaveBeenLastCalledWith('color', 'مشکی');
    expect(screen.getByText('سایز / ابعاد')).toBeTruthy();
  });
});

describe('inventory row cells', () => {
  it('render name, stock, status with shortfall and notes', () => {
    const onLink = vi.fn();
    const onStatus = vi.fn();
    const onNotes = vi.fn();
    render(
      <table><tbody><tr>
        <MaterialNameCell displayCategory="کاغذ" effectiveName="کاغذ ترنسفر" effectiveCode="RM-1" onLinkWarehouse={onLink} />
        <CurrentStockCell currentStock={0} unit="برگ" />
        <ProcurementStatusCell status="needs_procurement" onChange={onStatus} shortfall={12} unit="برگ" />
        <NotesCell value="" onChange={onNotes} />
      </tr></tbody></table>
    );
    expect(screen.getByText('کد: RM-1')).toBeTruthy();
    expect(screen.getByText('۰ برگ')).toBeTruthy();
    expect(screen.getByText(/کسری خرید:/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('اتصال این ردیف به کالای موجود در انبار'));
    expect(onLink).toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('⚠ نیاز به تامین / خرید'), { target: { value: 'available' } });
    expect(onStatus).toHaveBeenLastCalledWith('available');
    fireEvent.change(screen.getByPlaceholderText('یادداشت...'), { target: { value: 'فوری' } });
    expect(onNotes).toHaveBeenLastCalledWith('فوری');
  });
});
