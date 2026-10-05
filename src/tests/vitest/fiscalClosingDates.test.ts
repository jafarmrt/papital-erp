import { describe, expect, it } from 'vitest';
import { jalaliYearBounds } from '../../utils/calendarDate';
import { fiscalClosingJalaliDates, fiscalClosingYearOptions } from '../../lib/fiscalClosingDates';

// v8.0.47 (TD-310): سال مالی همان سال شمسی است؛ آخرین روز آن در سال کبیسه ۳۰ اسفند است
describe('jalaliYearBounds', () => {
  it('ends a leap year on 30 Esfand and a common year on 29 Esfand', () => {
    expect(jalaliYearBounds(1403)).toEqual({ firstDay: '2024-03-20', lastDay: '2025-03-20', nextFirstDay: '2025-03-21' });
    expect(jalaliYearBounds(1404)).toEqual({ firstDay: '2025-03-21', lastDay: '2026-03-20', nextFirstDay: '2026-03-21' });
    expect(jalaliYearBounds(1387)?.lastDay).toBe('2009-03-20');
  });

  it('rejects years outside the calendar range', () => {
    expect(jalaliYearBounds(1500)).toBeNull();
    expect(jalaliYearBounds(1299)).toBeNull();
    expect(jalaliYearBounds(Number.NaN)).toBeNull();
  });
});

describe('fiscalClosingJalaliDates', () => {
  it('builds the closing form dates from the year itself', () => {
    expect(fiscalClosingJalaliDates('1403')).toEqual({ closingDate: '1403/12/30', openingDateNewYear: '1404/01/01' });
    expect(fiscalClosingJalaliDates(1404)).toEqual({ closingDate: '1404/12/29', openingDateNewYear: '1405/01/01' });
    expect(fiscalClosingJalaliDates('abc')).toEqual({ closingDate: '', openingDateNewYear: '' });
  });

  it('lists recent years up to the current one, so a new year after Nowruz is selectable', () => {
    expect(fiscalClosingYearOptions('1406')).toEqual(['1402', '1403', '1404', '1405', '1406']);
  });
});
