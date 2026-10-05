import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MovementAnalysisSection from '../../pages/reorder/MovementAnalysisSection';
import { bucketMovementsByJalaliMonth } from '../../services/inventory/monthlyMovementTrend';
import { jalaliMonthLabel, jalaliMonthStart } from '../../utils';

// v8.0.54 (TD-316): نمودار گردش کالا به ماه شمسی؛ پیش‌تر ماه میلادی با نام ماه شمسی روز اولش نمایش داده می‌شد
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: () => false,
}));

describe('monthly movement trend by Jalali month', () => {
  afterEach(() => { cleanup(); fetchJson.mockReset(); });

  it('puts 1 to 11 Farvardin in Farvardin, not Esfand', () => {
    const trends = bucketMovementsByJalaliMonth([
      { day: '2026-03-20', type: 'in', total: '2' },     // ۲۹ اسفند ۱۴۰۴
      { day: '2026-03-21', type: 'in', total: '3' },     // ۱ فروردین ۱۴۰۵
      { day: '2026-03-31', type: 'in', total: '4.5' },   // ۱۱ فروردین
      { day: '2026-04-20', type: 'out', total: '1' },    // ۳۱ فروردین
      { day: '2026-04-21', type: 'out', total: '6' },    // ۱ اردیبهشت
    ]);
    expect(trends).toEqual([
      { month: '1404/12', type: 'in', total: 2 },
      { month: '1405/01', type: 'in', total: 7.5 },
      { month: '1405/01', type: 'out', total: 1 },
      { month: '1405/02', type: 'out', total: 6 },
    ]);
  });

  it('starts the window on the first day of the Jalali month five months back', () => {
    expect(jalaliMonthStart('2026-10-05', 5)).toBe('2026-04-21'); // ۱ اردیبهشت ۱۴۰۵
    expect(jalaliMonthStart('2026-03-21', 1)).toBe('2026-02-20'); // ۱ اسفند ۱۴۰۴
    expect(jalaliMonthStart('2026-04-01', 0)).toBe('2026-03-21');
    expect(jalaliMonthLabel('1405/01')).toBe('فروردین ۱۴۰۵');
  });

  it('labels each bar with its Jalali month', async () => {
    fetchJson.mockResolvedValue({
      monthlyTrends: [
        { month: '1404/12', type: 'in', total: 2 },
        { month: '1405/01', type: 'in', total: 7 },
      ],
      fastMoving: [], slowMoving: [], deadStock: [],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MovementAnalysisSection />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText('اسفند ۱۴۰۴')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('فروردین ۱۴۰۵').length).toBeGreaterThan(0);
  });
});
