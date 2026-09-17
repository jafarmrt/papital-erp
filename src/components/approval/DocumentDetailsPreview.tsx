import { RefreshCw } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';

export interface ApprovalDocumentItemRow {
  code?: string;
  item_code?: string;
  name?: string;
  item_name?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  unitPrice?: number;
  price?: number;
  discount?: number;
  total_price?: number;
  total?: number;
}

export interface ApprovalDocumentDetails {
  id?: number | string;
  ref_number?: string;
  refNumber?: string;
  buyer_name?: string;
  buyerName?: string;
  buyer_city?: string;
  buyerCity?: string;
  total_amount?: number;
  totalAmount?: number;
  amount?: number;
  currency?: string;
  notes?: string;
  items?: ApprovalDocumentItemRow[];
}

interface DocumentDetailsPreviewProps {
  docDetails: ApprovalDocumentDetails | null;
  isLoadingDoc: boolean;
}

/**
 * V9 Phase 5.2: پیش‌نمایش مشترک جزئیات سند داخل مودال‌های تایید کارتابل
 * (نوار اطلاعات خریدار + جدول اقلام + یادداشت) — قبلاً دو بار تکرار شده بود.
 */
export function DocumentDetailsPreview({ docDetails, isLoadingDoc }: DocumentDetailsPreviewProps) {
  if (isLoadingDoc) {
    return (
      <div className="p-6 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
        در حال بارگذاری مشخصات و اقلام پیش‌فاکتور...
      </div>
    );
  }

  if (!docDetails) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        مشخصات سند در دسترس نیست یا بارگذاری نشد.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Buyer & Doc Info Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700">
        <div>
          <div className="text-gray-400 text-[10px]">شماره سند:</div>
          <div className="font-mono font-bold text-gray-800 dark:text-gray-200">{docDetails.ref_number || docDetails.refNumber || '-'}</div>
        </div>
        <div>
          <div className="text-gray-400 text-[10px]">خریدار:</div>
          <div className="font-bold text-gray-800 dark:text-gray-200 truncate">{docDetails.buyer_name || docDetails.buyerName || '-'}</div>
        </div>
        <div>
          <div className="text-gray-400 text-[10px]">شهر / مقصد:</div>
          <div className="text-gray-700 dark:text-gray-300 truncate">{docDetails.buyer_city || docDetails.buyerCity || '-'}</div>
        </div>
        <div>
          <div className="text-gray-400 text-[10px]">مبلغ کل:</div>
          <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {formatPersianPrice(docDetails.total_amount || docDetails.totalAmount || 0, docDetails.currency)}
          </div>
        </div>
      </div>

      {/* Items Table */}
      {Array.isArray(docDetails.items) && docDetails.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <table className="w-full text-right text-[11px]">
            <thead className="bg-gray-100/70 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 font-bold border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">نام کالا / محصول</th>
                <th className="p-2 text-center">تعداد / مقدار</th>
                <th className="p-2 text-left">قیمت واحد</th>
                <th className="p-2 text-left">مبلغ کل سطر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {docDetails.items.map((it: ApprovalDocumentItemRow, idx: number) => {
                const lineQty = Number(it.quantity || 0);
                const linePrice = Number(it.unit_price || it.unitPrice || 0);
                const lineDiscount = Number(it.discount || 0);
                const lineTotal = (lineQty * linePrice) - lineDiscount;
                return (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="p-2 text-gray-400 font-mono">{idx + 1}</td>
                    <td className="p-2 font-medium text-gray-900 dark:text-gray-100">{it.item_name || it.itemName || it.code || 'کالا'}</td>
                    <td className="p-2 text-center font-mono font-bold text-indigo-600 dark:text-indigo-400">{formatPersianNumber(lineQty)} <span className="text-[10px] text-gray-400 font-normal">{it.unit || 'عدد'}</span></td>
                    <td className="p-2 text-left font-mono text-gray-600 dark:text-gray-300">{formatPersianPrice(linePrice)}</td>
                    <td className="p-2 text-left font-mono font-bold text-gray-800 dark:text-gray-200">{formatPersianPrice(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center p-3 text-xs text-gray-500 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
          اطلاعات اقلام به صورت خلاصه از زمینه سند لود شده است.
        </div>
      )}

      {docDetails.notes && (
        <div className="text-[11px] text-gray-600 dark:text-gray-400 bg-amber-50/50 dark:bg-amber-950/20 p-2 rounded-lg border border-amber-100 dark:border-amber-900/30">
          <span className="font-bold text-amber-700 dark:text-amber-400">یادداشت سند: </span>
          {docDetails.notes}
        </div>
      )}
    </div>
  );
}

export default DocumentDetailsPreview;
