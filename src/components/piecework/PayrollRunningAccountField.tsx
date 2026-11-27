import { useId } from 'react';
import { AlertCircle, UserCheck } from 'lucide-react';
import { formatCurrencyLabel, formatPersianPrice } from '../../utils';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';

/**
 * v12 colleague and partner sales, part B (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.3, owner's decision 3.3):
 * «کسر از حساب جاری همکار» on the payslip. What the colleague owes on their running account (3208: their purchases, petty
 * cash in hand) is offered; the payslip deducts at most that, its voucher credits 3208 on the colleague's detail and the net
 * comes down by it. The field shows only for a colleague who owes something, or a payslip that already deducts.
 */
export const RUNNING_ACCOUNT_DEDUCTION_TEXT = {
  label: 'کسر از حساب جاری همکار',
  owed: 'بدهی همکار در حساب جاری:',
  applyAll: 'کسر کل بدهی',
  exceeds: 'کسر از حساب جاری از بدهی همکار در حساب جاری بیشتر است؛ فیش با این مبلغ ذخیره نمی‌شود.',
  explain: 'در سند فیش، این مبلغ «حساب جاری همکار» را بستانکار می‌کند (بدهی همکار بابت خرید یا تنخواه کم می‌شود) و از خالص پرداختی کم می‌شود.',
} as const;

/** whether the deduction is above what the colleague owes (`debt` null: the balance was not read, nothing to compare) */
export const runningDeductionExceedsDebt = (value: number, debt: number | null, alreadyDeducted = 0): boolean =>
  debt !== null && value > debt + alreadyDeducted;

interface Props {
  value: number;
  onChange: (value: number) => void;
  /** what the colleague owes on 3208 now, or null when it was not read */
  debt: number | null;
  /** a draft payslip's own deduction, already credited in its draft voucher, so it adds to the ceiling */
  alreadyDeducted?: number;
}

export function PayrollRunningAccountField({ value, onChange, debt, alreadyDeducted = 0 }: Props) {
  const id = useId();
  const rial = useRialDisplay();
  const ceiling = debt === null ? null : debt + alreadyDeducted;
  if (!(ceiling !== null && ceiling > 0) && !(value > 0)) return null;
  const exceeds = runningDeductionExceedsDebt(value, debt, alreadyDeducted);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="text-xs font-bold text-slate-700">{`${RUNNING_ACCOUNT_DEDUCTION_TEXT.label} (${formatCurrencyLabel('IRR')}، اختیاری)`}</label>
        {ceiling !== null && ceiling > 0 && (
          <button type="button" onClick={() => onChange(ceiling)} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer">
            {`${RUNNING_ACCOUNT_DEDUCTION_TEXT.applyAll} (${formatPersianPrice(ceiling, 'IRR')})`}
          </button>
        )}
      </div>
      <DecimalInput id={id} min="0" value={value || ''} onValueChange={(v) => onChange(Math.max(0, Number(v) || 0))}
        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono" />
      <RialEquivalent value={value} />
      {ceiling !== null && ceiling > 0 && (
        <div className="mt-1.5 p-2 bg-indigo-50/70 border border-indigo-100 rounded-lg text-[11px] text-indigo-900 font-bold flex items-center justify-between">
          <span className="flex items-center gap-1"><UserCheck size={13} className="text-indigo-600" />{RUNNING_ACCOUNT_DEDUCTION_TEXT.owed}</span>
          <span className="font-mono font-black">{rial.amount(ceiling)}</span>
        </div>
      )}
      {exceeds && (
        <p className="text-[10px] text-rose-700 mt-1 font-bold flex items-center gap-1"><AlertCircle size={12} />{RUNNING_ACCOUNT_DEDUCTION_TEXT.exceeds}</p>
      )}
      {value > 0 && <p className="text-[10px] text-indigo-700 mt-1 font-bold leading-5">{RUNNING_ACCOUNT_DEDUCTION_TEXT.explain}</p>}
    </div>
  );
}

/** The payslip's own row of the deduction, beside «کسر از مساعده و وام پرسنلی» */
export function PayslipRunningAccountRow({ amount }: { amount?: number | string | null }) {
  const rial = useRialDisplay();
  if (!((Number(amount) || 0) > 0)) return null;
  return (
    <div className="flex justify-between font-bold text-indigo-700">
      <span>{`${RUNNING_ACCOUNT_DEDUCTION_TEXT.label}:`}</span>
      <span className="font-mono">-{rial.amount(Number(amount))}</span>
    </div>
  );
}
