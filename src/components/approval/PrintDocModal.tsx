import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import InvoicePrintView from '../InvoicePrintView';
import type { ApprovalDocumentDetails } from './DocumentDetailsPreview';

interface PrintDocModalProps {
  printDoc: ApprovalDocumentDetails | null;
  onClose: () => void;
}

/**
 * V9 Phase 5.2: مودال نسخه چاپی سند از داخل کارتابل تاییدات — استخراج‌شده از ApprovalInboxPage.
 * V10-3.2: chrome مودال (backdrop/header/footer) در چاپ حذف می‌شود؛ هنگام باز بودن مودال
 * بادی-کلاس printing-doc فعال شده و فقط ناحیه doc-print-area به چاپگر ارسال می‌شود.
 */
export function PrintDocModal({ printDoc, onClose }: PrintDocModalProps) {
  useEffect(() => {
    if (printDoc) {
      document.body.classList.add('printing-doc');
      return () => {
        document.body.classList.remove('printing-doc');
      };
    }
    return undefined;
  }, [printDoc]);

  if (!printDoc) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-4xl w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl animate-scaleUp my-8">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200 dark:border-gray-700 no-print">
          <h3 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2">
            <Printer className="w-5 h-5 text-indigo-600" />
            نسخه چاپی پیش‌فاکتور / فاکتور
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="doc-print-area overflow-y-auto max-h-[70vh]">
          <InvoicePrintView printedDoc={printDoc as any} />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4 no-print">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors cursor-pointer"
          >
            بستن پنجره
          </button>
          <button
            onClick={() => window.print()}
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            چاپ فاکتور
          </button>
        </div>
      </div>
    </div>
  );
}

export default PrintDocModal;
