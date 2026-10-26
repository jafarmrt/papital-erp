import { ValidationError } from '../../../errors/customErrors.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function jalali(iso: string): string {
  return toPersianDigits(isoToJalaliDate(iso) || iso);
}

/** v11 phase 6.1a (M12): a cheque falls due on or after the day it was issued */
export function assertChequeDueAfterIssue(issueIso: string, dueIso: string): void {
  if (dueIso >= issueIso) return;
  throw new ValidationError(
    `تاریخ سررسید چک (${jalali(dueIso)}) نمی‌تواند پیش از تاریخ صدور آن (${jalali(issueIso)}) باشد.`,
    { issueDate: issueIso, dueDate: dueIso },
    'CHEQUE_DUE_BEFORE_ISSUE',
  );
}

/** the latest day among the cheque's issue date and the days of its earlier steps (legacy non-ISO entries are skipped) */
export function lastChequeStepDay(issueDate: string, history: unknown): string {
  const days = [issueDate, ...(Array.isArray(history) ? history : []).map(h => String((h as { date?: unknown })?.date ?? ''))]
    .filter(d => ISO_DAY.test(d))
    .map(d => d.slice(0, 10));
  return days.reduce((a, b) => (b > a ? b : a), '');
}

/**
 * v11 phase 6.1a (M12): a cheque step is dated on or after the cheque's previous step. Before, a «پاس شده» dated the day
 * before the receipt was accepted and its clearing voucher came before the receipt voucher in the journal.
 */
export function assertChequeStepAfterPrevious(actionIso: string, issueDate: string, history: unknown): void {
  const last = lastChequeStepDay(issueDate, history);
  if (!last || actionIso >= last) return;
  throw new ValidationError(
    `تاریخ اقدام چک (${jalali(actionIso)}) نمی‌تواند پیش از گام قبلی آن (${jalali(last)}) باشد.`,
    { actionDate: actionIso, previousStepDate: last },
    'CHEQUE_STEP_BEFORE_PREVIOUS',
  );
}
