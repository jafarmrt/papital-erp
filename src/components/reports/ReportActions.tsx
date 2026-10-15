import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { errorMessageOf } from '../../utils';
import { EXPORT_FAILED_MESSAGE } from '../../lib/inventoryAudit/exportFileNames';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۵): دکمه‌های مشترک «خروجی اکسل» و «چاپ» زبانه‌های گزارش‌های مدیریتی. ساخت فایل
 * با زبانه است؛ این‌جا فقط دکمه در حین ساخت بسته می‌ماند و خطا به کاربر گفته می‌شود. چاپ همان صفحه است با سربرگ چاپی.
 */

interface ReportActionsProps {
  onExport: () => Promise<void>;
  disabled?: boolean;
}

export function ReportActions({ onExport, disabled }: ReportActionsProps) {
  const [exporting, setExporting] = useState(false);
  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport();
    } catch (err) {
      toast.error(errorMessageOf(err) || EXPORT_FAILED_MESSAGE);
    } finally {
      setExporting(false);
    }
  };
  const button = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-2 no-print">
      <button
        type="button"
        onClick={() => void runExport()}
        disabled={disabled || exporting}
        className={`${button} bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100`}
      >
        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
        خروجی اکسل
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        disabled={disabled}
        className={`${button} bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50`}
      >
        <Printer className="w-4 h-4" />
        چاپ
      </button>
    </div>
  );
}
