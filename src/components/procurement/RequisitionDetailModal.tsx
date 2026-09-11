import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, FileText, CheckCircle2, Clock, AlertTriangle, Building2, 
  ShoppingCart, ArrowRight, UserCheck, Check, Ban, Loader2, Link2, ExternalLink,
  PackageCheck, Truck
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PurchaseRequisition, Item, User, ProcurementOrder } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import { ConfirmWarehouseDeliveryModal } from './ConfirmWarehouseDeliveryModal';

interface RequisitionDetailModalProps {
  isOpen: boolean;
  requisition: PurchaseRequisition;
  warehouseItems: Item[];
  currentUser?: User | null;
  onClose: () => void;
  onRefresh: () => void;
  onOpenSplitOrder: (req: PurchaseRequisition) => void;
}

export function RequisitionDetailModal({
  isOpen,
  requisition,
  warehouseItems,
  currentUser,
  onClose,
  onRefresh,
  onOpenSplitOrder
}: RequisitionDetailModalProps) {
  const [comment, setComment] = useState('');
  const [isActing, setIsActing] = useState(false);
  const [linkedOrders, setLinkedOrders] = useState<ProcurementOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [deliveringOrderId, setDeliveringOrderId] = useState<number | null>(null);
  const [deliveryModalOrder, setDeliveryModalOrder] = useState<ProcurementOrder | null>(null);
  const [bulkDeliveryOrders, setBulkDeliveryOrders] = useState<ProcurementOrder[] | null>(null);
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);

  const loadLinkedOrders = useCallback(async () => {
    if (!requisition?.id) return;
    setIsLoadingOrders(true);
    try {
      const res = await fetchJson<{ success: boolean; data: ProcurementOrder[] }>(`/api/procurement/orders?requisitionId=${requisition.id}`);
      if (res?.data) {
        setLinkedOrders(res.data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingOrders(false);
    }
  }, [requisition?.id]);

  useEffect(() => {
    if (isOpen) {
      loadLinkedOrders();
    }
  }, [isOpen, loadLinkedOrders]);

  if (!isOpen) return null;

  const handleOpenDeliverSingleModal = (order: ProcurementOrder) => {
    setDeliveryModalOrder(order);
    setBulkDeliveryOrders(null);
  };

  const handleOpenDeliverBulkModal = () => {
    const draftOrders = linkedOrders.filter(o => o.status !== 'final');
    if (draftOrders.length === 0 && linkedOrders.length === 0) {
      toast.error('ابتدا باید با کلیک بر روی دکمه «تفکیک تامین‌کننده و صدور فاکتور»، فاکتور خرید صادر شود.');
      return;
    }
    setDeliveryModalOrder(null);
    setBulkDeliveryOrders(draftOrders);
  };

  const handleConfirmDelivery = async () => {
    setIsSubmittingDelivery(true);
    try {
      if (bulkDeliveryOrders && bulkDeliveryOrders.length > 0) {
        for (const ord of bulkDeliveryOrders) {
          await fetchJson(`/api/procurement/orders/${ord.id}/deliver`, { method: 'POST' });
        }
        toast.success('کلیه فاکتورهای خرید با موفقیت به انبار تحویل گردید و موجودی کاردکس به‌روز شد.');
        setBulkDeliveryOrders(null);
        onRefresh();
        onClose();
      } else if (deliveryModalOrder) {
        const res = await fetchJson<{ success: boolean; message: string }>(`/api/procurement/orders/${deliveryModalOrder.id}/deliver`, {
          method: 'POST'
        });
        toast.success(res.message || 'فاکتور خرید با موفقیت به انبار تحویل و رسید قطعی صادر شد.');
        setDeliveryModalOrder(null);
        await loadLinkedOrders();
        onRefresh();
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در تحویل فاکتور خرید به انبار');
    } finally {
      setIsSubmittingDelivery(false);
    }
  };

  const handleWorkflowAction = async (actionKey: string) => {
    setIsActing(true);
    try {
      const res = await fetchJson<{ success: boolean; message?: string }>(`/api/procurement/requisitions/${requisition.id}/workflow-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionKey, comment: comment.trim() })
      });

      toast.success(res.message || 'اقدام گردش کار با موفقیت انجام شد.');
      setComment('');
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت اقدام گردش کار');
    } finally {
      setIsActing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'under_review':
      case 'manager_approval':
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-600" /> در انتظار بررسی و تایید</span>;
      case 'ordered':
      case 'approved':
        return <span className="px-2.5 py-1 bg-sky-100 text-sky-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><ShoppingCart className="w-3.5 h-3.5 text-sky-600" /> تایید شده (در حال خرید)</span>;
      case 'received':
      case 'completed':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> خرید و تحویل انبار شده</span>;
      case 'rejected':
      case 'cancelled':
        return <span className="px-2.5 py-1 bg-rose-100 text-rose-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><Ban className="w-3.5 h-3.5 text-rose-600" /> رد شده / لغو</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg text-xs">{status}</span>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <span className="px-2 py-0.5 bg-rose-500 text-white font-black rounded text-[10px] animate-pulse">فوری / اضطراری</span>;
      case 'high':
        return <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-bold rounded text-[10px]">اولویت بالا</span>;
      case 'low':
        return <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold rounded text-[10px]">اولویت پایین</span>;
      default:
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded text-[10px]">اولویت عادی</span>;
    }
  };

  const items = Array.isArray(requisition.items) ? requisition.items : [];
  const totalRequested = items.reduce((s, i) => s + (Number(i.requestedQty || 0) * Number(i.unitPriceEstimate || 0)), 0);

  const statusStr = String(requisition.status || '');
  const isPendingStage = statusStr === 'pending' || statusStr === 'under_review' || statusStr === 'manager_approval';
  const isOrderedStage = statusStr === 'ordered' || statusStr === 'approved';
  const isReceivedStage = statusStr === 'received' || statusStr === 'completed';
  const isRejectedStage = statusStr === 'rejected' || statusStr === 'cancelled';

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-slate-900 text-base">
                  جزئیات درخواست خرید {requisition.code}
                </h3>
                {getPriorityBadge(requisition.priority)}
                {getStatusBadge(requisition.status)}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{requisition.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 3-Stage Workflow Tracker */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-xs font-bold mb-2">
              <span className="text-slate-600">گردش‌کار ۳ مرحله‌ای تدارکات کارگاه:</span>
              <span className="text-slate-400 font-normal">ساده‌شده برای عملیات سریع و بدون پیچیدگی</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* Step 1 */}
              <div className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                isPendingStage
                  ? 'bg-amber-100/70 border-amber-300 text-amber-950 font-black ring-2 ring-amber-400/30'
                  : (isOrderedStage || isReceivedStage)
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-400'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                  isPendingStage
                    ? 'bg-amber-500 text-slate-950'
                    : (isOrderedStage || isReceivedStage)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {(isOrderedStage || isReceivedStage) ? <Check className="w-3.5 h-3.5" /> : '۱'}
                </div>
                <div className="min-w-0">
                  <div className="text-xs truncate">۱. بررسی و تایید</div>
                  <div className="text-[10px] text-slate-500 truncate">کنترل موجودی و تایید خرید</div>
                </div>
              </div>

              {/* Step 2 */}
              <div className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                isOrderedStage
                  ? 'bg-sky-100/70 border-sky-300 text-sky-950 font-black ring-2 ring-sky-400/30'
                  : isReceivedStage
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-400'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                  isOrderedStage
                    ? 'bg-sky-600 text-white'
                    : isReceivedStage
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {isReceivedStage ? <Check className="w-3.5 h-3.5" /> : '۲'}
                </div>
                <div className="min-w-0">
                  <div className="text-xs truncate">۲. تایید شده (در حال خرید)</div>
                  <div className="text-[10px] text-slate-500 truncate">سفارش‌گذاری با تامین‌کننده</div>
                </div>
              </div>

              {/* Step 3 */}
              <div className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                isReceivedStage
                  ? 'bg-emerald-100/70 border-emerald-300 text-emerald-950 font-black ring-2 ring-emerald-400/30'
                  : 'bg-white border-slate-200 text-slate-400'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                  isReceivedStage
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {isReceivedStage ? <Check className="w-3.5 h-3.5" /> : '۳'}
                </div>
                <div className="min-w-0">
                  <div className="text-xs truncate">۳. تحویل و ورود انبار</div>
                  <div className="text-[10px] text-slate-500 truncate">تکمیل خرید و ثبت در کاردکس</div>
                </div>
              </div>
            </div>
          </div>

          {/* Metadata Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block mb-1">پروژه متناظر:</span>
              <span className="font-bold text-slate-900">
                {requisition.projectName ? `${requisition.projectName} (${requisition.projectCode || ''})` : 'فاقد پروژه (عمومی)'}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block mb-1">درخواست‌کننده:</span>
              <span className="font-bold text-slate-900">{requisition.requestedByName || 'نامشخص'}</span>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block mb-1">تاریخ نیاز:</span>
              <span className="font-mono font-bold text-slate-900">{requisition.requiredDate || '---'}</span>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block mb-1">برآورد کل هزینه:</span>
              <span className="font-mono font-black text-amber-700">{formatPersianPrice(requisition.totalEstimatedAmount || totalRequested)}</span>
            </div>
          </div>

          {requisition.notes && (
            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-950">
              <span className="font-bold block mb-1">توضیحات و مشخصات فنی مورد نیاز:</span>
              <p className="leading-relaxed">{requisition.notes}</p>
            </div>
          )}

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">اقلام درخواستی ({formatPersianNumber(items.length)} قلم)</span>
              <span className="text-xs text-slate-500">کنترل مقادیر سفارش‌گذاری و تامین‌شده</span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-12">ردیف</th>
                    <th className="p-2.5">نام و کد کالا</th>
                    <th className="p-2.5 text-center">واحد</th>
                    <th className="p-2.5 text-center">درخواستی</th>
                    <th className="p-2.5 text-center">سفارش‌شده</th>
                    <th className="p-2.5 text-center">مانده</th>
                    <th className="p-2.5 text-center">برآورد واحد (ریال)</th>
                    <th className="p-2.5 text-center">تامین‌کننده انتخابی</th>
                    <th className="p-2.5 text-center">اسناد صادره</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row, idx) => {
                    const reqQty = Number(row.requestedQty || 0);
                    const ordQty = Number(row.orderedQty || 0);
                    const remQty = Math.max(0, reqQty - ordQty);
                    const isFullyOrdered = ordQty >= reqQty;

                    return (
                      <tr key={row.id || idx} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900">{row.itemName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{row.itemCode || 'فاقد کد'}</div>
                        </td>
                        <td className="p-2.5 text-center font-bold text-slate-700">{row.unit}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-slate-900">{formatPersianNumber(reqQty)}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-emerald-700">{formatPersianNumber(ordQty)}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-amber-700">
                          {remQty > 0 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-950 rounded">{formatPersianNumber(remQty)}</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-950 rounded">تکمیل</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center font-mono text-slate-700">
                          {formatPersianPrice(row.unitPriceEstimate || 0)}
                        </td>
                        <td className="p-2.5 text-center font-bold text-slate-800">
                          {row.targetSupplierName || '---'}
                        </td>
                        <td className="p-2.5 text-center">
                          {row.linkedDocumentIds && row.linkedDocumentIds.length > 0 ? (
                            <div className="flex items-center justify-center gap-1">
                              {row.linkedDocumentIds.map(docId => (
                                <span key={docId} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono border border-blue-200">
                                  سند #{docId}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">بدون سند</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Linked Invoices & Warehouse Receipts */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-sky-600" />
                <span className="font-bold text-slate-900 text-xs">
                  فاکتورهای خرید صادره و وضعیت تحویل انبار ({formatPersianNumber(linkedOrders.length)} فاکتور)
                </span>
              </div>
              <span className="text-[11px] text-slate-500">تفکیک فاکتور خرید بر اساس هر تامین‌کننده</span>
            </div>

            {isLoadingOrders ? (
              <div className="p-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                در حال بارگذاری اطلاعات فاکتورهای متناظر...
              </div>
            ) : linkedOrders.length === 0 ? (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>هنوز فاکتور خریدی برای این درخواست صادر نشده است.</span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenSplitOrder(requisition)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  صدور فاکتور تامین‌کننده
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {linkedOrders.map(order => {
                  const isDelivered = order.status === 'final';
                  const isDelivering = deliveringOrderId === order.id;

                  return (
                    <div
                      key={order.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isDelivered
                          ? 'bg-emerald-50/50 border-emerald-200'
                          : 'bg-white border-slate-200 shadow-2xs'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs text-slate-900">
                            فاکتور خرید #{order.orderNumber}
                          </span>
                          <span className="font-bold text-xs text-slate-700">
                            تامین‌کننده: {order.supplierName}
                          </span>
                          {order.orderDate && (
                            <span className="text-[11px] text-slate-400 font-mono">
                              ({order.orderDate})
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 truncate">
                          اقلام:{' '}
                          {Array.isArray(order.items)
                            ? order.items
                                .map(i => `${i.itemName} (${formatPersianNumber(i.quantity)} ${i.unit || ''})`)
                                .join('، ')
                            : '---'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <span className="font-mono font-bold text-xs text-slate-900 ml-2">
                          {formatPersianPrice(order.totalAmount || 0)} ریال
                        </span>

                        {isDelivered ? (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded-lg font-bold text-xs flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            تحویل انبار شده (رسید قطعی)
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isDelivering || isActing}
                            onClick={() => handleOpenDeliverSingleModal(order)}
                            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
                          >
                            {isDelivering ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <PackageCheck className="w-3.5 h-3.5" />
                            )}
                            تایید تحویل به انبار
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Workflow Action Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-amber-600" />
                <span className="font-bold text-slate-900 text-xs">اقدامات گردش کار تدارکات و تاییدات</span>
              </div>
              <span className="text-[11px] text-slate-500">بر اساس نقش و اختیارات سازمانی کاربر</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">یادداشت / دستور اقدام تدارکاتی:</label>
              <input
                type="text"
                placeholder="مثلاً: استعلام قیمت از بازار انجام شد، قیمت توافقی به تایید رسید"
                value={comment}
                onChange={e => setComment(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {/* Transition Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {/* If pending / under_review / manager_approval (Stage 1) */}
              {isPendingStage && (
                <>
                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleWorkflowAction('approve_request')}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    تایید و صدور دستور خرید
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSplitOrder(requisition)}
                    className="px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    تفکیک تامین‌کننده و صدور پیش‌فاکتور
                  </button>

                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleWorkflowAction('reject_request')}
                    className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-rose-200 transition-all cursor-pointer mr-auto disabled:opacity-50"
                  >
                    <Ban className="w-4 h-4" />
                    رد درخواست خرید
                  </button>
                </>
              )}

              {/* If ordered (Stage 2) */}
              {isOrderedStage && (
                <>
                  <button
                    type="button"
                    disabled={isActing}
                    onClick={handleOpenDeliverBulkModal}
                    className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isActing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    تایید خرید و تحویل کلیه اقلام به انبار
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSplitOrder(requisition)}
                    className="px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    مشاهده / ثبت فاکتور تامین‌کننده
                  </button>

                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleWorkflowAction('cancel_order')}
                    className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-rose-200 transition-all cursor-pointer mr-auto disabled:opacity-50"
                  >
                    <Ban className="w-4 h-4" />
                    لغو / رد سفارش خرید
                  </button>
                </>
              )}

              {/* If received (Stage 3) */}
              {isReceivedStage && (
                <div className="w-full p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  این سفارش با موفقیت خریداری و تحویل انبار شده است و گردش‌کار آن تکمیل می‌باشد.
                </div>
              )}

              {/* If rejected */}
              {isRejectedStage && (
                <div className="w-full flex items-center justify-between p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <div className="flex items-center gap-2 text-xs text-rose-900 font-bold">
                    <Ban className="w-4 h-4 text-rose-600 shrink-0" />
                    این درخواست خرید رد شده یا لغو گردیده است.
                  </div>
                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleWorkflowAction('reopen')}
                    className="px-3 py-1.5 bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-xs font-bold rounded-lg transition-all cursor-pointer"
                  >
                    بازگشایی و بررسی مجدد
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-2xl">
          <span className="text-xs text-slate-500">
            شناسه داخلی: #{requisition.id} | آخرین به‌روزرسانی: {requisition.updatedAt ? new Date(requisition.updatedAt).toLocaleDateString('fa-IR') : '---'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            بستن
          </button>
        </div>
      </div>

      {/* Warehouse Delivery Confirmation Modal */}
      {(deliveryModalOrder || (bulkDeliveryOrders && bulkDeliveryOrders.length > 0)) && (
        <ConfirmWarehouseDeliveryModal
          isOpen={true}
          order={deliveryModalOrder}
          bulkOrders={bulkDeliveryOrders || undefined}
          isSubmitting={isSubmittingDelivery}
          onClose={() => {
            setDeliveryModalOrder(null);
            setBulkDeliveryOrders(null);
          }}
          onConfirm={handleConfirmDelivery}
        />
      )}
    </div>
  );
}
