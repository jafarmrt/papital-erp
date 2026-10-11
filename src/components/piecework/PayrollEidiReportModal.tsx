import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, FileSpreadsheet } from 'lucide-react';
import { fetchJson } from '../../api';
import { errorMessageOf, getTodayJalaliDate } from '../../utils';
import { toPersianDigits } from '../../utils/persianNumber';
import { toLatinDigits } from '../../lib/numericInput';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { eidiMethodLabel, eidiReportFileName, eidiReportSheetRows, type EidiReport } from '../../lib/payroll/eidiReport';

/**
 * v10.0.212 (TD-1089، طرح حقوق §۳.۸): گزارش «عیدی سال» — حق عیدی، سهم فیش‌های پیش‌نویس، سقف، فیش عیدی صادرشده، پرداخت‌شده
 * و مانده هر پرسنل، با خروجی اکسل.
 */
export function PayrollEidiReportModal({ onClose }: { onClose: () => void }) {
  const rial = useRialDisplay();
  const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<EidiReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError(null);
    fetchJson(`/piecework/reports/eidi?year=${year}`, { signal: controller.signal })
      .then((res: EidiReport) => { if (!controller.signal.aborted) setReport(res); })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(errorMessageOf(err)); });
    return () => controller.abort();
  }, [year]);

  const exportExcel = async () => {
    if (!report || report.rows.length === 0) return;
    try {
      const xlsx = await import('xlsx');
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(eidiReportSheetRows(report)), 'عیدی سال');
      xlsx.writeFile(book, eidiReportFileName(year));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خروجی اکسل ساخته نشد');
    }
  };

  const cell = 'px-3 py-2 text-xs font-bold text-slate-700';
  const money = (v: string | null) => (v === null ? '—' : rial.amount(Number(v)));
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-slate-900">عیدی سال</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 flex flex-wrap items-center gap-2 shrink-0">
          <select aria-label="سال" value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {[thisYear - 1, thisYear].map(y => <option key={y} value={y}>{toPersianDigits(String(y))}</option>)}
          </select>
          {report && <span className="text-xs font-bold text-slate-600">{`روش: ${eidiMethodLabel(report.method)}`}</span>}
          <button type="button" onClick={() => void exportExcel()} disabled={!report || report.rows.length === 0}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={14} /> خروجی اکسل
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">
          {error && <p className="text-xs text-rose-700 font-bold">{error}</p>}
          {report && report.rows.length === 0 && <p className="text-xs text-slate-500 font-bold">در این سال عیدی‌ای انباشته یا صادر نشده است.</p>}
          {report && report.rows.length > 0 && (
            <table className="w-full text-right border border-slate-200 rounded-xl overflow-hidden">
              <thead className="bg-slate-50">
                <tr>{['نام پرسنل', 'حق عیدی', 'سهم فیش‌های پیش‌نویس', 'سقف سال', 'فیش عیدی صادرشده', 'پرداخت‌شده', 'مانده'].map(h => <th key={h} className={`${cell} font-black`}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.personnelId} className="border-t border-slate-100">
                    <td className={cell}>{r.fullName}</td>
                    <td className={`${cell} font-mono`}>{money(r.due)}</td>
                    <td className={`${cell} font-mono`}>{money(r.draftShares)}</td>
                    <td className={`${cell} font-mono`}>{money(r.cap)}</td>
                    <td className={`${cell} font-mono`}>{money(r.issued)}</td>
                    <td className={`${cell} font-mono`}>{money(r.paid)}</td>
                    <td className={`${cell} font-mono`}>{money(r.remaining)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 bg-slate-50 font-black">
                  <td className={cell}>جمع</td>
                  <td className={`${cell} font-mono`}>{money(report.totals.due)}</td>
                  <td className={cell} colSpan={2} />
                  <td className={`${cell} font-mono`}>{money(report.totals.issued)}</td>
                  <td className={`${cell} font-mono`}>{money(report.totals.paid)}</td>
                  <td className={`${cell} font-mono`}>{money(report.totals.remaining)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-slate-500 font-bold leading-5 mt-2">حق عیدی در روش درصدی جمع سهم فیش‌های تأییدشده است و در دو روش دیگر حق سال به نسبت روزهای همکاری. خروجی اکسل مبلغ‌ها را به ریال دارد.</p>
        </div>
      </div>
    </div>
  );
}
