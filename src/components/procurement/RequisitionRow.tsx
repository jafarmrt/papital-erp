import { Building2, Check, Eye, ShoppingCart, Trash2 } from 'lucide-react';
import type { PurchaseRequisition } from '../../types';
import { formatPersianDate, formatPersianNumber, formatPersianPrice } from '../../utils';
import { PillBadge } from '../common/PillBadge';
import { REQUISITION_PRIORITY_BADGES, REQUISITION_PRIORITY_FALLBACK, REQUISITION_STATUS_BADGES, REQUISITION_STATUS_FALLBACK } from './requisitionBadges';
import { canConsolidateRequisition, canDeleteRequisition, canOrderRequisition } from '../../lib/procurement/requisitionFields';
import type { ProcurementAccess } from '../../hooks/procurement/useProcurementAccess';

interface RequisitionRowProps {
  req: PurchaseRequisition;
  access: ProcurementAccess;
  isSelected: boolean;
  onToggleSelect: (req: PurchaseRequisition) => void;
  onView: (req: PurchaseRequisition) => void;
  onSplit: (req: PurchaseRequisition) => void;
  onDelete: (req: PurchaseRequisition) => void;
  onShowOrders: () => void;
}

/** یک ردیف فهرست درخواست‌های میز تدارکات */
export function RequisitionRow({ req, access, isSelected, onToggleSelect, onView, onSplit, onDelete, onShowOrders }: RequisitionRowProps) {
  const itemsCount = Array.isArray(req.items) ? req.items.length : 0;
  // v9.0.353 (TD-697): شمار سفارش‌ها از سرور (SQL)؛ پیش‌تر از سفارش‌های بارگذاری‌شده در مرورگر شمرده می‌شد
  const ordersCount = req.ordersCount ?? 0;
  const pendingOrdersCount = req.pendingDeliveryOrdersCount ?? 0;
  const consolidatable = canConsolidateRequisition(req);

  return (
    <tr className={`hover:bg-slate-50/70 transition-colors ${isSelected ? 'bg-amber-50/40' : ''}`}>
      {access.canManage && (
        <td className="p-3 text-center">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={!isSelected && !consolidatable}
            title={consolidatable ? 'انتخاب برای تجمیع' : 'فقط درخواست تأییدنشده و بی سفارش تجمیع می‌شود'}
            onChange={() => onToggleSelect(req)}
            className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          />
        </td>
      )}

      <td className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-black text-slate-900 text-sm">{req.code}</span>
          <PillBadge variants={REQUISITION_PRIORITY_BADGES} value={req.priority} fallback={REQUISITION_PRIORITY_FALLBACK} />
        </div>
        <span className="text-[11px] text-slate-400">ثبت: {req.requestedByName || 'نامشخص'}</span>
      </td>

      <td className="p-3">
        <div className="font-bold text-slate-900 mb-0.5">{req.title}</div>
        {req.projectName ? (
          <div className="flex items-center gap-1 text-[11px] text-blue-700">
            <Building2 className="w-3 h-3" />
            <span>{req.projectName} ({req.projectCode || ''})</span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">خرید عمومی سازمان</span>
        )}
      </td>

      <td className="p-3 text-center">
        <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg font-bold">
          {formatPersianNumber(itemsCount)} قلم
        </span>
      </td>

      <td className="p-3 text-center font-bold text-slate-700">
        {req.requiredDate ? formatPersianDate(req.requiredDate) : '---'}
      </td>

      <td className="p-3 text-center font-black text-amber-800">
        {formatPersianPrice(req.totalEstimatedAmount || 0)}
      </td>

      <td className="p-3 text-center">
        <PillBadge variants={REQUISITION_STATUS_BADGES} value={req.status} fallback={REQUISITION_STATUS_FALLBACK} />
      </td>

      <td className="p-3 text-center">
        {ordersCount > 0 ? (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={onShowOrders}
              className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-md font-bold text-[11px] border border-sky-200 transition-colors cursor-pointer"
              title="مشاهده فاکتورهای خرید در زبانه فاکتورهای خرید"
            >
              {formatPersianNumber(ordersCount)} فاکتور خرید
            </button>
            {pendingOrdersCount > 0 ? (
              <span className="text-[10px] text-amber-800 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                {formatPersianNumber(pendingOrdersCount)} در انتظار تحویل
              </span>
            ) : (
              <span className="text-[10px] text-emerald-800 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5">
                <Check className="w-3 h-3" /> تحویل کامل به انبار
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-400 text-[11px]">بدون فاکتور</span>
        )}
      </td>

      <td className="p-3 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => onView(req)}
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="مشاهده جزئیات و تاییدات"
          >
            <Eye className="w-4 h-4" />
          </button>

          {/* v9.0.352 (TD-702): صدور سفارش با procurement.order، و پیش از تأیید فقط با حق تأیید (TD-689) */}
          {canOrderRequisition(req, access) && (
            <button
              type="button"
              onClick={() => onSplit(req)}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
              title="تفکیک تامین‌کنندگان و صدور فاکتور خرید"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>تفکیک و صدور فاکتور</span>
            </button>
          )}

          {/* v9.0.318 (TD-695): حذف فقط برای درخواستی که سفارش یا دریافت نشده است */}
          {access.canManage && canDeleteRequisition(req) && (
            <button
              type="button"
              onClick={() => onDelete(req)}
              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
              title="حذف درخواست"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
