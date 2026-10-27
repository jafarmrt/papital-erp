import { ShieldCheck } from 'lucide-react';
import { errorMessageOf, formatCurrencyLabel, formatPersianPrice } from '../../utils';
import type { StatutoryAmounts } from '../../lib/payroll/statutoryDeductions';
import {
  STATUTORY_ENTRY_KEYS, statutoryAmountsOf, statutoryEntryError, statutoryNeedsReason, type PayrollStatutoryEntry,
} from '../../lib/payroll/statutoryForm';
import { useStatutoryPreviewQuery } from '../../hooks/queries/usePayrollWindowQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { RialEquivalent } from '../common/RialEquivalent';

/**
 * v10.0.210 (TD-1087، طرح حقوق §۳.۳ بندهای ۳ و ۴، تصمیم ت۶ الف): بیمه سهم کارگر، سهم کارفرما و مالیات حقوق فرم صدور و ویرایش
 * فیش. پیشنهاد از سرور (`GET /piecework/statutory-preview`) روی ناخالص همین فرم می‌آید؛ کادر خالی همان پیشنهاد است و مبلغ دیگر
 * شرح می‌خواهد. سهم کارفرما از خالص کم نمی‌شود.
 */
interface Preview {
  suggestion: StatutoryAmounts;
  warning: string | null;
  covered: { insurance: boolean; tax: boolean };
}

const LABELS: Record<(typeof STATUTORY_ENTRY_KEYS)[number], string> = {
  employeeInsurance: 'بیمه سهم کارگر',
  employerInsurance: 'بیمه سهم کارفرما (از خالص کم نمی‌شود)',
  incomeTax: 'مالیات حقوق',
};

const fieldClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono';

export function PayrollStatutoryFields({ personnelId, startDate, endDate, gross, entry, onChange }: {
  personnelId: number | '';
  startDate: string;
  endDate: string;
  gross: number;
  entry: PayrollStatutoryEntry;
  onChange: (next: PayrollStatutoryEntry) => void;
}) {
  // 10.3 (ARCH review finding 3): the suggestion comes from the shared cache under `piecework`, so a payslip change that
  // invalidates that domain refreshes an open form; each gross, period or personnel is its own entry
  const complete = Boolean(personnelId && startDate && endDate);
  const previewQuery = useStatutoryPreviewQuery<Partial<Preview> | null>(
    complete ? { personnelId: Number(personnelId), startDate, endDate, gross } : null,
  );
  // only a suggestion read for this form whose last read succeeded is offered (a failed refresh shows the error alone)
  const previewRead = useOpeningRead(previewQuery, true);
  const answer = complete ? previewRead.current : null;
  const preview = answer?.suggestion && answer.covered ? answer as Preview : null;
  const error = complete && previewRead.error ? errorMessageOf(previewRead.error) : null;

  if (!personnelId || !startDate || !endDate) return null;
  if (preview && !preview.covered.insurance && !preview.covered.tax) {
    return <p className="text-[10px] text-slate-500 font-bold">این پرسنل مشمول بیمه و مالیات حقوق نیست؛ فیش کسور قانونی ندارد.</p>;
  }
  const suggestion = preview?.suggestion ?? null;
  const shown = suggestion ? statutoryAmountsOf(entry, suggestion) : null;
  const entryError = statutoryEntryError(entry);
  const needsReason = statutoryNeedsReason(entry, suggestion);
  const anyEntered = STATUTORY_ENTRY_KEYS.some(k => entry[k].trim() !== '');
  const cur = formatCurrencyLabel('IRR');

  return (
    <div className="p-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-black text-indigo-900"><ShieldCheck size={14} /> بیمه و مالیات حقوق</div>
      {error && <p className="text-[10px] text-rose-700 font-bold">{error}</p>}
      {preview?.warning && <p className="text-[10px] text-amber-700 font-bold leading-5">{preview.warning}</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {STATUTORY_ENTRY_KEYS.map(key => (
          <div key={key}>
            <label htmlFor={`payroll-statutory-${key}`} className="block text-[11px] font-bold text-slate-700 mb-1">{`${LABELS[key]} (${cur})`}</label>
            <input
              id={`payroll-statutory-${key}`}
              inputMode="decimal"
              value={entry[key]}
              placeholder={suggestion ? formatPersianPrice(Number(suggestion[key])) : ''}
              onChange={(e) => onChange({ ...entry, [key]: e.target.value })}
              className={fieldClass}
            />
            <RialEquivalent value={entry[key]} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 font-bold leading-5">
        کادر خالی یعنی مبلغ محاسبه‌شده از نرخ‌های سال پایان دوره
        {shown ? `: کارگر ${formatPersianPrice(Number(shown.employeeInsurance))}، کارفرما ${formatPersianPrice(Number(shown.employerInsurance))}، مالیات ${formatPersianPrice(Number(shown.incomeTax))}.` : '.'}
      </p>
      {entryError && <p className="text-[10px] text-rose-700 font-bold">{entryError}</p>}
      {anyEntered && (
        <div>
          <label htmlFor="payroll-statutory-reason" className="block text-[11px] font-bold text-slate-700 mb-1">شرح تغییر بیمه یا مالیات</label>
          <input id="payroll-statutory-reason" type="text" maxLength={500} value={entry.reason}
            onChange={(e) => onChange({ ...entry, reason: e.target.value })}
            placeholder="چرا مبلغ با محاسبه سامانه فرق دارد" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800" />
          {needsReason && <p className="text-[10px] text-rose-700 mt-1 font-bold">مبلغ با محاسبه فرق دارد؛ فیش بی شرح تغییر صادر نمی‌شود.</p>}
        </div>
      )}
    </div>
  );
}
