import React from 'react';
import { Printer } from 'lucide-react';
import { Modal } from './Modal';
import { useDocumentPrint } from '../../utils/printHelper';
import { formatPersianDate } from '../../utils';

export interface PrintMetaItem {
  label: string;
  value: React.ReactNode;
}

export interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  meta?: PrintMetaItem[];
  footerNote?: string;
  children: React.ReactNode;
  showSignatures?: boolean;
  printButtonText?: string;
  size?: 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  id?: string;
}

/**
 * Standard reusable Print Preview Modal for ERP V4.
 * Uses base Modal with useDocumentPrint hook and standardized print styling.
 */
export function PrintModal({
  isOpen,
  onClose,
  title,
  subtitle,
  meta = [],
  footerNote,
  children,
  showSignatures = true,
  printButtonText = 'چاپ سند',
  size = '2xl',
  id = 'print-modal',
}: PrintModalProps) {
  const { handlePrint } = useDocumentPrint(isOpen);

  if (!isOpen) return null;

  const footer = (
    <div className="flex items-center justify-between w-full no-print">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        تاریخ آماده‌سازی: {formatPersianDate(new Date())}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
        >
          بستن پنجره
        </button>
        <button
          type="button"
          onClick={() => handlePrint(title)}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-600/20 transition-all cursor-pointer flex items-center gap-1.5"
        >
          <Printer className="w-4 h-4" />
          <span>{printButtonText}</span>
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      id={id}
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={<Printer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
      size={size}
      footer={footer}
      bodyClassName="p-4 sm:p-6"
    >
      {/* Printable Area - Rendered when printing */}
      <div className="doc-print-area space-y-4">
        <div className="text-center pb-3 border-b-2 border-dashed border-slate-300 dark:border-slate-700">
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-1">
            تاریخ چاپ: {formatPersianDate(new Date())}
          </p>
        </div>

        {meta.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs bg-slate-50/60 dark:bg-slate-850/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800" dir="rtl">
            {meta.map((m, i) => (
              <div
                key={`${m.label}-${i}`}
                className="flex justify-between items-baseline gap-2 py-1 border-b border-dashed border-slate-200 dark:border-slate-700/60"
              >
                <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium">
                  {m.label}:
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200 text-left">
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Dynamic Content */}
        <div className="min-h-[100px]">{children}</div>

        {footerNote && (
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed pt-2 border-t border-slate-200 dark:border-slate-800">
            {footerNote}
          </p>
        )}

        {/* Standard Verification / Signatures */}
        {showSignatures && (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 grid grid-cols-3 gap-3 text-[11px] font-bold text-center pt-4 mt-6">
            <div className="flex flex-col justify-between h-16 sm:h-20">
              <span className="text-slate-600 dark:text-slate-400">تنظیم‌کننده</span>
              <div className="border-b border-dashed border-slate-400 dark:border-slate-600"></div>
            </div>
            <div className="flex flex-col justify-between h-16 sm:h-20 border-l border-r border-slate-200 dark:border-slate-800 px-2 sm:px-3">
              <span className="text-slate-600 dark:text-slate-400">تحویل‌گیرنده / مسئول</span>
              <div className="border-b border-dashed border-slate-400 dark:border-slate-600"></div>
            </div>
            <div className="flex flex-col justify-between h-16 sm:h-20">
              <span className="text-slate-600 dark:text-slate-400">تایید نهایی مدیریت</span>
              <div className="border-b border-dashed border-slate-400 dark:border-slate-600"></div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
