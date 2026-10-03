import { describe, expect, it } from 'vitest';
import { gregorianToJalali, isoToJalaliDate, isStorageDate, toStorageDate } from '../../utils/calendarDate';
import { jalaliToGregorian } from '../../utils/dateUtils';

// v7.0.131 (TD-232): مبدل مشترک تاریخ ذخیره (میلادی ISO) و نمایش (شمسی)
describe('toStorageDate', () => {
  it('converts Jalali input in every accepted shape to Gregorian ISO', () => {
    expect(toStorageDate('1405/07/10')).toBe('2026-10-02');
    expect(toStorageDate('1405-7-10')).toBe('2026-10-02');
    expect(toStorageDate('۱۴۰۵/۰۷/۱۰')).toBe('2026-10-02');
    expect(toStorageDate('١٤٠٥/٠٧/١٠')).toBe('2026-10-02');
    expect(toStorageDate('1405/07/10 14:30')).toBe('2026-10-02');
  });

  it('keeps Gregorian input and pads it', () => {
    expect(toStorageDate('2026-10-02')).toBe('2026-10-02');
    expect(toStorageDate('2026/10/2')).toBe('2026-10-02');
    expect(toStorageDate('2026-10-02T18:30:00Z')).toBe('2026-10-02');
  });

  it('returns empty string for empty input and null for invalid input', () => {
    expect(toStorageDate('')).toBe('');
    expect(toStorageDate('   ')).toBe('');
    expect(toStorageDate(null)).toBe('');
    expect(toStorageDate(undefined)).toBe('');
    for (const bad of ['abc', '1405/13/01', '1405/07/31', '1404/12/30', '2026-02-29', '2026-10-32', '10/02/2026', '07-10-1405 AP', '1250/01/01', '1600/01/01', '2300-01-01']) {
      expect(toStorageDate(bad), bad).toBeNull();
    }
  });

  it('accepts 30 Esfand only in a Jalali leap year', () => {
    expect(toStorageDate('1403/12/30')).toBe('2025-03-20');
    expect(toStorageDate('1404/12/30')).toBeNull();
  });
});

describe('isoToJalaliDate', () => {
  it('turns stored ISO dates (and Jalali input) into padded Jalali for pickers and comparisons', () => {
    expect(isoToJalaliDate('2026-10-02')).toBe('1405/07/10');
    expect(isoToJalaliDate('2025-03-20')).toBe('1403/12/30');
    expect(isoToJalaliDate('2025-03-21')).toBe('1404/01/01');
    expect(isoToJalaliDate('1405-7-1')).toBe('1405/07/01');
    expect(isoToJalaliDate('')).toBe('');
    expect(isoToJalaliDate('abc')).toBe('');
  });

  it('isStorageDate accepts only canonical ISO', () => {
    expect(isStorageDate('2026-10-02')).toBe(true);
    expect(isStorageDate('2026-10-2')).toBe(false);
    expect(isStorageDate('1405-07-10')).toBe(false);
    expect(isStorageDate('')).toBe(false);
  });
});

describe('calendar parity', () => {
  it('round-trips every Jalali day of 1300..1500 and matches the browser fa-IR calendar', () => {
    const intl = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    const mismatches: string[] = [];
    for (let jy = 1300; jy <= 1500; jy++) {
      for (let jm = 1; jm <= 12; jm++) {
        const maxDay = jm <= 6 ? 31 : jm <= 11 ? 30 : 30;
        for (let jd = 1; jd <= maxDay; jd++) {
          const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
          const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
          if (ry !== jy || rm !== jm || rd !== jd) continue; // ۳۰ اسفند سال عادی = ۱ فروردین سال بعد
          const parts = intl.formatToParts(new Date(Date.UTC(gy, gm - 1, gd)));
          const p = (t: string) => Number(parts.find(x => x.type === t)?.value);
          if (p('year') !== jy || p('month') !== jm || p('day') !== jd) mismatches.push(`${jy}/${jm}/${jd}`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
