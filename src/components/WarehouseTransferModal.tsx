import React, { useState, useEffect } from 'react';
import { fetchJson } from '../api';
import { 
  X, RefreshCw, ArrowLeftRight, Warehouse, AlertTriangle, 
  CheckCircle2, Layers, Calendar, FileText
} from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { formatPersianNumber } from '../utils';

interface WarehouseTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultItemId?: number;
}

export default function WarehouseTransferModal({
  isOpen,
  onClose,
  onSuccess,
  defaultItemId
}: WarehouseTransferModalProps) {
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(defaultItemId || null);
  const [fromLocation, setFromLocation] = useState<string>('');
  const [toLocation, setToLocation] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [refNumber, setRefNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [loadingInit, setLoadingInit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoadingInit(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      Promise.all([
        fetchJson('/items?limit=0'),
        fetchJson('/warehouses'),
        fetchJson('/documents/next-ref?type=transfer')
      ])
        .then(([itemsRes, whsRes, nextRefRes]) => {
          const rawItems = Array.isArray(itemsRes?.data) ? itemsRes.data : (Array.isArray(itemsRes) ? itemsRes : []);
          setItems(rawItems);
          
          const rawWhs = Array.isArray(whsRes) ? whsRes : [];
          setWarehouses(rawWhs);
          
          if (rawWhs.length >= 2) {
            setFromLocation(rawWhs[0].code);
            setToLocation(rawWhs[1].code);
          } else if (rawWhs.length === 1) {
            setFromLocation(rawWhs[0].code);
          }

          if (nextRefRes?.nextRef) {
            setRefNumber(String(nextRefRes.nextRef));
          }

          if (defaultItemId) {
            setSelectedItemId(defaultItemId);
          }
        })
        .catch(err => {
          console.error(err);
          setErrorMsg('خطا در دریافت لیست کالاها و انبارها');
        })
        .finally(() => {
          setLoadingInit(false);
        });
    }
  }, [isOpen, defaultItemId]);

  const selectedItem = items.find(i => i.id === selectedItemId);
  const selectedItemStocks = (selectedItem?.stocks as Record<string, number>) || {};
  const availableSourceStock = Number(selectedItemStocks[fromLocation] || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) {
      setErrorMsg('لطفاً کالای مورد نظر را انتخاب کنید.');
      return;
    }
    if (!fromLocation || !toLocation) {
      setErrorMsg('انتخاب انبار مبدا و انبار مقصد الزامی است.');
      return;
    }
    if (fromLocation === toLocation) {
      setErrorMsg('انبار مبدا و انبار مقصد نمی‌توانند یکسان باشند.');
      return;
    }
    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      setErrorMsg('مقدار انتقال باید یک عدد مثبت باشد.');
      return;
    }
    if (numQty > availableSourceStock) {
      setErrorMsg(`موجودی انبار مبدا کافی نیست! حداکثر موجودی قابل انتقال: ${availableSourceStock} ${selectedItem?.unit}`);
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await fetchJson('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          itemId: selectedItemId,
          fromLocation,
          toLocation,
          quantity: numQty,
          date,
          refNumber,
          notes
        })
      });

      setSuccessMsg('حواله انتقال بین انبارها با موفقیت صادر و موجودی به‌روزرسانی شد.');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || 'خطا در ثبت حواله انتقال');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b bg-gradient-to-l from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg">
                ثبت حواله انتقال بین انبارها
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                جابجایی موجودی کالا همراه با ثبت خودکار در کاردکس انبار مبداء و مقصد
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {loadingInit ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
              <RefreshCw className="animate-spin text-blue-600" size={28} />
              <span className="text-xs">در حال بارگذاری اطلاعات پایه‌ای...</span>
            </div>
          ) : (
            <>
              {/* Item Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  انتخاب کالا جهت انتقال <span className="text-rose-500">*</span>
                </label>
                <SearchableSelect
                  options={items.map(it => ({
                    value: it.id,
                    label: `${it.name} (کد: ${it.code}) - موجودی کل: ${formatPersianNumber(it.current_stock || it.currentStock || 0)} ${it.unit}`
                  }))}
                  value={selectedItemId || ''}
                  onChange={(val) => setSelectedItemId(Number(val) || null)}
                  placeholder="جستجو و انتخاب کالا..."
                />
              </div>

              {/* Item Stocks Breakdown if selected */}
              {selectedItem && (
                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs space-y-2">
                  <div className="flex justify-between items-center text-slate-600 font-medium">
                    <span>موجودی به تفکیک انبارها:</span>
                    <span className="text-blue-700 font-bold font-mono">
                      مجموع: {formatPersianNumber(selectedItem.current_stock || selectedItem.currentStock || 0)} {selectedItem.unit}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {warehouses.map(wh => {
                      const qty = Number(selectedItemStocks[wh.code] || 0);
                      const isSource = wh.code === fromLocation;
                      const isDest = wh.code === toLocation;
                      return (
                        <div 
                          key={wh.code}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 ${
                            isSource 
                              ? 'bg-rose-50 border-rose-200 text-rose-800 font-bold' 
                              : isDest 
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'
                                : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <Warehouse size={13} />
                          <span>{wh.name}:</span>
                          <span>{formatPersianNumber(qty)} {selectedItem.unit}</span>
                          {isSource && <span className="text-[10px] bg-rose-200 text-rose-900 px-1 rounded">مبدا</span>}
                          {isDest && <span className="text-[10px] bg-emerald-200 text-emerald-900 px-1 rounded">مقصد</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Warehouses Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* From Location */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    انبار مبدا (کاهش موجودی) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="">انتخاب انبار مبدا...</option>
                    {warehouses.map(wh => (
                      <option key={wh.code} value={wh.code}>
                        {wh.name} ({wh.code})
                      </option>
                    ))}
                  </select>
                  {fromLocation && selectedItem && (
                    <div className="mt-1 text-[11px] text-slate-500 font-medium">
                      موجودی قابل انتقال در مبدا: <span className="font-bold text-slate-800 font-mono">{availableSourceStock} {selectedItem.unit}</span>
                    </div>
                  )}
                </div>

                {/* To Location */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    انبار مقصد (افزایش موجودی) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="">انتخاب انبار مقصد...</option>
                    {warehouses.map(wh => (
                      <option key={wh.code} value={wh.code} disabled={wh.code === fromLocation}>
                        {wh.name} ({wh.code}) {wh.code === fromLocation ? '(مبدا)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quantity, Date & Ref */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    تعداد / مقدار انتقال <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      placeholder="۰"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {selectedItem?.unit && (
                      <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-medium">
                        {selectedItem.unit}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    شماره حواله / عطف
                  </label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="TR-..."
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    تاریخ انتقال
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  علت انتقال / توضیحات
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: انتقال قطعات جهت مونتاژ در خط تولید کارگاه..."
                  className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={submitting || loadingInit}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <RefreshCw className="animate-spin" size={14} />
                  <span>در حال ثبت انتقال...</span>
                </>
              ) : (
                <>
                  <ArrowLeftRight size={14} />
                  <span>تایید و صدور حواله انتقال</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
