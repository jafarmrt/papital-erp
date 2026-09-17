import React from 'react';
import { PackageCheck, Warehouse, FileText, CheckCircle2, X, Loader2, Building2 } from 'lucide-react';
import { formatPersianNumber, formatPersianPrice } from '../../utils';

export interface ConfirmWarehouseDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  isSubmitting: boolean;
  order: {
    id: number;
    refNumber?: string;
    buyerName?: string;
    location?: string;
    totalAmount?: number;
    itemsCount?: number;
    date?: string;
    projectName?: string;
    items?: Array<{
      itemId: number;
      itemName?: string;
      itemCode?: string;
      quantity: number;
      unitPrice?: number;
      unit?: string;
    }>;
  } | null;
  bulkOrders?: Array<{
    id: number;
    refNumber?: string;
    buyerName?: string;
    totalAmount?: number;
  }>;
}

export const ConfirmWarehouseDeliveryModal: React.FC<ConfirmWarehouseDeliveryModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isSubmitting,
  order,
  bulkOrders
}) => {
  if (!isOpen) return null;

  const isBulk = Array.isArray(bulkOrders) && bulkOrders.length > 0;
  const totalBulkAmount = isBulk 
    ? bulkOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/15 rounded-xl">
              <PackageCheck className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h3 className="font-black text-sm">
                {isBulk ? 'تایید و تحویل تجمیعی فاکتورها به انبار' : 'تایید تحویل فاکتور خرید به انبار'}
              </h3>
              <p className="text-[11px] text-emerald-100 mt-0.5">
                {isBulk 
                  ? `تحویل همزمان ${formatPersianNumber(bulkOrders.length)} فاکتور خرید تامین‌کننده`
                  : `فاکتور شماره ${order?.refNumber || 'سفارش'} - صدور رسید قطعی انبار`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
            title="بستن پنجره"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
          {/* Order Summary Card */}
          {!isBulk && order && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>شماره فاکتور:</span>
                  <span className="font-mono text-emerald-700 font-black">{order.refNumber}</span>
                </div>
                {order.date && (
                  <span className="text-[11px] text-slate-500 font-mono">تاریخ: {order.date}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 text-[11px]">
                <div>
                  <span className="text-slate-500 block">تامین‌کننده / فروشنده:</span>
                  <span className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    {order.buyerName || 'تامین‌کننده تدارکات'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">انبار مقصد ورود:</span>
                  <span className="font-bold text-emerald-800 flex items-center gap-1 mt-0.5">
                    <Warehouse className="w-3.5 h-3.5 text-emerald-600" />
                    {order.location || 'انبار اصلی'}
                  </span>
                </div>
                {order.projectName && (
                  <div>
                    <span className="text-slate-500 block">پروژه تخصیص‌یافته:</span>
                    <span className="font-bold text-slate-800 mt-0.5 block">{order.projectName}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block">مبلغ کل فاکتور:</span>
                  <span className="font-bold font-mono text-amber-800 text-xs mt-0.5 block">
                    {formatPersianPrice(order.totalAmount || 0)}
                  </span>
                </div>
              </div>

              {/* Items preview if available */}
              {Array.isArray(order.items) && order.items.length > 0 && (
                <div className="pt-2 border-t border-slate-200/80">
                  <span className="text-slate-500 block mb-1">اقلام تحویلی ({formatPersianNumber(order.items.length)} قلم):</span>
                  <div className="max-h-24 overflow-y-auto space-y-1 bg-white p-2 rounded-lg border border-slate-100 text-[11px]">
                    {order.items.map((it, i) => (
                      <div key={i} className="flex justify-between items-center text-slate-700">
                        <span className="truncate max-w-[240px] font-medium">{it.itemName || it.itemCode}</span>
                        <span className="font-mono font-bold text-emerald-700">
                          {formatPersianNumber(it.quantity)} {it.unit || 'عدد'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bulk Orders Summary */}
          {isBulk && bulkOrders && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>فهرست فاکتورهای آماده تحویل:</span>
                <span className="text-emerald-700">{formatPersianNumber(bulkOrders.length)} فاکتور خرید</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-white p-2 rounded-lg border border-slate-100 text-[11px]">
                {bulkOrders.map(bo => (
                  <div key={bo.id} className="flex justify-between items-center py-0.5 border-b border-slate-50 last:border-0">
                    <span className="font-mono font-bold text-slate-800">{bo.refNumber}</span>
                    <span className="text-slate-600 truncate max-w-[140px]">{bo.buyerName}</span>
                    <span className="font-mono font-black text-amber-800">{formatPersianPrice(bo.totalAmount || 0)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-1 font-bold text-xs text-slate-800">
                <span>مجموع مبالغ:</span>
                <span className="font-mono font-black text-amber-800">{formatPersianPrice(totalBulkAmount)}</span>
              </div>
            </div>
          )}

          {/* Business & Accounting Explanation Notice */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5 text-[11px] text-emerald-950">
            <div className="font-bold flex items-center gap-1.5 text-emerald-900 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>عملیات خودکار سیستمی با تایید این رسید:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 pr-1 text-emerald-900/90 leading-relaxed">
              <li>ثبت رسمی وضعیت سند به عنوان <strong>رسید قطعی ورود کالا به انبار</strong>.</li>
              <li>افزایش آنی موجودی و ثبت رویداد ورود در <strong>کاردکس رسمی انبار</strong>.</li>
              <li>صدور خودکار <strong>سند دوبل حسابداری</strong> (بدهکار: موجودی انبار / بستانکار: بستانکاران تجاری).</li>
              <li>به‌روزرسانی و تکمیل خودکار وظیفه مربوطه در <strong>کارتابل گردش‌کار و تاییدات</strong>.</li>
            </ul>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>در حال ثبت رسید و صدور اسناد...</span>
              </>
            ) : (
              <>
                <PackageCheck className="w-4 h-4" />
                <span>تایید و صدور رسید قطعی انبار</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
