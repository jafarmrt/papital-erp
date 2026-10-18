import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FinancialRatiosView } from '../../components/accounting/reports/FinancialRatiosView';
import { MaterialAttributeFields, MaterialNumberField, MaterialUnitSelect } from '../../components/project/materialFormFields';
import { FreeStockCell, MaterialNameCell, MaterialStatusCell, NotesCell } from '../../components/project/inventoryRowCells';
import type { MaterialRowState } from '../../lib/projects/materialAvailability';
import type { FinancialRatiosReport } from '../../types';

afterEach(cleanup);

// v10.1.72 (TD-1288): number fields show Persian digits and «٬» while typing
const SHOWN_THREE = '۳';

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
    for (const title of ['۱. نسبت‌های نقدینگی', '۲. نسبت‌های اهرمی و ساختار سرمایه', '۳. نسبت‌های سودآوری و بازدهی', '۴. نسبت‌های کارایی و گردش دارایی‌ها']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(container.querySelectorAll('.shadow-xs.space-y-2').length).toBe(15);
    expect(screen.getByText('نسبت جاری')).toBeTruthy();
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
    fireEvent.change(screen.getByDisplayValue(SHOWN_THREE), { target: { value: '7.5' } });
    expect(onNumber).toHaveBeenLastCalledWith(7.5);
    fireEvent.change(screen.getByDisplayValue('عدد'), { target: { value: 'متر' } });
    expect(onUnit).toHaveBeenLastCalledWith('متر');
    fireEvent.change(screen.getByDisplayValue('سفید'), { target: { value: 'مشکی' } });
    expect(onAttr).toHaveBeenLastCalledWith('color', 'مشکی');
    expect(screen.getByText('سایز / ابعاد')).toBeTruthy();
  });
});

describe('inventory row cells', () => {
  it('render name, free stock, status with shortfall and notes', () => {
    const onLink = vi.fn();
    const onOrder = vi.fn();
    const onNotes = vi.fn();
    const shortState: MaterialRowState = { kind: 'short', itemId: 4, free: 0, issued: 0, shortQty: 12, unit: 'برگ' };
    render(
      <table><tbody><tr>
        <MaterialNameCell displayCategory="کاغذ" effectiveName="کاغذ ترنسفر" effectiveCode="RM-1" onLinkWarehouse={onLink} />
        <FreeStockCell state={shortState} status="ready" />
        <MaterialStatusCell state={shortState} status="ready" procurementStatus="pending" onProcurementChange={onOrder} />
        <NotesCell value="" onChange={onNotes} />
      </tr></tbody></table>
    );
    expect(screen.getByText('کد: RM-1')).toBeTruthy();
    expect(screen.getByText('۰ برگ')).toBeTruthy();
    expect(screen.getByText(/کسری کل پروژه:/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('اتصال این ردیف به کالای موجود در انبار'));
    expect(onLink).toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'وضعیت سفارش' }), { target: { value: 'in_progress' } });
    expect(onOrder).toHaveBeenLastCalledWith('in_progress');
    fireEvent.change(screen.getByPlaceholderText('یادداشت...'), { target: { value: 'فوری' } });
    expect(onNotes).toHaveBeenLastCalledWith('فوری');
  });
});
