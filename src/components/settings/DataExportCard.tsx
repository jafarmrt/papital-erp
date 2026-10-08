import { useState } from 'react';
import { Database, Download } from 'lucide-react';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { useIsSystemAdmin } from '../../contexts/AuthContext';
import { getTodayIsoDate } from '../../utils/dateUtils';
import { dataExportRangeError, dataExportUrl } from '../../lib/system/dataExport';
import { dataExportGroupLabels } from '../../lib/system/dataExportTables';

/**
 * v9.0.386 (TD-592، تصمیم ت۷ الف): کارت خروجی داده‌های کسب‌وکاری. خروجی یک فایل zip است، هر جدول یک فایل؛ سجل ممیزی
 * فقط با گزینه جدا و یک بازه تاریخ. مسیر سرور فقط برای مدیر سامانه است، پس کارت هم فقط برای او نشان داده می‌شود؛
 * نام فایل را سرور با تاریخ امروز کسب‌وکار می‌دهد. v9.0.387 (TD-624): فهرست داده‌ها از گروه‌های `DATA_EXPORT_TABLES` است.
 */
export function DataExportCard() {
  const isSystemAdmin = useIsSystemAdmin();
  const today = getTodayIsoDate();
  const [activityLogs, setActivityLogs] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  if (!isSystemAdmin) return null;

  const choice = { activityLogs, from, to };
  const rangeError = dataExportRangeError(choice);

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5 space-y-3 shadow-2xs">
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
        <Database className="text-emerald-600" size={18} /> خروجی داده‌های کسب‌وکاری
      </h3>
      <p className="text-xs text-slate-600 leading-relaxed">
        این فایل برای گزارش‌گیری و بایگانی است و این داده‌ها را دارد: {dataExportGroupLabels().join('؛ ')}. رمزهای عبور و کلیدهای محرمانه در آن ذخیره نمی‌شوند.
      </p>
      <p className="text-xs text-slate-600 leading-relaxed">
        خروجی یک فایل فشرده zip است: هر جدول یک فایل جدا (هر سطر یک ردیف) و فهرست جدول‌ها با شمار ردیف‌ها در پرونده راهنمای آن.
      </p>
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-relaxed">
        توجه: این فایل نسخه پشتیبان قابل بازگردانی نیست. پشتیبان کامل پایگاه‌داده باید توسط مدیر کارساز با اسکریپت پشتیبان‌گیری برنامه گرفته شود (راهنما در مستندات نصب).
      </p>

      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={activityLogs} onChange={e => setActivityLogs(e.target.checked)} />
        همراه سجل ممیزی در یک بازه تاریخ
      </label>
      {activityLogs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-xs text-slate-600 mb-1">از تاریخ</span>
            <JalaliDateInput value={from} onChange={setFrom} />
          </div>
          <div>
            <span className="block text-xs text-slate-600 mb-1">تا تاریخ</span>
            <JalaliDateInput value={to} onChange={setTo} />
          </div>
          {rangeError && <p className="sm:col-span-2 text-xs text-rose-700" role="alert">{rangeError}</p>}
        </div>
      )}

      <div className="pt-2">
        {rangeError ? (
          <span className="px-5 py-3 bg-slate-300 text-white font-bold text-xs rounded-xl inline-flex items-center justify-center gap-2 w-full sm:w-auto cursor-not-allowed">
            <Download size={18} /> دانلود خروجی داده‌ها
          </span>
        ) : (
          <a
            href={dataExportUrl(choice)}
            download
            className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md w-full sm:w-auto inline-flex"
          >
            <Download size={18} /> دانلود خروجی داده‌ها
          </a>
        )}
      </div>
    </div>
  );
}
