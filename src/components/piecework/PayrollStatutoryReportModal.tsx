import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, FileSpreadsheet } from 'lucide-react';
import { fetchJson } from '../../api';
import { errorMessageOf, getTodayJalaliDate } from '../../utils';
import { toPersianDigits } from '../../utils/persianNumber';
import { toLatinDigits } from '../../lib/numericInput';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { statutoryReportFileName, statutoryReportSheetRows, statutoryReportWithoutNote, type StatutoryReport } from '../../lib/payroll/statutoryReport';
import { DialogLayer } from '../common/DialogLayer';

/**
 * v10.0.211 (TD-1088، طرح حقوق §۳.۳ بند ۶، تصمیم ت۷ الف): «فهرست بیمه و مالیات» یک ماه جلالی — جمع حقوق، بیمه سهم کارگر
 * و کارفرما و مالیات فیش‌های تأییدشده هر پرسنل، با خروجی اکسل برای ارسال دستی به تأمین اجتماعی و سامانه مالیات. از v10.1.19
 * (TD-1269) پرسنل بی بیمه و مالیات در فهرست نمی‌آید و فقط شمارش آن نشان داده می‌شود.
 */
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export function PayrollStatutoryReportModal({ onClose }: { onClose: () => void }) {
  const rial = useRialDisplay();
  const today = toLatinDigits(getTodayJalaliDate());
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) || 1);
  const [report, setReport] = useState<StatutoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError(null);
    fetchJson(`/piecework/reports/statutory?year=${year}&month=${month}`, { signal: controller.signal })
      .then((res: StatutoryReport) => { if (!controller.signal.aborted) setReport(res); })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(errorMessageOf(err)); });
    return () => controller.abort();
  }, [year, month]);

  const exportExcel = async () => {
    if (!report || report.rows.length === 0) return;
    try {
      const xlsx = await import('xlsx');
      const sheet = xlsx.utils.json_to_sheet(statutoryReportSheetRows(report));
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, sheet, 'بیمه و مالیات');
      xlsx.writeFile(book, statutoryReportFileName(year, month));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خروجی اکسل ساخته نشد');
    }
  };

  const years = [year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i);
  const cell = 'px-3 py-2 text-xs font-bold text-slate-700';
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <DialogLayer onClose={onClose} />
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-slate-900">فهرست بیمه و مالیات ماهانه</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 flex flex-wrap items-center gap-2 shrink-0">
          <select aria-label="سال" value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {years.map(y => <option key={y} value={y}>{toPersianDigits(String(y))}</option>)}
          </select>
          <select aria-label="ماه" value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <button type="button" onClick={() => void exportExcel()} disabled={!report || report.rows.length === 0}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={14} /> خروجی اکسل
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto space-y-2">
          {error && <p className="text-xs text-rose-700 font-bold">{error}</p>}
          {report && report.draftPayslips > 0 && (
            <p className="text-[11px] text-amber-700 font-bold">{`${toPersianDigits(String(report.draftPayslips))} فیش پیش‌نویس این ماه هنوز تأیید نشده و در فهرست نیامده است.`}</p>
          )}
          {report && statutoryReportWithoutNote(report) && (
            <p className="text-[11px] text-slate-600 font-bold" data-testid="statutory-report-without">{statutoryReportWithoutNote(report)}</p>
          )}
          {report && report.rows.length === 0 && <p className="text-xs text-slate-500 font-bold">در این ماه فیش تأییدشده‌ای با بیمه یا مالیات حقوق نیست.</p>}
          {report && report.rows.length > 0 && (
            <table className="w-full text-right border border-slate-200 rounded-xl overflow-hidden">
              <thead className="bg-slate-50">
                <tr>{['نام پرسنل', 'کد ملی', 'تعداد فیش', 'حقوق و مزایا', 'بیمه سهم کارگر', 'بیمه سهم کارفرما', 'مالیات حقوق'].map(h => <th key={h} className={`${cell} font-black`}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.personnelId} className="border-t border-slate-100">
                    <td className={cell}>{r.fullName}</td>
                    <td className={`${cell} font-mono`}>{toPersianDigits(r.nationalId || '')}</td>
                    <td className={cell}>{toPersianDigits(String(r.payslips))}</td>
                    <td className={`${cell} font-mono`}>{rial.amount(Number(r.gross))}</td>
                    <td className={`${cell} font-mono`}>{rial.amount(Number(r.employeeInsurance))}</td>
                    <td className={`${cell} font-mono`}>{rial.amount(Number(r.employerInsurance))}</td>
                    <td className={`${cell} font-mono`}>{rial.amount(Number(r.incomeTax))}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 bg-slate-50 font-black">
                  <td className={cell} colSpan={3}>جمع</td>
                  <td className={`${cell} font-mono`}>{rial.amount(Number(report.totals.gross))}</td>
                  <td className={`${cell} font-mono`}>{rial.amount(Number(report.totals.employeeInsurance))}</td>
                  <td className={`${cell} font-mono`}>{rial.amount(Number(report.totals.employerInsurance))}</td>
                  <td className={`${cell} font-mono`}>{rial.amount(Number(report.totals.incomeTax))}</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-slate-500 font-bold leading-5">فقط فیش‌های تأییدشده و پرداخت‌شده‌ای که پایان دوره آن‌ها در همین ماه است، و فقط پرسنلی که بیمه یا مالیات حقوق دارند. خروجی اکسل مبلغ‌ها را به ریال دارد.</p>
        </div>
      </div>
    </div>
  );
}
