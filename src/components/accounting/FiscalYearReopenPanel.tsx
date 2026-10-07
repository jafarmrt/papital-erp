import { useState } from 'react';
import { Unlock } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHasPermission } from '../../contexts/AuthContext';
import { useReopenFiscalYear } from '../../hooks/accounting/useFiscalClosing';
import { errorMessageOf, toPersianDigits } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

/** v9.0.150 (TD-543): مجوز بازگشایی سال مالی (کاتالوگ مجوزها) */
export const FISCAL_REOPEN_PERMISSION = 'accounting.fiscal_reopen';

interface FiscalYearReopenPanelProps {
  /** آخرین سال بسته؛ null یعنی سالی بسته نیست */
  reopenableYear: number | null;
  onReopened?: (year: number) => void;
}

/**
 * v9.0.150 (TD-543، B03-01، تصمیم ت۲ مالک محصول): بازگشایی آخرین سال مالی بسته با دلیل الزامی، فقط برای دارنده مجوز
 * «بازگشایی سال مالی». پیش‌تر سال بسته‌شده در محصول باز نمی‌شد.
 */
export function FiscalYearReopenPanel({ reopenableYear, onReopened }: FiscalYearReopenPanelProps) {
  const canReopen = useHasPermission(FISCAL_REOPEN_PERMISSION);
  const reopen = useReopenFiscalYear();
  const [reason, setReason] = useState('');
  if (!canReopen || reopenableYear === null) return null;

  const year = reopenableYear;
  const faYear = toPersianDigits(year);
  const submit = async () => {
    const text = reason.trim();
    if (!text) {
      toast.error('دلیل بازگشایی سال مالی را بنویسید.');
      return;
    }
    const ok = await confirmAction({
      title: `بازگشایی سال مالی ${faYear}`,
      message: `سال مالی ${faYear} باز می‌شود و اسناد بستن آن، از جمله سند افتتاحیه سال ${toPersianDigits(year + 1)}، با سند برگشت هم‌تاریخ بی‌اثر می‌شوند. ادامه می‌دهید؟`,
      confirmText: 'بازگشایی سال',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    try {
      const result = await reopen.mutateAsync({ year, reason: text });
      toast.success(result.message);
      setReason('');
      onReopened?.(year);
    } catch (error) {
      toast.error(errorMessageOf(error) || 'خطا در بازگشایی سال مالی');
    }
  };

  return (
    <section aria-label="بازگشایی سال مالی" className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 shadow-sm space-y-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <Unlock className="w-5 h-5 text-sky-600" />
        بازگشایی سال مالی {faYear}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        فقط آخرین سال بسته باز می‌شود. اسناد بستن همین سال با سند برگشت هم‌تاریخ بی‌اثر می‌شوند و سال دوباره سند می‌پذیرد؛ پس از اصلاح، سال را دوباره ببندید.
      </p>
      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        دلیل بازگشایی
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-sky-500 outline-none"
        />
      </label>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={reopen.isPending || !reason.trim()}
        className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        بازگشایی سال مالی {faYear}
      </button>
    </section>
  );
}
