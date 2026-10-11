import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';
import { STATUTORY_OVERRIDE_REASON_MAX, statutoryOverridden, type StatutoryAmounts } from './statutoryDeductions.js';

/**
 * v10.0.201 (TD-1087، طرح حقوق §۳.۳، تصمیم ت۶ الف): کسورات قانونی فرم صدور و ویرایش فیش. کادر خالی یعنی پیشنهاد سرور؛
 * فرم فقط مبلغی را می‌فرستد که کاربر نوشته، تا سرور پیشنهاد را روی ناخالص واقعی فیش حساب کند. مبلغ دیگر شرح می‌خواهد.
 */
export interface PayrollStatutoryEntry {
  employeeInsurance: string;
  employerInsurance: string;
  incomeTax: string;
  reason: string;
}

export const EMPTY_STATUTORY_ENTRY: PayrollStatutoryEntry = { employeeInsurance: '', employerInsurance: '', incomeTax: '', reason: '' };

export const STATUTORY_ENTRY_KEYS = ['employeeInsurance', 'employerInsurance', 'incomeTax'] as const;

const entered = (raw: string): string | undefined => {
  const clean = normalizeDecimalString(raw ?? '');
  return clean === '' ? undefined : clean;
};

/** بدنه درخواست: فقط مبلغ‌های نوشته‌شده و شرح وقتی دست‌کم یک مبلغ نوشته شده باشد */
export function statutoryPayloadOf(entry: PayrollStatutoryEntry): Partial<Record<(typeof STATUTORY_ENTRY_KEYS)[number], string>> & { statutoryOverrideReason?: string } {
  const out: Partial<Record<(typeof STATUTORY_ENTRY_KEYS)[number], string>> & { statutoryOverrideReason?: string } = {};
  for (const key of STATUTORY_ENTRY_KEYS) {
    const v = entered(entry[key]);
    if (v !== undefined) out[key] = v;
  }
  const reason = entry.reason.trim().slice(0, STATUTORY_OVERRIDE_REASON_MAX);
  if (Object.keys(out).length > 0 && reason) out.statutoryOverrideReason = reason;
  return out;
}

/** مبلغ‌هایی که با در نظر گرفتن کادرهای خالی روی فیش می‌نشیند */
export function statutoryAmountsOf(entry: PayrollStatutoryEntry, suggestion: StatutoryAmounts): StatutoryAmounts {
  return {
    employeeInsurance: entered(entry.employeeInsurance) ?? suggestion.employeeInsurance,
    employerInsurance: entered(entry.employerInsurance) ?? suggestion.employerInsurance,
    incomeTax: entered(entry.incomeTax) ?? suggestion.incomeTax,
  };
}

const STATUTORY_ENTRY_LABELS: Record<(typeof STATUTORY_ENTRY_KEYS)[number], string> = {
  employeeInsurance: 'بیمه سهم کارگر',
  employerInsurance: 'بیمه سهم کارفرما',
  incomeTax: 'مالیات حقوق',
};

/** کادری که عدد نامنفی نیست؛ هرگز صفر خوانده نمی‌شود */
export function statutoryEntryError(entry: PayrollStatutoryEntry): string | null {
  for (const key of STATUTORY_ENTRY_KEYS) {
    const v = entered(entry[key]);
    if (v !== undefined && (!DECIMAL_PATTERN.test(v) || v.startsWith('-'))) return `«${STATUTORY_ENTRY_LABELS[key]}» باید عدد نامنفی باشد.`;
  }
  return null;
}

/** مبلغی جز پیشنهاد بی شرح؟ همان قاعده سرور (۴۲۲ `PAYROLL_STATUTORY_OVERRIDE_REASON_REQUIRED`) */
export function statutoryNeedsReason(entry: PayrollStatutoryEntry, suggestion: StatutoryAmounts | null): boolean {
  if (!suggestion || statutoryEntryError(entry)) return false;
  return statutoryOverridden(statutoryAmountsOf(entry, suggestion), suggestion) && !entry.reason.trim();
}
