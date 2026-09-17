import { RefreshCw, FileText, AlertTriangle, CheckCircle2, Clock, ShoppingCart } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import { PurchaseRequisition, PurchaseRequisitionItemRow } from '../../types';

interface RequisitionDetailsPreviewProps {
  requisition: PurchaseRequisition | null;
  isLoading: boolean;
}

export function RequisitionDetailsPreview({ requisition, isLoading }: RequisitionDetailsPreviewProps) {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs text-slate-500 dark:text-gray-400 flex flex-col items-center justify-center gap-2.5">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500" />
        <span>در حال بارگذاری مشخصات و اقلام درخواست خرید...</span>
      </div>
    );
  }

  if (!requisition) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 dark:text-gray-400 bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
        اطلاعات این درخواست خرید در دسترس نیست یا یافت نشد.
      </div>
    );
  }

  const items: PurchaseRequisitionItemRow[] = Array.isArray(requisition.items) ? requisition.items : [];
  const calculatedTotal = items.reduce((s, i) => s + (Number(i.requestedQty || 0) * Number(i.unitPriceEstimate || 0)), 0);
  const totalAmount = Number(requisition.totalEstimatedAmount || 0) || calculatedTotal;

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'urgent':
        return (
          <span className="px-2 py-0.5 bg-rose-500 text-white font-black rounded text-[10px] flex items-center gap-1 animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            فوری / اضطراری
          </span>
        );
      case 'high':
        return (
          <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-bold rounded text-[10px]">
            اولویت بالا
          </span>
        );
      case 'low':
        return (
          <span className="px-2 py-0.5 bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300 font-bold rounded text-[10px]">
            اولویت پایین
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 font-bold rounded text-[10px]">
            اولویت عادی
          </span>
        );
    }
  };

  const getSimplifiedStatusBadge = (status?: string) => {
    switch (status) {
      case 'ordered':
      case 'in_progress':
      case 'approved':
        return (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300 font-bold rounded text-[10px] flex items-center gap-1">
            <ShoppingCart className="w-3 h-3" />
            تایید شده (در حال خرید)
          </span>
        );
      case 'received':
      case 'completed':
        return (
          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold rounded text-[10px] flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            خرید و تحویل انبار شده
          </span>
        );
      case 'rejected':
      case 'cancelled':
        return (
          <span className="px-2 py-0.5 bg-rose-100 text-rose-900 dark:bg-rose-950/40 dark:text-rose-300 font-bold rounded text-[10px]">
            رد شده / لغو
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 font-bold rounded text-[10px] flex items-center gap-1">
            <Clock className="w-3 h-3" />
            در انتظار بررسی و تایید
          </span>
        );
    }
  };

  return (
    <div className="p-3.5 space-y-3 font-farsi">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white dark:bg-gray-800 p-3 rounded-xl border border-slate-200 dark:border-gray-700 shadow-2xs">
        <div>
          <div className="text-slate-400 dark:text-gray-400 text-[10px]">کد درخواست خرید:</div>
          <div className="font-mono font-bold text-slate-800 dark:text-gray-200 mt-0.5 flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-amber-500" />
            <span>{requisition.code}</span>
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-gray-400 text-[10px]">پروژه یا کارگاه:</div>
          <div className="font-bold text-slate-800 dark:text-gray-200 mt-0.5 truncate" title={requisition.projectName || 'عمومی'}>
            {requisition.projectName ? `${requisition.projectName} (${requisition.projectCode || ''})` : 'عمومی / کارگاهی'}
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-gray-400 text-[10px]">درخواست‌کننده:</div>
          <div className="font-bold text-slate-800 dark:text-gray-200 mt-0.5 truncate">
            {requisition.requestedByName || 'نامشخص'}
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-gray-400 text-[10px]">برآورد کل هزینه:</div>
          <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {totalAmount > 0 ? formatPersianPrice(totalAmount) : 'تعیین نشده'}
          </div>
        </div>
      </div>

      {/* Sub-header with Title, Priority and Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-800 dark:text-gray-200">
            عنوان درخواست: <strong className="text-blue-700 dark:text-blue-400">{requisition.title}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {getPriorityBadge(requisition.priority)}
          {getSimplifiedStatusBadge(requisition.status)}
        </div>
      </div>

      {/* Items Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 dark:bg-gray-700/60 text-slate-700 dark:text-gray-300 font-bold border-b border-slate-200 dark:border-gray-700">
            <tr>
              <th className="p-2.5 w-10 text-center">#</th>
              <th className="p-2.5">نام کالا / متریال مورد نیاز</th>
              <th className="p-2.5 text-center">تعداد / مقدار</th>
              <th className="p-2.5 text-center">موجودی فعلی انبار</th>
              <th className="p-2.5 text-left">برآورد قیمت واحد</th>
              <th className="p-2.5 text-left">مجموع برآورد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gray-700/60">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400 dark:text-gray-500">
                  هیچ ردیف کالایی در این درخواست ثبت نشده است.
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const qty = Number(item.requestedQty || 0);
                const unitPrice = Number(item.unitPriceEstimate || 0);
                const rowTotal = qty * unitPrice;

                return (
                  <tr key={item.id || idx} className="hover:bg-slate-50/70 dark:hover:bg-gray-700/40 transition-colors">
                    <td className="p-2.5 text-center font-mono font-bold text-slate-400 dark:text-gray-500">
                      {formatPersianNumber(idx + 1)}
                    </td>
                    <td className="p-2.5 font-bold text-slate-900 dark:text-gray-100">
                      <div>
                        <span>{item.itemName}</span>
                        {item.itemCode && (
                          <span className="font-mono text-[11px] text-slate-500 dark:text-gray-400 mr-1.5 font-normal">
                            [{item.itemCode}]
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <div className="text-[10px] text-slate-500 dark:text-gray-400 font-normal mt-0.5">
                          نکته: {item.notes}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-center font-mono font-bold text-slate-800 dark:text-gray-200">
                      {formatPersianNumber(qty)} {item.unit || 'عدد'}
                    </td>
                    <td className="p-2.5 text-center font-mono">
                      {item.currentStock !== undefined && item.currentStock !== null ? (
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          Number(item.currentStock) <= 0 
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' 
                            : 'bg-slate-100 text-slate-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {formatPersianNumber(item.currentStock)} {item.unit || 'عدد'}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">نامشخص</span>
                      )}
                    </td>
                    <td className="p-2.5 text-left font-mono text-slate-700 dark:text-gray-300">
                      {unitPrice > 0 ? formatPersianPrice(unitPrice) : '-'}
                    </td>
                    <td className="p-2.5 text-left font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {rowTotal > 0 ? formatPersianPrice(rowTotal) : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Description / Workshop Notes */}
      {(requisition.notes || (requisition as any).description) && (
        <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl border border-amber-200/70 dark:border-amber-900/40 text-xs">
          <div className="font-bold text-amber-900 dark:text-amber-300 mb-1">
            یادداشت و دستورالعمل درخواست‌کننده:
          </div>
          <p className="text-slate-700 dark:text-gray-300 leading-relaxed">
            {requisition.notes || (requisition as any).description}
          </p>
        </div>
      )}
    </div>
  );
}

export default RequisitionDetailsPreview;
