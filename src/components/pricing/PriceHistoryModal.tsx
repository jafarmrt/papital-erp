import React from 'react';
import { History, Filter, X, RefreshCw, Clock, Tag } from 'lucide-react';
import { cn, formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';

interface PriceHistoryModalProps {
  historyItem: { id: number; name: string; code: string } | null;
  onClose: () => void;
  historyData: any[];
  loadingHistory: boolean;
  strategyFilter: string;
  onStrategyFilterChange: (key: string) => void;
  getStrategyCanonicalKey: (title: string) => string | null | undefined;
  formatStrategyDisplayTitle: (title: string) => string;
  formatPersianDateTime: (val: any) => string;
}

/**
 * V9 Phase 5.2: مودال تاریخچه سوابق قیمت کالا — استخراج‌شده از PricingPage.
 */
export function PriceHistoryModal({
  historyItem,
  onClose,
  historyData,
  loadingHistory,
  strategyFilter,
  onStrategyFilterChange,
  getStrategyCanonicalKey,
  formatStrategyDisplayTitle,
  formatPersianDateTime
}: PriceHistoryModalProps) {
  if (!historyItem) return null;

  const activeIdsByCanonical = new Set<number>();
  const seenCanonical = new Set<string>();

  if (Array.isArray(historyData)) {
    historyData.forEach((h: any) => {
      if (h.isDeleted !== 1 && h.is_deleted !== 1) {
        const canKey = getStrategyCanonicalKey(h.title);
        if (canKey && !seenCanonical.has(canKey)) {
          seenCanonical.add(canKey);
          activeIdsByCanonical.add(h.id);
        }
      }
    });
  }

  const filteredHistory = historyData.filter((h: any) => {
    if (strategyFilter === 'all') return true;
    return getStrategyCanonicalKey(h.title) === strategyFilter;
  });

  // Extract distinct strategies present in history
  const distinctStrategiesInHistory: string[] = Array.from(
    new Set(historyData.map((h: any) => formatStrategyDisplayTitle(h.title)))
  );

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in duration-150 flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/30 flex items-center justify-center text-amber-400">
              <History size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                تاریخچه سوابق تغییرات قیمت
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                کالا: <strong className="text-indigo-200">{historyItem.name}</strong> ({historyItem.code})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Strategy Filter Tabs inside Modal */}
        {distinctStrategiesInHistory.length > 1 && (
          <div className="p-2.5 bg-slate-100 border-b flex items-center gap-1.5 overflow-x-auto shrink-0">
            <span className="text-[11px] font-bold text-slate-600 ml-1 flex items-center gap-1">
              <Filter size={12} />
              سیاست:
            </span>
            <button
              onClick={() => onStrategyFilterChange('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                strategyFilter === 'all'
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white text-slate-600 hover:bg-slate-200"
              )}
            >
              همه سیاست‌ها ({formatPersianNumber(historyData.length)})
            </button>
            {distinctStrategiesInHistory.map(st => {
              const canKey = getStrategyCanonicalKey(st);
              const count = historyData.filter((h: any) => getStrategyCanonicalKey(h.title) === canKey).length;
              return (
                <button
                  key={st}
                  onClick={() => onStrategyFilterChange(canKey || '')}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                    strategyFilter === canKey
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {st} ({formatPersianNumber(count)})
                </button>
              );
            })}
          </div>
        )}

        {/* History List */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {loadingHistory ? (
            <div className="text-center py-10 text-xs text-slate-400 flex flex-col items-center gap-2">
              <RefreshCw size={20} className="animate-spin text-blue-500" />
              در حال دریافت سوابق قیمت کالا...
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400">
              هیچ سابقه قیمتی برای این کالا ثبت نشده است.
            </div>
          ) : (
            filteredHistory.map((h: any, idx: number) => {
              const isDeleted = h.is_deleted === 1 || h.isDeleted === 1;
              const isActive = !isDeleted && activeIdsByCanonical.has(h.id);
              const displayTitle = formatStrategyDisplayTitle(h.title);

              return (
                <div key={`ph-item-${h.id || idx}-${idx}`} className={cn(
                  "p-3 rounded-xl border flex justify-between items-center text-xs transition-colors",
                  isActive ? "bg-emerald-50/40 border-emerald-200" : isDeleted ? "bg-rose-50/30 border-rose-100 opacity-75" : "bg-slate-50 border-slate-200/80 hover:bg-slate-100/60"
                )}>
                  <div className="space-y-1">
                    <div className="font-bold text-slate-800 flex items-center gap-2">
                      <Tag size={13} className={isActive ? "text-emerald-600" : "text-blue-600"} />
                      <span>سطح قیمت: <strong className="text-slate-900">{displayTitle}</strong></span>
                      {isDeleted ? (
                        <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">حذف‌شده</span>
                      ) : isActive ? (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                          قیمت فعال جاری
                        </span>
                      ) : (
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">سابقه قبلی (جایگزین‌شده)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Clock size={12} className="text-slate-400" />
                      <span>زمان ثبت: <strong className="font-sans text-slate-700">{formatPersianDateTime(h.updated_at || h.updatedAt || h.created_at || h.createdAt)}</strong></span>
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className={cn(
                      "font-mono font-bold px-3 py-1 rounded-xl border text-xs",
                      isActive ? "text-emerald-800 bg-emerald-100/80 border-emerald-300" : "text-blue-800 bg-blue-50/80 border-blue-200"
                    )}>
                      {formatPersianPrice(h.price)} {formatCurrencyLabel(h.currency)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-50 border-t flex justify-between items-center shrink-0">
          <span className="text-[11px] text-slate-500">
            تعداد کل سوابق: {formatPersianNumber(filteredHistory.length)} ردیف
          </span>
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

export default PriceHistoryModal;
