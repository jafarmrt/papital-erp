import React, { useState, useMemo } from 'react';
import { PackageCheck, Clock, CheckCircle2, Building2, Search, Truck, FileText, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { ProcurementOrder } from '../../types';
import { formatPersianPrice, formatPersianNumber } from '../../utils';

interface ProcurementOrderListProps {
  orders: ProcurementOrder[];
  isLoading: boolean;
  onDeliverOrder?: (orderId: number, orderRef: string) => Promise<void> | void;
  deliveringOrderId?: number | null;
  onViewRequisition?: (requisitionId: number) => void;
  type: 'active' | 'delivered';
}

export function ProcurementOrderList({
  orders,
  isLoading,
  onDeliverOrder,
  deliveringOrderId,
  onViewRequisition,
  type
}: ProcurementOrderListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (type === 'active' && o.status === 'final') return false;
      if (type === 'delivered' && o.status !== 'final') return false;

      if (!searchTerm.trim()) return true;
      const q = searchTerm.trim().toLowerCase();
      const mRef = (o.refNumber || '').toLowerCase().includes(q);
      const mSupplier = (o.supplierName || '').toLowerCase().includes(q);
      const mReq = (o.requisitionCode || '').toLowerCase().includes(q);
      const mProject = (o.projectName || '').toLowerCase().includes(q);
      const mItems = o.items.some(i => i.itemName.toLowerCase().includes(q) || i.itemCode.toLowerCase().includes(q));
      return mRef || mSupplier || mReq || mProject || mItems;
    });
  }, [orders, type, searchTerm]);

  const totalAmount = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [filteredOrders]);

  return (
    <div className="space-y-4 font-farsi">
      {/* Information Banner */}
      <div className={`p-4 rounded-2xl border flex items-start gap-3.5 text-xs ${
        type === 'active' 
          ? 'bg-amber-50/70 border-amber-200 text-amber-950' 
          : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
      }`}>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
          type === 'active' ? 'bg-amber-500/20 text-amber-700' : 'bg-emerald-500/20 text-emerald-700'
        }`}>
          {type === 'active' ? <Truck className="w-4 h-4" /> : <PackageCheck className="w-4 h-4" />}
        </div>
        <div className="flex-1 space-y-1">
          <div className="font-bold text-sm">
            {type === 'active' 
              ? 'مرحله ۲ از ۳: فاکتورهای خرید تامین‌کنندگان (در انتظار وصول و تحویل به انبار)' 
              : 'مرحله ۳ از ۳: رسیدهای قطعی انبار (خرید تکمیل و وارد کاردکس شده)'}
          </div>
          <p className="leading-relaxed opacity-90">
            {type === 'active'
              ? 'این اسناد مربوط به سفارش‌هایی است که از درخواست‌های خرید تفکیک شده و برای تامین‌کنندگان صادر گردیده‌اند. پس از وصول فیزیکی اقلام، با کلیک بر روی دکمه «تایید و تحویل به انبار»، رسید قطعی صادر شده و موجودی کاردکس انبار به صورت رسمی افزایش می‌یابد.'
              : 'این اقلام با موفقیت تحویل انباردار گردیده، در موجودی کاردکس ثبت رسمی شده و اسناد دوبل حسابداری آنها صادر گردیده است.'}
          </p>
        </div>
      </div>

      {/* Toolbar & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs text-xs">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            placeholder="جستجو در شماره فاکتور، نام تامین‌کننده، کد درخواست خرید مرجع، پروژه یا اقلام..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-4 text-slate-600 font-bold">
          <div>
            تعداد اسناد: <span className="text-slate-900 font-mono font-black">{formatPersianNumber(filteredOrders.length)}</span>
          </div>
          <div>
            مجموع مبلغ: <span className="text-amber-800 font-mono font-black text-sm">{formatPersianPrice(totalAmount)}</span>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            در حال بارگذاری فاکتورهای خرید...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            {searchTerm ? 'هیچ سندی با عبارت جستجو یافت نشد.' : (
              type === 'active' 
                ? 'هیچ فاکتور خریدی در انتظار تحویل به انبار وجود ندارد. از تب درخواست‌های خرید می‌توانید درخواست‌ها را تفکیک و به فاکتور خرید تبدیل کنید.'
                : 'هنوز هیچ فاکتوری به انبار تحویل قطعی نشده است.'
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 text-center w-12">#</th>
                  <th className="p-3">شماره و تاریخ فاکتور</th>
                  <th className="p-3">تامین‌کننده / فروشنده</th>
                  <th className="p-3">درخواست خرید مرجع</th>
                  <th className="p-3">پروژه و انبار مقصد</th>
                  <th className="p-3 text-center">اقلام سفارش</th>
                  <th className="p-3 text-center">مبلغ کل فاکتور</th>
                  <th className="p-3 text-center">وضعیت تحویل</th>
                  <th className="p-3 text-center">عملیات انبار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order, idx) => {
                  const isExpanded = expandedOrderId === order.id;
                  const isDelivering = deliveringOrderId === order.id;

                  return (
                    <React.Fragment key={order.id}>
                      <tr className={`hover:bg-slate-50/70 transition-colors ${isExpanded ? 'bg-amber-50/30' : ''}`}>
                        <td className="p-3 text-center font-mono text-slate-400">
                          {idx + 1}
                        </td>

                        <td className="p-3">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span>فاکتور #{order.refNumber}</span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                            {order.date || '---'}
                          </span>
                        </td>

                        <td className="p-3">
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>{order.supplierName}</span>
                          </div>
                          {order.notes && (
                            <span className="text-[11px] text-slate-400 line-clamp-1 mt-0.5" title={order.notes}>
                              {order.notes}
                            </span>
                          )}
                        </td>

                        <td className="p-3">
                          {order.requisitionCode ? (
                            <button
                              type="button"
                              onClick={() => order.requisitionId && onViewRequisition?.(order.requisitionId)}
                              className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-mono font-bold rounded-md border border-blue-200 transition-colors cursor-pointer"
                              title="مشاهده درخواست خرید متناظر"
                            >
                              {order.requisitionCode}
                            </button>
                          ) : (
                            <span className="text-slate-400 text-[11px]">مستقل</span>
                          )}
                        </td>

                        <td className="p-3">
                          <div className="font-bold text-slate-800">
                            {order.projectName || 'خرید عمومی سازمان'}
                          </div>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            مقصد: {order.location || 'انبار اصلی'}
                          </span>
                        </td>

                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold flex items-center justify-center gap-1 mx-auto transition-colors cursor-pointer"
                            title="مشاهده اقلام"
                          >
                            <span>{formatPersianNumber(order.itemsCount)} قلم کالا</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </td>

                        <td className="p-3 text-center font-mono font-black text-amber-800">
                          {formatPersianPrice(order.totalAmount)}
                        </td>

                        <td className="p-3 text-center">
                          {order.status === 'final' ? (
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 font-bold rounded-lg text-[11px] inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              تحویل قطعی انبار
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-lg text-[11px] inline-flex items-center gap-1 animate-pulse">
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                              در انتظار تحویل انبار
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-center">
                          {order.status !== 'final' && onDeliverOrder ? (
                            <button
                              type="button"
                              disabled={isDelivering}
                              onClick={() => onDeliverOrder(order.id, order.refNumber)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer mx-auto disabled:opacity-50"
                              title="تایید رسید کالا و ثبت در کاردکس انبار"
                            >
                              <PackageCheck className="w-4 h-4" />
                              <span>{isDelivering ? 'در حال تحویل...' : 'تایید و تحویل به انبار'}</span>
                            </button>
                          ) : (
                            <span className="text-emerald-700 font-bold text-[11px] flex items-center justify-center gap-1">
                              <Check className="w-3.5 h-3.5" />
                              تکمیل شده
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Line Items */}
                      {isExpanded && (
                        <tr className="bg-amber-50/20">
                          <td colSpan={9} className="p-4 border-t border-b border-amber-100">
                            <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                              <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                                <span>ریز اقلام فاکتور خرید #{order.refNumber} ({order.supplierName}):</span>
                                <span className="text-slate-400 font-normal">کاربر ثبت‌کننده: {order.user}</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs text-right">
                                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                    <tr>
                                      <th className="p-2 text-center w-10">#</th>
                                      <th className="p-2">نام و کد کالا</th>
                                      <th className="p-2 text-center">تعداد / مقدار</th>
                                      <th className="p-2 text-center">واحد</th>
                                      <th className="p-2 text-center">قیمت واحد (ریال)</th>
                                      <th className="p-2 text-center">مبلغ کل (ریال)</th>
                                      <th className="p-2 text-center">انبار تحویل‌گیرنده</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {order.items.map((line, lIdx) => (
                                      <tr key={line.id || lIdx}>
                                        <td className="p-2 text-center font-mono text-slate-400">{lIdx + 1}</td>
                                        <td className="p-2 font-bold text-slate-900">
                                          {line.itemName}
                                          {line.itemCode && (
                                            <span className="text-[10px] text-slate-400 font-mono mr-1.5">({line.itemCode})</span>
                                          )}
                                        </td>
                                        <td className="p-2 text-center font-mono font-bold text-slate-800">
                                          {formatPersianNumber(line.quantity)}
                                        </td>
                                        <td className="p-2 text-center text-slate-600">{line.unit}</td>
                                        <td className="p-2 text-center font-mono text-slate-700">
                                          {formatPersianPrice(line.unitPrice)}
                                        </td>
                                        <td className="p-2 text-center font-mono font-black text-amber-800">
                                          {formatPersianPrice(line.totalPrice)}
                                        </td>
                                        <td className="p-2 text-center text-slate-600">{line.location}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
