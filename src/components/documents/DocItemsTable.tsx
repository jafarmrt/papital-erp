import React from 'react';
import { Lock, AlertTriangle, Trash2, Package, ShoppingCart, Edit3 } from 'lucide-react';
import { formatPersianPrice } from '../../utils';
import { Item } from '../../types';

export interface DocItemRow {
  item: Item;
  quantity: number;
  unitPrice: number;
}

interface DocItemsTableProps {
  docItems: DocItemRow[];
  actionType: 'in' | 'out';
  currencyLabel: string;
  totalSum: number;
  getItemReservationSummary: (it: Item) => {
    reservedForSelectedProject: number;
    reservedForOtherProjects: number;
    maxAllowedForExit?: number;
    matchingReservations?: any[];
  };
  onUpdateItemQty: (index: number, newQty: number) => void;
  onUpdateItemPrice: (index: number, newPrice: number) => void;
  onRemove: (itemId: number) => void;
  onEditItem?: (item: Item) => void;
  canEditItem?: boolean;
}

/**
 * V9 Phase 5.2: جدول اقلام سند انبار با وضعیت تخصیص رزرو و خلاصه رسید خرید —
 * استخراج‌شده از DocumentsPage.
 */
export function DocItemsTable({
  docItems,
  actionType,
  currencyLabel,
  totalSum,
  getItemReservationSummary,
  onUpdateItemQty,
  onUpdateItemPrice,
  onRemove,
  onEditItem,
  canEditItem = false
}: DocItemsTableProps) {
  if (docItems.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-2">
        <Package className="w-8 h-8 text-slate-400 mx-auto" />
        <p className="text-xs font-bold text-slate-600">هنوز هیچ کالایی به جدول اقلام این سند اضافه نشده است.</p>
        <p className="text-[11px] text-slate-400">کالاهای مورد نظر را از کادر بالا جستجو کرده، تعداد و قیمت خرید را وارد نموده و دکمه افزودن را فشار دهید.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900 text-white border-b border-slate-800 font-bold text-xs">
            <tr>
              <th className="p-3 text-center">#</th>
              <th className="p-3">کد کالا</th>
              <th className="p-3">نام و تصویر کالا</th>
              <th className="p-3 text-center">تعداد / مقدار سند</th>
              {actionType === 'in' && (
                <>
                  <th className="p-3 text-center">قیمت خرید واحد (فی)</th>
                  <th className="p-3 text-center">مبلغ کل ردیف ({currencyLabel})</th>
                </>
              )}
              {actionType === 'out' && <th className="p-3 text-center">وضعیت تخصیص رزرو</th>}
              <th className="p-3 text-center">حذف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {docItems.map((d, i) => {
              const resSummary = getItemReservationSummary(d.item);
              const lineTotal = d.quantity * (d.unitPrice || 0);

              return (
                <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                  <td className="p-3 font-mono font-bold text-blue-900">{d.item.code}</td>
                  <td className="p-3 font-bold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div 
                        onClick={() => canEditItem && onEditItem && onEditItem(d.item)}
                        className={`w-9 h-9 rounded-lg border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 ${canEditItem && onEditItem ? 'cursor-pointer hover:ring-2 hover:ring-blue-400' : ''}`}
                        title={canEditItem && onEditItem ? 'کلیک جهت مشاهده یا ویرایش کالا و تصویر' : undefined}
                      >
                        {d.item.thumbnail || d.item.image ? (
                          <img 
                            src={d.item.thumbnail || d.item.image} 
                            alt={d.item.name} 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer" 
                          />
                        ) : (
                          <Package size={16} className="text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 truncate">{d.item.name}</span>
                          {canEditItem && onEditItem && (
                            <button
                              type="button"
                              onClick={() => onEditItem(d.item)}
                              className="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors"
                              title="ویرایش مشخصات یا افزودن/تغییر تصویر کالا"
                            >
                              <Edit3 size={13} />
                            </button>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2">
                          <span>دسته: {d.item.category || 'عمومی'}</span>
                          {d.item.current_stock !== undefined && (
                            <span className="font-mono">موجودی: {d.item.current_stock} {d.item.unit}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-2">
                      <input 
                        type="number" 
                        min="0" 
                        step="any"
                        value={d.quantity} 
                        onChange={(e) => onUpdateItemQty(i, Number(e.target.value))} 
                        className="w-24 border border-slate-200 rounded-xl px-2.5 py-1 text-center font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" 
                        dir="ltr"
                      />
                      <span className="text-slate-500 font-bold">{d.item.unit}</span>
                    </div>
                  </td>
                  {actionType === 'in' && (
                    <>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <input 
                            type="number" 
                            min="0" 
                            step="any"
                            value={d.unitPrice} 
                            onChange={(e) => onUpdateItemPrice(i, Number(e.target.value))} 
                            className="w-32 border border-slate-200 rounded-xl px-2.5 py-1 text-left font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" 
                            dir="ltr"
                          />
                        </div>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-900">
                        {formatPersianPrice(lineTotal, currencyLabel)}
                      </td>
                    </>
                  )}
                  {actionType === 'out' && (
                    <td className="p-3 text-center">
                      {resSummary.reservedForSelectedProject > 0 ? (
                        <span className="px-2.5 py-1 bg-purple-100 text-purple-950 rounded-lg border border-purple-300 font-bold inline-flex items-center gap-1">
                          <Lock size={12} />
                          <span>از سهم رزرو پروژه ({resSummary.reservedForSelectedProject} {d.item.unit})</span>
                        </span>
                      ) : resSummary.reservedForOtherProjects > 0 ? (
                        <span className="px-2.5 py-1 bg-amber-100 text-amber-950 rounded-lg border border-amber-300 font-bold inline-flex items-center gap-1">
                          <AlertTriangle size={12} />
                          <span>از موجودی آزاد (غیر رزروی)</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg border border-slate-200 font-bold">
                          موجودی عادی آزاد
                        </span>
                      )}
                    </td>
                  )}
                  <td className="p-3 text-center">
                    <button 
                      type="button" 
                      onClick={() => onRemove(d.item.id)} 
                      className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded-xl transition-colors cursor-pointer"
                      title="حذف این ردیف"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Total Purchase Summary Card for Receipts */}
      {actionType === 'in' && (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h4 className="font-bold text-emerald-950 text-sm">خلاصه رسید خرید مواد اولیه و کالا (فرآیند متصل به ورکفلو)</h4>
              <p className="text-xs text-emerald-700">
                پس از ثبت نهایی، گردش کار تاییدات مالی آغاز گردیده، سند دوبل خرید و پرداخت توسط حسابداری صادر و پس از تایید مدیر مالی موجودی انبار به‌روزرسانی می‌شود.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 self-end sm:self-auto bg-white px-4 py-2.5 rounded-xl border border-emerald-300 shadow-2xs">
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block font-medium">مجموع کل ارزش فاکتور خرید:</span>
              <strong className="text-base font-black text-emerald-900 font-mono">
                {formatPersianPrice(totalSum, currencyLabel)}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocItemsTable;
