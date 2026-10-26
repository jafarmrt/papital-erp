import type { DbExecutor } from '../../db/drizzle.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isoToJalaliDate, jalaliYearBounds } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { earliestVoucherYear } from './fiscalYearOrder.js';

/**
 * v11 phase 6.1a (M9): the date a user gives a manual voucher (create, edit, reverse, correct) lies between the first day of
 * the earliest fiscal year the books know and the business today. The earliest year is the year of the oldest live voucher,
 * or the year before the current one when that is earlier, so last year's entries can still be made on a new install.
 * Before, a manual voucher took any day: one dated 1990 (a typo) opened the fiscal year 1368, and every later year-end close
 * was refused until 1368 was closed; one dated next year sat in the journal before its day. Treasury, stock and payroll
 * dates already refused a day after today (`resolveTreasuryWriteDate`, `assertStockMovementDate`).
 */
export async function assertManualVoucherDate(tx: DbExecutor, iso: string, label: string): Promise<void> {
  const today = await businessTodayIsoDate();
  if (iso > today) {
    throw new ValidationError(
      `${label} (${toPersianDigits(isoToJalaliDate(iso))}) نمی‌تواند پس از امروز (${toPersianDigits(isoToJalaliDate(today))}) باشد.`,
      { field: label, value: iso },
      'VOUCHER_DATE_IN_FUTURE',
    );
  }
  const previousYear = resolveJalaliFiscalYear(today) - 1;
  const oldest = await earliestVoucherYear(tx);
  const firstYear = oldest === null ? previousYear : Math.min(oldest, previousYear);
  const firstDay = jalaliYearBounds(firstYear)?.firstDay;
  if (firstDay && iso < firstDay) {
    throw new ValidationError(
      `${label} (${toPersianDigits(isoToJalaliDate(iso))}) پیش از نخستین سال مالی دفترها (${toPersianDigits(firstYear)}) است؛ تاریخ را بررسی کنید.`,
      { field: label, value: iso, firstFiscalYear: firstYear },
      'VOUCHER_DATE_TOO_EARLY',
    );
  }
}
