import React, { useState } from 'react';
import { fetchJson } from '../api';
import { 
  X, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, 
  Layers, Wrench, Check, RotateCcw
} from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { formatPersianNumber } from '../utils';

interface InventoryRebuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  itemsList?: any[];
  defaultItemId?: number;
}

export default function InventoryRebuildModal({
  isOpen,
  onClose,
  onSuccess,
  itemsList = [],
  defaultItemId
}: InventoryRebuildModalProps) {
  const [mode, setMode] = useState<'all' | 'single'>(defaultItemId ? 'single' : 'all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(defaultItemId || null);
  const [fixWAC, setFixWAC] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any | null>(null);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (mode === 'single' && !selectedItemId) {
      setErrorMsg('لطفاً کالای مورد نظر را انتخاب نمایید.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setResultData(null);

    try {
      const res = await fetchJson('/inventory/rebuild-from-ledger', {
        method: 'POST',
        body: JSON.stringify({
          itemId: mode === 'single' ? selectedItemId : undefined,
          fixWAC
        })
      });

      setResultData(res.data || res);
      onSuccess();
    } catch (err) {
      setErrorMsg(err.message || 'خطا در اجرای بازسازی و تطبیق کاردکس');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b bg-gradient-to-l from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
              <Wrench size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg">
                همگام‌سازی و بازسازی موجودی از روی کاردکس
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                محاسبه مجدد مانده کالاها در انبارها و میانگین بهای خرید بر مبنای اسناد و فاکتورها
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {resultData ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                  <CheckCircle2 size={18} />
                  <span>عملیات بازسازی و تطبیق کاردکس با موفقیت پایان یافت</span>
                </div>
                <p className="text-xs text-emerald-700">
                  کلیه اسناد و تراکنش‌های انبار بازخوانی شده و موجودی انبارها با قطعیت ۱۰۰٪ ریاضی تطبیق داده شدند.
                </p>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 p-3 rounded-xl border">
                  <div className="text-[11px] text-slate-500">اقلام بررسی‌شده</div>
                  <div className="text-base font-bold text-slate-800 font-mono mt-1">
                    {formatPersianNumber(resultData.totalItemsChecked || 1)}
                  </div>
                </div>
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                  <div className="text-[11px] text-amber-700">مغایرت‌های اصلاح‌شده</div>
                  <div className="text-base font-bold text-amber-900 font-mono mt-1">
                    {formatPersianNumber(resultData.discrepanciesFixed || 0)}
                  </div>
                </div>
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
                  <div className="text-[11px] text-blue-700">بهای میانگین اصلاح‌شده</div>
                  <div className="text-base font-bold text-blue-900 font-mono mt-1">
                    {formatPersianNumber(resultData.wacRepairedCount || 0)}
                  </div>
                </div>
                <div className="bg-purple-50 p-3 rounded-xl border border-purple-200">
                  <div className="text-[11px] text-purple-700">موجودی اولیه تثبیت‌شده</div>
                  <div className="text-base font-bold text-purple-900 font-mono mt-1">
                    {formatPersianNumber(resultData.initialStocksSeeded || (resultData.initialStockSeeded ? 1 : 0))}
                  </div>
                </div>
              </div>

              {/* Fixed Items List */}
              {resultData.details && resultData.details.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <div className="bg-slate-100 p-2.5 font-bold text-slate-700">
                    لیست اقلام دارای مغایرت که اصلاح گردیدند ({resultData.details.length} کالا):
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                    {resultData.details.map((d: any, idx: number) => (
                      <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                        <div>
                          <span className="font-bold text-slate-800">{d.itemName}</span>
                          <span className="font-mono text-slate-400 mr-2">({d.itemCode})</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-slate-500">قبل: {d.beforeStock}</span>
                          <span className="text-slate-400">←</span>
                          <span className="text-emerald-700 font-bold">بعد: {d.afterStock}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.variance > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                            {d.variance > 0 ? `+${d.variance}` : d.variance}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Architecture Info Banner */}
              <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-xl text-xs space-y-2 text-blue-900">
                <div className="flex items-center gap-2 font-bold text-blue-800">
                  <ShieldCheck size={16} />
                  <span>نحوه عملکرد بازسازی موجودی</span>
                </div>
                <p className="leading-relaxed text-slate-600">
                  این فرآیند کلیه اسناد ورود، خروج، حواله‌های انتقال و انبارگردانی‌ها را به ترتیب تاریخ پردازش کرده و موجودی کل کالا و موجودی هر انبار را بر مبنای کاردکس واقعی اسناد به‌روزرسانی و همگام می‌سازد.
                </p>
              </div>

              {/* Scope Selection */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  دامنه اجرای بازسازی و تطبیق:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode('all')}
                    className={`p-3.5 rounded-xl border text-right transition-all ${
                      mode === 'all'
                        ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-800">تمام کاتالوگ انبار (توصیه‌شده)</div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      بررسی و تطبیق همزمان کلیه کالاها و اصلاح مغایرت‌های سراسری
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('single')}
                    className={`p-3.5 rounded-xl border text-right transition-all ${
                      mode === 'single'
                        ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-800">یک کالای خاص</div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      بازسازی هدفمند کاردکس برای یک قلم کالای منتخب
                    </div>
                  </button>
                </div>
              </div>

              {/* Single Item Selector */}
              {mode === 'single' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    انتخاب کالا <span className="text-rose-500">*</span>
                  </label>
                  <SearchableSelect
                    options={itemsList.map(it => ({
                      value: it.id,
                      label: `${it.name} (کد: ${it.code}) - موجودی سیستم: ${formatPersianNumber(it.current_stock || it.currentStock || 0)} ${it.unit}`
                    }))}
                    value={selectedItemId || ''}
                    onChange={(val) => setSelectedItemId(Number(val) || null)}
                    placeholder="جستجو و انتخاب کالا جهت تطبیق کاردکس..."
                  />
                </div>
              )}

              {/* Options */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fixWAC}
                    onChange={(e) => setFixWAC(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="font-bold text-slate-800">
                    محاسبه مجدد میانگین بهای خرید از روی فاکتورها و رسیدهای انبار
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 mr-6">
                  میانگین بهای خرید کالا را بر اساس مبالغ ریالی ثبت‌شده در فاکتورهای خرید بازسازی می‌کند.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl text-xs font-medium transition-colors"
          >
            {resultData ? 'بستن' : 'انصراف'}
          </button>

          {!resultData && (
            <button
              type="button"
              onClick={handleExecute}
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <RefreshCw className="animate-spin" size={14} />
                  <span>در حال بازسازی و تطبیق کاردکس...</span>
                </>
              ) : (
                <>
                  <RotateCcw size={14} />
                  <span>شروع عملیات بازسازی و تطبیق</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
