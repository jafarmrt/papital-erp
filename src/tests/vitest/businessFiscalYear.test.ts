import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveJalaliFiscalYear } from '../../lib/businessClock';

// v8.0.48 (TD-311): سال مالی پیش‌فرض (بی‌تاریخ) سال امروزِ ساعت توافقی تهران است، نه «سال میلادی UTC − ۶۲۱»
describe('resolveJalaliFiscalYear without a date', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stays in the current Jalali year between 1 January and Nowruz', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z')); // ۲۵ دی ۱۴۰۴
    expect(resolveJalaliFiscalYear()).toBe(1404);
    expect(resolveJalaliFiscalYear('')).toBe(1404);
  });

  it('moves to the new year at midnight of Nowruz in Tehran, not at UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T20:15:00Z')); // ۲۳:۴۵ تهران ۲۹ اسفند ۱۴۰۴
    expect(resolveJalaliFiscalYear()).toBe(1404);
    vi.setSystemTime(new Date('2026-03-20T20:45:00Z')); // ۰۰:۱۵ تهران ۱ فروردین ۱۴۰۵
    expect(resolveJalaliFiscalYear()).toBe(1405);
  });

  it('still reads the year from an explicit date', () => {
    expect(resolveJalaliFiscalYear('2026-03-20')).toBe(1404);
    expect(resolveJalaliFiscalYear('2026-03-21')).toBe(1405);
    expect(resolveJalaliFiscalYear('1405/01/01')).toBe(1405);
  });
});
