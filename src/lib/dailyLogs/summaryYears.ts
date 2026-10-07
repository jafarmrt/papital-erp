import { getTodayJalaliDate } from '../../utils/dateUtils';

/** How many past Jalali years the monthly management summary offers besides the current one */
export const SUMMARY_PAST_YEARS = 5;

/**
 * v9.0.239 (TD-632, finding B13-07): the years of the monthly management summary come from the business today (the
 * current Jalali year and the five before it), plus the selected year when it is outside that range. The picker was a
 * fixed 1402 to 1405, so from Nowruz 1406 the current year could not be chosen.
 */
export function summaryYearOptions(selectedYear: string, todayJalali: string = getTodayJalaliDate()): string[] {
  const current = Number(todayJalali.slice(0, 4));
  const years = Number.isInteger(current) && current > 0
    ? Array.from({ length: SUMMARY_PAST_YEARS + 1 }, (_, i) => String(current - i))
    : [];
  if (/^\d{4}$/.test(selectedYear) && !years.includes(selectedYear)) years.push(selectedYear);
  return years.sort((a, b) => Number(b) - Number(a));
}
