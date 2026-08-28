import React from 'react';
import { Item, User } from '../../types';
import { ChevronRight, ChevronLeft, Cloud, Edit2, Archive, Lock, CheckCircle2 } from 'lucide-react';
import { cn, formatPersianNumber, formatPersianPrice } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { SafeImage } from '../SafeImage';

export const parseMultiValue = (val?: string): string[] => {
  if (!val) return [];
  return val.split(/[,،]\s*/).map(s => s.trim()).filter(Boolean);
};

export const formatMultiValue = (arr: string[]): string => {
  return arr.filter(Boolean).join('، ');
};

interface ItemsTableProps {
  sortedItems: Item[];
  warehouses: any[];
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
  requestSort: (key: string) => void;
  loading: boolean;
  user: User;
  onViewImage: (url: string) => void;
  onEditItem: (item: Item) => void;
  onArchiveItem: (itemId: number) => void;
  onSyncItem?: (itemId: number) => void;
  syncingItemId?: number | null;
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (newPage: number) => void;
}

export function ItemsTable({
  sortedItems,
  warehouses,
  sortConfig,
  requestSort,
  loading,
  user,
  onViewImage,
  onEditItem,
  onArchiveItem,
  onSyncItem,
  syncingItemId,
  page,
  totalPages,
  totalItems,
  onPageChange
}: ItemsTableProps) {
  const appCurrency = useAppCurrency();
  return (
    <div className="flex-1 flex flex-col min-h-[300px] justify-between">
      <div className="overflow-auto relative flex-1">
        {loading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-xs z-10 flex items-center justify-center">
            <div className="animate-spin rounded-full h-9 w-9 border-3 border-blue-600 border-t-transparent shadow-md"></div>
          </div>
        )}
        <table className="w-full text-xs text-right border-collapse">
          <thead className="bg-slate-100/80 text-slate-700 border-b border-slate-200 sticky top-0 text-xs font-bold z-0 backdrop-blur-xs">
            <tr>
              <th className="p-3 w-16 text-center">تصویر</th>
              <th className="p-3 cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('category')}>
                دسته‌بندی {sortConfig?.key === 'category' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3 cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('code')}>
                کد شناسایی {sortConfig?.key === 'code' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3 cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('name')}>
                نام قلم کالا {sortConfig?.key === 'name' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3">مشخصات فنی</th>
              <th className="p-3 text-center">توزیع فیزیکی انبارها</th>
              <th className="p-3 text-center cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('reorder_point')}>
                نقطه سفارش {sortConfig?.key === 'reorder_point' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3 text-center cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('weighted_average_cost')}>
                ارزش خرید متحرک (WAC) {sortConfig?.key === 'weighted_average_cost' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3 text-center cursor-pointer hover:bg-slate-200/80 transition-colors" onClick={() => requestSort('current_stock')}>
                وضعیت موجودی {sortConfig?.key === 'current_stock' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-3">واحد</th>
              {user.role !== 'viewer' && <th className="p-3 text-center">عملیات</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {sortedItems.map((item, idx) => {
              const rPoint = (item as any).reorder_point || 0;
              const avgCost = (item as any).weighted_average_cost || 0;
              const isUnderReorder = item.current_stock <= rPoint && rPoint > 0;

              return (
                <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                  <td className="p-3 text-center">
                    {item.thumbnail ? (
                      <SafeImage
                        src={item.thumbnail}
                        alt={item.name}
                        onClick={() => onViewImage(item.image || item.thumbnail)}
                        className="w-9 h-9 object-cover rounded-lg shadow-sm border border-slate-200 m-auto cursor-pointer group-hover:scale-105 transition-all"
                      />
                    ) : (
                      <span className="text-[10px] text-slate-400 font-mono">#{formatPersianNumber(idx + 1)}</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600 font-medium">
                    {item.category ? (
                       <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200">{item.category}</span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="p-3 font-mono font-bold text-slate-700 dir-ltr text-right">{item.code}</td>
                  <td className="p-3 font-bold text-slate-900">{item.name}</td>
                  
                  <td className="p-3 text-slate-600 text-xs text-right">
                    <div className="flex flex-col gap-1">
                      {item.color && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-slate-400 text-[10px]">🎨 رنگ:</span>
                          {parseMultiValue(item.color).map((c: string, cIdx: number) => (
                            <span key={cIdx} className="bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.material && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-slate-400 text-[10px]">💠 جنس:</span>
                          {parseMultiValue(item.material).map((m: string, mIdx: number) => (
                            <span key={mIdx} className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.weight && <span className="text-slate-500 text-[11px]">⚖️ وزن: {formatPersianNumber(item.weight)} گرم</span>}
                      {item.size && <span className="text-slate-500 text-[11px]">📏 اندازه: {formatPersianNumber(item.size)} میلی‌متر</span>}
                      {!item.color && !item.weight && !item.material && !item.size && <span className="text-slate-300">-</span>}
                    </div>
                  </td>

                  {/* Multi-Location inventory break-up */}
                  <td className="p-3 text-center">
                    <div className="flex flex-wrap justify-center items-center gap-1.5">
                      {warehouses.map(w => {
                        const val = (item as any)[`stock_${w.code}`] || 0;
                        let badgeColor = "bg-slate-50 text-slate-700 border-slate-200";
                        if (w.code === 'main') badgeColor = "bg-indigo-50 text-indigo-700 border-indigo-200";
                        else if (w.code === 'workshop') badgeColor = "bg-orange-50 text-orange-700 border-orange-200";
                        else if (w.code === 'showroom') badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        return (
                          <span key={w.code} className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${badgeColor}`} title={w.name}>
                            {w.name}: {formatPersianNumber(val)}
                          </span>
                        );
                      })}
                    </div>
                  </td>

                  {/* Reorder Point limit */}
                  <td className="p-3 text-center font-mono font-medium text-slate-600">
                    {rPoint > 0 ? (
                      <span className={cn(
                        "px-2.5 py-0.5 rounded-full font-bold text-[10px]",
                        isUnderReorder ? "bg-red-100 text-red-700 border border-red-200" : "bg-slate-100 text-slate-700 border border-slate-200"
                      )}>
                        {formatPersianNumber(rPoint)}
                      </span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* Average Purchase Cost Badge (WAC) */}
                  <td className="p-3 text-center font-mono font-bold text-slate-800">
                    {avgCost > 0 ? (
                      <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-[11px]" title="هزینه میانگین برای کل دوره‌ها">
                        {formatPersianPrice(avgCost, appCurrency)}
                      </span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* Final Totals */}
                  <td className="p-3 text-center font-bold">
                    <div className="flex flex-col items-center gap-1">
                      <span className={cn(
                        "text-xs px-2.5 py-0.5 rounded-lg border font-mono font-bold",
                        isUnderReorder ? "bg-red-50 text-red-700 border-red-200" : "text-blue-700 bg-blue-50 border-blue-200"
                      )} title="موجودی کل انبار">
                        کل: {formatPersianNumber(item.current_stock)}
                      </span>

                      {((item as any).reserved_stock || 0) > 0 && (
                        <span 
                          className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300 font-bold flex items-center gap-1"
                          title={`رزرو شده در پروژه‌ها: ${((item as any).reservations || []).map((r: any) => `${r.projectCode} (${r.reservedQty} ${r.unit})`).join('، ')}`}
                        >
                          <Lock size={10} className="text-amber-700" />
                          رزرو: {formatPersianNumber((item as any).reserved_stock)}
                        </span>
                      )}

                      {((item as any).reserved_stock || 0) > 0 && (
                        <span 
                          className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md border border-emerald-300 font-bold flex items-center gap-1"
                          title="موجودی آزاد و قابل تخصیص"
                        >
                          <CheckCircle2 size={10} className="text-emerald-700" />
                          آزاد: {formatPersianNumber((item as any).available_stock ?? item.current_stock)}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="p-3 text-slate-600 font-medium">{item.unit}</td>
                  
                  {/* Soft Delete Control */}
                  {user.role !== 'viewer' && (
                    <td className="p-3 text-center">
                      <div className="flex justify-center items-center gap-1.5">
                        {onSyncItem && (
                          <button
                            onClick={() => onSyncItem(item.id)}
                            disabled={syncingItemId === item.id || !item.code}
                            title={!item.code ? 'کالا فاقد کد (SKU) است' : 'همگام‌سازی با ووکامرس'}
                            className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 font-bold px-2 py-1 rounded-lg flex items-center justify-center text-[11px] transition-colors cursor-pointer"
                          >
                            <Cloud size={14} className={syncingItemId === item.id ? "animate-pulse" : ""} />
                          </button>
                        )}
                        <button
                          onClick={() => onEditItem(item)}
                          className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold px-2.5 py-1 rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Edit2 size={12} />
                          ویرایش
                        </button>
                        <button
                          onClick={() => onArchiveItem(item.id)}
                          className="bg-red-50 text-red-600 hover:bg-red-100 font-bold px-2.5 py-1 rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Archive size={12} />
                          آرشیو
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!loading && sortedItems.length === 0 && (
              <tr>
                <td colSpan={11} className="p-12 text-center text-slate-400 font-medium">هیچ کالایی برای نمایش یافت نشد.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="p-3.5 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between mt-auto">
        <span className="text-xs text-slate-500 font-medium">
          نمایش {formatPersianNumber(sortedItems.length)} مورد {totalItems > 0 ? `از کل ${formatPersianNumber(totalItems)} مورد` : ''}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button 
              disabled={page === 1}
              onClick={() => onPageChange(page - 1)}
              className="p-1.5 border border-slate-300/80 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer transition-all shadow-2xs"
            >
              <ChevronRight size={16} />
            </button>
            <span className="text-xs font-bold px-2 text-slate-700">
              صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)}
            </span>
            <button 
              disabled={page === totalPages}
              onClick={() => onPageChange(page + 1)}
              className="p-1.5 border border-slate-300/80 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 cursor-pointer transition-all shadow-2xs"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ItemsTable;

