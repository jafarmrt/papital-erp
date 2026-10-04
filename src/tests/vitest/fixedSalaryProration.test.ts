import { describe, expect, it } from 'vitest';
import { computeFixedSalaryShares, jalaliMonthDays, jalaliMonthsInPeriod, priorFixedGrantsOf } from '../../lib/payroll/fixedSalaryProration';

// v8.0.30 (TD-284، تصمیم مالک محصول — گزینه ب): حقوق ثابت برای هر ماه شمسیِ بازه، ماه ناقص به نسبت روزها
const SALARY = 10_000_000;

describe('fixed salary proration by Jalali month (TD-284)', () => {
  it('knows Jalali month lengths, Esfand of leap and common years included', () => {
    expect(jalaliMonthDays('1405/01')).toBe(31);
    expect(jalaliMonthDays('1405/07')).toBe(30);
    expect(jalaliMonthDays('1403/12')).toBe(30);
    expect(jalaliMonthDays('1404/12')).toBe(29);
  });

  it('splits a period into the Jalali months it covers', () => {
    // ۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۰۲/۳۱
    expect(jalaliMonthsInPeriod('2026-03-21', '2026-05-21')).toEqual([
      { month: '1405/01', coveredDays: 31, monthDays: 31 },
      { month: '1405/02', coveredDays: 31, monthDays: 31 },
    ]);
  });

  it('grants one month per Jalali month of a two-month period', () => {
    const shares = computeFixedSalaryShares(SALARY, '2026-03-21', '2026-05-21', []);
    expect(shares.total.toNumber()).toBe(2 * SALARY);
    expect(shares.months.map(m => m.amount)).toEqual(['10000000', '10000000']);
  });

  it('pro-rates half months and the two halves add up to exactly one month', () => {
    // ۱۴۰۵/۰۴/۰۱ تا ۱۴۰۵/۰۴/۱۵ و ۱۴۰۵/۰۴/۱۶ تا ۱۴۰۵/۰۴/۳۱ (ماه ۳۱ روزه)
    const first = computeFixedSalaryShares(SALARY, '2026-06-22', '2026-07-06', []);
    expect(first.total.toNumber()).toBe(4_838_710);
    const second = computeFixedSalaryShares(SALARY, '2026-07-07', '2026-07-22', first.months.map(m => ({ ...m })));
    expect(second.total.toNumber()).toBe(5_161_290);
    expect(first.total.add(second.total).toNumber()).toBe(SALARY);
  });

  it('never grants more than one month for overlapping periods', () => {
    const first = computeFixedSalaryShares(SALARY, '2026-06-22', '2026-07-06', []);
    const overlapping = computeFixedSalaryShares(SALARY, '2026-07-01', '2026-07-22', first.months.map(m => ({ ...m })));
    expect(first.total.add(overlapping.total).toNumber()).toBe(SALARY);
  });

  it('counts a payroll issued before the breakdown as the full month of its start date', () => {
    const legacy = priorFixedGrantsOf({ startDate: '2026-06-22', totalFixedAmount: SALARY, fixedSalaryMonths: [] });
    expect(legacy).toEqual([{ month: '1405/04', days: 31, amount: SALARY }]);
    expect(computeFixedSalaryShares(SALARY, '2026-07-07', '2026-07-22', legacy).total.toNumber()).toBe(0);
  });
});
