import { ValidationError } from '../../../errors/customErrors.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function jalali(iso: string): string {
  return toPersianDigits(isoToJalaliDate(iso) || iso);
}

/**
 * v11 phase 6.1a (M12): a cheque the business writes (paid) falls due on or after the day it was issued. A received
 * cheque's issue date is the day it was recorded, and a customer's cheque that is already due on that day is recorded
 * as it is (review of #403), so the rule leaves received cheques alone.
 */
export function assertChequeDueAfterIssue(type: string, issueIso: string, dueIso: string): void {
  if (type !== 'paid' || dueIso >= issueIso) return;
  throw new ValidationError(
    `تاریخ سررسید چک (${jalali(dueIso)}) نمی‌تواند پیش از تاریخ صدور آن (${jalali(issueIso)}) باشد.`,
    { issueDate: issueIso, dueDate: dueIso },
    'CHEQUE_DUE_BEFORE_ISSUE',
  );
}

/**
 * the latest day among the cheque's issue date and the days of its earlier steps; legacy non-ISO entries are skipped, and
 * so is a day after `today`, which only a cheque recorded before v9.0.98 can hold (an issue date in the future), so its
 * steps are not blocked until that day comes
 */
export function lastChequeStepDay(issueDate: string, history: unknown, today?: string): string {
  const days = [issueDate, ...(Array.isArray(history) ? history : []).map(h => String((h as { date?: unknown })?.date ?? ''))]
    .filter(d => ISO_DAY.test(d))
    .map(d => d.slice(0, 10))
    .filter(d => !today || d <= today);
  return days.reduce((a, b) => (b > a ? b : a), '');
}

/**
 * v11 phase 6.1a (M12): a cheque step is dated on or after the cheque's previous step. Before, a «پاس شده» dated the day
 * before the receipt was accepted and its clearing voucher came before the receipt voucher in the journal.
 */
export function assertChequeStepAfterPrevious(actionIso: string, issueDate: string, history: unknown, today?: string): void {
  const last = lastChequeStepDay(issueDate, history, today);
  if (!last || actionIso >= last) return;
  throw new ValidationError(
    `تاریخ اقدام چک (${jalali(actionIso)}) نمی‌تواند پیش از گام قبلی آن (${jalali(last)}) باشد.`,
    { actionDate: actionIso, previousStepDate: last },
    'CHEQUE_STEP_BEFORE_PREVIOUS',
  );
}
