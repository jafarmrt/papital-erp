import { Calendar } from 'lucide-react';
import { formatPersianDate } from '../../../utils';
import { JalaliDateInput } from '../../common/JalaliDateInput';

/**
 * v9.0.116 (TD-566، B03-24): کادر تاریخ در سرآیند هر صورت مالی. ترازنامه و نسبت‌ها «تا تاریخ» دارند و صورت سود و زیان
 * دوره خودش را («از» و «تا»)؛ تاریخ‌ها ISO‌اند و زیرنویس می‌گوید گزارش تا کی یا برای کدام دوره است.
 * پیش‌تر ترازنامه و نسبت‌ها همیشه «تا امروز» بودند و صورت سود و زیان بی‌صدا تاریخ‌های زیربرگه تراز آزمایشی را می‌گرفت.
 */

const INPUT_CLASS = 'w-28 px-2 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500';

/** «تا تاریخ …» یا «تا امروز» */
export function asOfCaption(asOfDate: string): string {
  return asOfDate ? `تا تاریخ ${formatPersianDate(asOfDate)}` : 'تا امروز';
}

/** دوره صورت سود و زیان به زبان کاربر */
export function periodCaption(startDate: string, endDate: string): string {
  const from = startDate ? formatPersianDate(startDate) : 'آغاز دفاتر';
  const to = endDate ? formatPersianDate(endDate) : 'امروز';
  return `دوره: از ${from} تا ${to}`;
}

export function AsOfDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Calendar className="w-3.5 h-3.5 text-slate-400" />
      <span>تا تاریخ:</span>
      <JalaliDateInput value={value} onChange={onChange} placeholder="امروز" className={INPUT_CLASS} containerClassName="inline-block" />
      {value && (
        <button type="button" onClick={() => onChange('')} className="text-rose-500 hover:text-rose-700 px-1 cursor-pointer">
          امروز
        </button>
      )}
    </div>
  );
}

interface PeriodFieldsProps {
  startDate: string;
  endDate: string;
  onChange: (period: { startDate: string; endDate: string }) => void;
}

export function PeriodFields({ startDate, endDate, onChange }: PeriodFieldsProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
      <Calendar className="w-3.5 h-3.5 text-slate-400" />
      <span>از:</span>
      <JalaliDateInput value={startDate} onChange={iso => onChange({ startDate: iso, endDate })} placeholder="آغاز دفاتر" className={INPUT_CLASS} containerClassName="inline-block" />
      <span>تا:</span>
      <JalaliDateInput value={endDate} onChange={iso => onChange({ startDate, endDate: iso })} placeholder="امروز" className={INPUT_CLASS} containerClassName="inline-block" />
      {(startDate || endDate) && (
        <button type="button" onClick={() => onChange({ startDate: '', endDate: '' })} className="text-rose-500 hover:text-rose-700 px-1 cursor-pointer">
          پاک‌کردن
        </button>
      )}
    </div>
  );
}
