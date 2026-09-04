import React from 'react';
import { History, RefreshCw, Save } from 'lucide-react';
import { cn, formatPersianPrice, formatPersianNumber } from '../../utils';
import { Item } from '../../types';

interface PricingViewsShared {
  items: Item[];
  strategies: string[];
  appCurrency: string;
  localEdits: Record<number, Record<string, { title: string; price: string; currency: string }>>;
  savingId: number | null;
  userRole: string;
  getFieldValue: (itemId: number, strategyTitle: string) => { price: string; currency: string };
  handlePriceChange: (itemId: number, strategyTitle: string, newPrice: string, currentCurrency?: string) => void;
  handleCurrencyChange: (itemId: number, strategyTitle: string, newCurrency: string, currentPrice?: string) => void;
  getMarginBadge: (priceStr: string, wacNum?: number) => React.ReactNode;
  handleSaveItemPrices: (itemId: number) => void;
  handleOpenHistory: (item: Item) => void;
  formatStrategyDisplayTitle: (title: string) => string;
  getStrategyCanonicalKey: (title: string) => string | null | undefined;
}

/** نمای کارتی قیمت‌گذاری */
export function PricingGridView(props: PricingViewsShared) {
  const {
    items, strategies, appCurrency, localEdits, savingId, userRole,
    getFieldValue, handlePriceChange, handleCurrencyChange, getMarginBadge,
    handleSaveItemPrices, handleOpenHistory, formatStrategyDisplayTitle, getStrategyCanonicalKey
  } = props;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(item => {
        const isEdited = localEdits[item.id] !== undefined;

        return (
          <div key={item.id} className="bg-white border rounded-2xl shadow-xs overflow-hidden flex flex-col justify-between hover:border-blue-300 transition-all">
            <div className="p-4 border-b bg-slate-50/50 flex justify-between items-start gap-2">
              <div className="overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-800 truncate" title={item.name}>{item.name}</span>
                  <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono dir-ltr shrink-0">
                    {item.code}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                  <span>دسته: {item.category || 'عمومی'}</span>
                  <span>•</span>
                  <span>موجودی: {formatPersianNumber((item as any).current_stock || 0)} {item.unit}</span>
                </div>
              </div>

              <button 
                onClick={() => handleOpenHistory(item)}
                className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
                title="تاریخچه سوابق قیمت این کالا"
              >
                <History size={16} />
              </button>
            </div>

            {/* Weighted Average Cost info */}
            <div className="px-4 py-2 bg-slate-100/60 border-b flex justify-between items-center text-[11px]">
               <span className="text-slate-500">میانگین بهای خرید:</span>
               <span className="font-bold font-mono text-slate-700">
                 {(item as any).weighted_average_cost ? formatPersianPrice((item as any).weighted_average_cost, appCurrency) : 'تعریف‌نشده'}
               </span>
            </div>

            {/* Price Strategies List */}
            <div className="flex-1 p-4 flex flex-col gap-3">
              {strategies.map(st => {
                const cleanTitle = formatStrategyDisplayTitle(st);
                const canKey = getStrategyCanonicalKey(cleanTitle);
                const fieldVal = getFieldValue(item.id, cleanTitle);
                const isFieldEditing = localEdits[item.id]?.[canKey] !== undefined;
                const marginBadge = getMarginBadge(fieldVal.price, (item as any).weighted_average_cost);

                return (
                  <div key={st} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className="w-24 shrink-0 text-xs font-bold text-slate-700 truncate" title={cleanTitle}>{cleanTitle}</div>
                      <div className="flex-1 flex items-center gap-1.5 relative">
                        <input
                          type="number"
                          dir="ltr"
                          placeholder="مبلغ"
                          value={fieldVal.price}
                          onChange={(e) => handlePriceChange(item.id, cleanTitle, e.target.value, fieldVal.currency)}
                          className={cn(
                            "w-full border rounded-xl text-xs px-2.5 py-1.5 font-mono text-left focus:outline-none focus:ring-1 focus:ring-blue-500",
                            isFieldEditing ? "border-amber-400 bg-amber-50/40" : "border-slate-200 bg-white"
                          )}
                        />
                        <select
                          value={fieldVal.currency}
                          onChange={(e) => handleCurrencyChange(item.id, cleanTitle, e.target.value, fieldVal.price)}
                          className="border border-slate-200 rounded-xl text-xs px-2 py-1.5 bg-slate-50 hover:bg-white text-slate-700 font-bold shrink-0 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="IRR">ریال</option>
                          <option value="USD">دلار</option>
                          <option value="EUR">یورو</option>
                          <option value="AED">درهم</option>
                          <option value="GBP">پوند</option>
                        </select>
                      </div>
                    </div>

                    {/* Markup Suggestions & Margin Badge */}
                    <div className="flex items-center justify-between gap-1 pr-26 text-[10px]">
                      {marginBadge}
                      {Boolean((item as any).weighted_average_cost && (item as any).weighted_average_cost > 0) && (
                        <div className="flex gap-1">
                          <button onClick={() => handlePriceChange(item.id, cleanTitle, Math.round((item as any).weighted_average_cost * 1.1).toString(), fieldVal.currency)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded transition-colors cursor-pointer">+۱۰٪</button>
                          <button onClick={() => handlePriceChange(item.id, cleanTitle, Math.round((item as any).weighted_average_cost * 1.2).toString(), fieldVal.currency)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded transition-colors cursor-pointer">+۲۰٪</button>
                          <button onClick={() => handlePriceChange(item.id, cleanTitle, Math.round((item as any).weighted_average_cost * 1.3).toString(), fieldVal.currency)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded transition-colors cursor-pointer">+۳۰٪</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Item Save Action */}
            {userRole !== 'viewer' && (
              <div className="p-3 bg-slate-50 border-t flex justify-end">
                <button
                  onClick={() => handleSaveItemPrices(item.id)}
                  disabled={savingId === item.id}
                  className={cn(
                    "w-full py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all shadow-xs cursor-pointer",
                    isEdited ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-slate-900 hover:bg-slate-800 text-white"
                  )}
                >
                  {savingId === item.id ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  {isEdited ? 'ذخیره تغییرات این کالا' : 'بروزرسانی قیمت‌ها'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** نمای جدولی قیمت‌گذاری */
export function PricingTableView(props: PricingViewsShared) {
  const {
    items, strategies, appCurrency, localEdits, savingId, userRole,
    getFieldValue, handlePriceChange, handleCurrencyChange, getMarginBadge,
    handleSaveItemPrices, handleOpenHistory, formatStrategyDisplayTitle, getStrategyCanonicalKey
  } = props;

  return (
    <div className="bg-white border rounded-2xl shadow-xs overflow-x-auto">
      <table className="w-full text-right text-xs">
        <thead className="bg-slate-100 text-slate-700 font-bold border-b">
          <tr>
            <th className="p-3">کد کالا</th>
            <th className="p-3">نام کالا</th>
            <th className="p-3">دسته</th>
            <th className="p-3">میانگین بهای خرید</th>
            {strategies.map(st => (
              <th key={st} className="p-3">{formatStrategyDisplayTitle(st)}</th>
            ))}
            {userRole !== 'viewer' && <th className="p-3 text-center">عملیات</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map(item => {
            const isEdited = localEdits[item.id] !== undefined;

            return (
              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="p-3 font-mono text-slate-600 dir-ltr text-right">{item.code}</td>
                <td className="p-3 font-bold text-slate-800">{item.name}</td>
                <td className="p-3 text-slate-500">{item.category || '-'}</td>
                <td className="p-3 font-mono text-slate-600">
                  {(item as any).weighted_average_cost ? formatPersianPrice((item as any).weighted_average_cost, appCurrency) : '-'}
                </td>
                {strategies.map(st => {
                  const cleanTitle = formatStrategyDisplayTitle(st);
                  const canKey = getStrategyCanonicalKey(cleanTitle);
                  const fieldVal = getFieldValue(item.id, cleanTitle);
                  const isFieldEditing = localEdits[item.id]?.[canKey] !== undefined;
                  const marginBadge = getMarginBadge(fieldVal.price, (item as any).weighted_average_cost);
                  
                  return (
                    <td key={st} className="p-3 align-top min-w-[180px]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            dir="ltr"
                            placeholder="مبلغ"
                            value={fieldVal.price}
                            onChange={(e) => handlePriceChange(item.id, cleanTitle, e.target.value, fieldVal.currency)}
                            className={cn(
                              "w-full border rounded-xl text-xs px-2 py-1.5 font-mono text-left focus:outline-none focus:ring-1 focus:ring-blue-500",
                              isFieldEditing ? "border-amber-400 bg-amber-50/40" : "border-slate-200 bg-white"
                            )}
                          />
                          <select
                            value={fieldVal.currency}
                            onChange={(e) => handleCurrencyChange(item.id, cleanTitle, e.target.value, fieldVal.price)}
                            className="border border-slate-200 rounded-xl text-[11px] px-1.5 py-1.5 bg-slate-50 hover:bg-white text-slate-700 font-bold shrink-0 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="IRR">ریال</option>
                            <option value="USD">دلار</option>
                            <option value="EUR">یورو</option>
                            <option value="AED">درهم</option>
                            <option value="GBP">پوند</option>
                          </select>
                        </div>
                        {marginBadge && <div className="mt-0.5">{marginBadge}</div>}
                      </div>
                    </td>
                  );
                })}
                {userRole !== 'viewer' && (
                  <td className="p-3 align-top text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleSaveItemPrices(item.id)}
                        disabled={savingId === item.id}
                        className={cn(
                          "p-1.5 rounded-lg text-white font-bold transition-all shadow-xs cursor-pointer",
                          isEdited ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-900 hover:bg-slate-800"
                        )}
                        title="ذخیره قیمت‌های این کالا"
                      >
                        {savingId === item.id ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                      </button>
                      <button 
                        onClick={() => handleOpenHistory(item)}
                        className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                        title="تاریخچه سوابق قیمت"
                      >
                        <History size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
