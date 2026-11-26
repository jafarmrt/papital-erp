import { useState } from 'react';
import type { WorkLogImportResult } from '../../lib/historyImport/workLogImport';
import { workLogRowKey, type ResolvedWorkLogRow } from '../../lib/historyImport/workLogSheet';
import { formatPersianDate, formatPersianNumber, jalaliMonthLabel, toPersianDigits } from '../../utils';

/** «اردیبهشت ۱۴۰۵» for `1405-02` */
export const jalaliMonthLabelOf = (month: string): string => jalaliMonthLabel(month.replace('-', '/'));

/**
 * v12 work-log import: each colleague's total in each month (to catch a typo such as 1031 for 103 before the post), then
 * every row with what the server said of it. A row like one already recorded waits for «تکراری نیست، ثبت شود».
 */
interface Props {
  resolved: ResolvedWorkLogRow[];
  result: WorkLogImportResult | null;
  accepted: ReadonlySet<string>;
  personName: (id: number) => string;
  taskTitle: (id: number) => string;
  projectTitle: (id: number | null) => string;
  amountText: (amount: string | number) => string;
  onAccept: (key: string, on: boolean) => void;
}

/** A colleague already has work in the books in the month: the import dates its rows on the last day, so they are not held */
export const BOOKED_MONTH_NOTE = 'برای همکارانی که در همین ماه کارکردی در برنامه دارند، پیش از ثبت ببینید آن کارکرد در اکسل هم نیامده باشد؛ ردیف‌های اکسل در روز آخر ماه ثبت می‌شوند و با کارکرد روزهای دیگر تکراری شمرده نمی‌شوند.';

export function WorkLogImportPreview({ resolved, result, accepted, personName, taskTitle, projectTitle, amountText, onAccept }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const outcomeOf = (rowNo: number) => result?.rows.find(o => o.rowNo === rowNo);
  const ready = resolved.filter(r => r.status === 'ready');
  const shown = onlyProblems
    ? ready.filter(r => { const o = outcomeOf(r.parsed.rowNo); return !o || o.status !== 'ok' || !!o.warnings?.length; })
    : ready;
  const skipped = resolved.filter(r => r.status === 'skipped');

  const statusCell = (r: Extract<ResolvedWorkLogRow, { status: 'ready' }>) => {
    const o = outcomeOf(r.parsed.rowNo);
    if (!o) return <span className="text-slate-500">پیش‌نمایش را دوباره بزنید</span>;
    const warnings = o.warnings?.map(w => <span key={w} className="block text-amber-700 dark:text-amber-400">{w}</span>);
    if (o.status === 'error') return <span className="text-rose-600 font-bold">{o.message}</span>;
    if (o.status === 'duplicate') {
      const key = workLogRowKey(r.parsed);
      return (
        <span className="text-amber-700 dark:text-amber-400">
          {o.message}
          <label className="flex items-center gap-1 mt-1 text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={accepted.has(key)} onChange={e => onAccept(key, e.target.checked)} />
            تکراری نیست، ثبت شود
          </label>
        </span>
      );
    }
    return <span className="text-emerald-700 dark:text-emerald-400">{result?.committed ? 'ثبت شد' : 'درست است'}{warnings}</span>;
  };

  return (
    <div className="space-y-4">
      {result && result.totals.length > 0 && (
        <div className="overflow-x-auto">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">جمع کارکرد هر همکار در هر ماه (ردیف‌های درست)</p>
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr><th className="p-2">ماه</th><th className="p-2">همکار</th><th className="p-2">شمار ردیف</th><th className="p-2">جمع</th><th className="p-2">پیش‌تر در برنامه در همین ماه</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {result.totals.map(t => (
                <tr key={`${t.month}-${t.personnelId}`}>
                  <td className="p-2 whitespace-nowrap">{jalaliMonthLabelOf(t.month)}</td>
                  <td className="p-2">{personName(t.personnelId)}</td>
                  <td className="p-2">{formatPersianNumber(t.rows)}</td>
                  <td className="p-2 font-bold whitespace-nowrap">{amountText(t.amount)}</td>
                  <td className={`p-2 whitespace-nowrap ${t.bookedRows > 0 ? 'font-bold text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>
                    {t.bookedRows > 0 ? `${formatPersianNumber(t.bookedRows)} ردیف، ${amountText(t.bookedAmount)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.totals.some(t => t.bookedRows > 0) && (
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-1">{BOOKED_MONTH_NOTE}</p>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
        فقط ردیف‌های دارای ایراد یا هشدار
      </label>
      <div className="overflow-x-auto max-h-[50vh]">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 sticky top-0">
            <tr>
              <th className="p-2">ردیف</th>
              <th className="p-2">روز ثبت</th>
              <th className="p-2">همکار</th>
              <th className="p-2">عنوان کاری</th>
              <th className="p-2">پروژه</th>
              <th className="p-2">مقدار</th>
              <th className="p-2">فی</th>
              <th className="p-2">مبلغ</th>
              <th className="p-2">نتیجه</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map(r => {
              if (r.status !== 'ready') return null;
              const o = outcomeOf(r.parsed.rowNo);
              return (
                <tr key={workLogRowKey(r.parsed)} className="align-top">
                  <td className="p-2 whitespace-nowrap">{formatPersianNumber(r.parsed.rowNo)}</td>
                  <td className="p-2 whitespace-nowrap">{o?.date ? formatPersianDate(o.date) : jalaliMonthLabelOf(r.row.month)}</td>
                  <td className="p-2">{personName(r.row.personnelId)}</td>
                  <td className="p-2">{taskTitle(r.row.taskId)}</td>
                  <td className="p-2">{projectTitle(r.row.projectId)}</td>
                  <td className="p-2 whitespace-nowrap">{toPersianDigits(r.row.quantity)}</td>
                  <td className="p-2 whitespace-nowrap">{amountText(r.row.unitRate)}</td>
                  <td className="p-2 font-bold whitespace-nowrap">{o?.amount ? amountText(o.amount) : ''}</td>
                  <td className="p-2 min-w-[14rem]">{statusCell(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <details className="text-[11px] text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer">{formatPersianNumber(skipped.length)} ردیف کارکرد نیست و کنار گذاشته شد</summary>
          <ul className="list-disc pr-5 mt-1 space-y-0.5">
            {skipped.map(r => <li key={workLogRowKey(r.parsed)}>ردیف {formatPersianNumber(r.parsed.rowNo)} — {r.parsed.personName} — {r.status === 'skipped' ? r.reason : ''}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
