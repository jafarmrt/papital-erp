import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import { formatPersianDate } from '../../utils';

// V10-3.2: مودال پیش‌نمایش چاپ یکدست (الگوی PieceworkPayslipModal)
// chrome مودال با no-print حذف و فقط ناحیه doc-print-area چاپ می‌شود.
export interface DocPrintMeta {
  label: string;
  value: React.ReactNode;
}

interface DocPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  meta?: DocPrintMeta[];
  footerNote?: string;
  children: React.ReactNode;
}

export function DocPrintModal({ isOpen, onClose, title, subtitle, meta = [], footerNote, children }: DocPrintModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('printing-doc');
      return () => {
        document.body.classList.remove('printing-doc');
      };
    }
    return undefined;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[88vh]">
        {/* Modal Chrome — در چاپ حذف */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800 rounded-t-2xl no-print shrink-0">
          <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Printer size={16} className="text-indigo-600" />
            پیش‌نمایش چاپ
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-600 font-bold flex items-center justify-center rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* Printable Area */}
        <div className="doc-print-area overflow-y-auto p-6 space-y-4 flex-1 print:p-0">
          <div className="text-center pb-3 border-b-2 border-dashed border-slate-300">
            <h2 className="text-base font-black text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
            <p className="text-[10px] text-slate-400 mt-1.5">تاریخ چاپ: {formatPersianDate(new Date())}</p>
          </div>

          {meta.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs" dir="rtl">
              {meta.map((m, i) => (
                <div key={`${m.label}-${i}`} className="flex justify-between items-baseline gap-2 py-1 border-b border-dashed border-slate-200">
                  <span className="text-slate-500 shrink-0">{m.label}:</span>
                  <span className="font-bold text-slate-800 text-left">{m.value}</span>
                </div>
              ))}
            </div>
          )}

          <div>{children}</div>

          {footerNote && (
            <p className="text-[11px] text-slate-600 leading-relaxed pt-2 border-t border-slate-200">{footerNote}</p>
          )}

          {/* Signatures */}
          <div className="border border-slate-200 rounded-xl p-4 grid grid-cols-3 gap-3 text-[11px] font-bold text-center pt-5">
            <div className="flex flex-col justify-between h-20">
              <span>تنظیم‌کننده</span>
              <div className="border-b border-dashed border-slate-400"></div>
            </div>
            <div className="flex flex-col justify-between h-20 border-l border-r border-slate-200 px-3">
              <span>تحویل‌گیرنده</span>
              <div className="border-b border-dashed border-slate-400"></div>
            </div>
            <div className="flex flex-col justify-between h-20">
              <span>تایید انبار</span>
              <div className="border-b border-dashed border-slate-400"></div>
            </div>
          </div>
        </div>

        {/* Modal Footer — در چاپ حذف */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2.5 bg-slate-50 dark:bg-slate-800 rounded-b-2xl no-print shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Printer size={14} />
            چاپ
          </button>
        </div>
      </div>
    </div>
  );
}

export default DocPrintModal;
