import React, { useState, useEffect, useEffectEvent, useId } from 'react';
import { fetchJson } from '../api';
import { X, RefreshCw, ArrowLeftRight, Warehouse, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { formatPersianNumber, parseCleanNumber, errorMessageOf, toStorageDate, getTodayJalaliDate } from '../utils';
import { JalaliDateInput } from './common/JalaliDateInput';
import { PICK_LIST_URLS } from '../lib/permissions/pickLists';
import { refNumberToSend } from '../lib/documents/documentRefRules';
import { DecimalInput } from './common/DecimalInput';
import { DialogLayer } from './common/DialogLayer';
import { useWarehousesQuery, type WarehouseItem } from '../hooks/queries/useSettingsQueries';
import { useNextDocumentRefQuery, usePickedItemStockQuery, type StockPickItem } from '../hooks/queries/useStockWindowQueries';
import { useOpeningRead } from '../hooks/queries/readOnEveryOpening';

const NO_WAREHOUSES: WarehouseItem[] = [];

interface WarehouseTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** کالای انتخاب‌شده، همان ردیف `GET /items/options` */
type TransferPickItem = StockPickItem;

/** v10.0.183 (OBS-R1-86): برچسب کالا در انتخابگر انتقال */
export function transferItemOption(it: TransferPickItem) {
  return {
    value: it.id,
    label: `${it.name} (کد: ${it.code}) - موجودی کل: ${formatPersianNumber(it.current_stock || it.currentStock || 0)} ${it.unit}`,
  };
}

export default function WarehouseTransferModal({
  isOpen,
  onClose,
  onSuccess
}: WarehouseTransferModalProps) {
  const fieldId = useId();
  // v10.0.183 (OBS-R1-86): کالا با جست‌وجوی سرور انتخاب می‌شود؛ فهرست کامل کالاها خوانده نمی‌شود
  const [pickedItem, setSelectedItem] = useState<TransferPickItem | null>(null);
  // 10.3 (ARCH review finding 3): the picked item's stock is read again on every opening and whenever a stock change
  // elsewhere invalidates `items`, so the window checks the quantity against the stock as it is now
  const pickedStock = useOpeningRead(usePickedItemStockQuery(pickedItem, isOpen), isOpen);
  const selectedItem = pickedStock.current ?? pickedItem;
  const selectedItemId = selectedItem?.id ?? null;
  // the warehouses (the shared list; a warehouse saved in settings refreshes it) and the next transfer number (again
  // after any document change) are read on every opening; only what this opening read counts
  const warehousesQuery = useWarehousesQuery({ enabled: isOpen, readOnEveryOpening: true });
  const warehousesRead = useOpeningRead(warehousesQuery, isOpen);
  const warehouses = warehousesRead.data ?? NO_WAREHOUSES;
  const nextRefRead = useOpeningRead(useNextDocumentRefQuery('transfer', isOpen), isOpen);
  const nextRef = nextRefRead.data ?? '';
  const [fromLocation, setFromLocation] = useState<string>('');
  const [toLocation, setToLocation] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  // v7.0.136 (TD-232): امروز در منطقه زمانی کسب‌وکار (نه UTC) و انتخاب با تقویم شمسی؛ مقدار ISO می‌ماند
  const [date, setDate] = useState<string>(() => toStorageDate(getTodayJalaliDate()) || '');
  const [refNumber, setRefNumber] = useState<string>('');
  // v9.0.327 (TD-783): شماره پیشنهادی سرور؛ دست‌نخورده «auto» فرستاده می‌شود
  const [suggestedRef, setSuggestedRef] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const loadingInit = isOpen && warehousesRead.data === undefined && warehousesQuery.isFetching;
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // the first two warehouses are the default source and destination once on each opening
  const [warehouseDefaultsDue, setWarehouseDefaultsDue] = useState(false);

  // each opening starts clean; the next number fills the field when this opening reads it (below)
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setWarehouseDefaultsDue(true);
    setRefNumber('');
    setSuggestedRef('');
  }, [isOpen]);

  useEffect(() => {
    if (!warehouseDefaultsDue || warehouses.length === 0) return;
    setWarehouseDefaultsDue(false);
    setFromLocation(warehouses[0].code);
    if (warehouses.length >= 2) setToLocation(warehouses[1].code);
  }, [warehouseDefaultsDue, warehouses]);

  // a new next number (this opening's, or a later one after a document saved elsewhere): an untouched number follows
  // it, a number the user typed stays
  const followNextRef = useEffectEvent((next: string) => {
    if (!isOpen || !next) return;
    if (refNumber === suggestedRef) setRefNumber(next);
    setSuggestedRef(next);
  });
  useEffect(() => {
    followNextRef(nextRef);
  }, [nextRef]);

  // one message for each failed read
  const failedAt = Math.max(warehousesRead.failedAt, nextRefRead.failedAt);
  useEffect(() => {
    if (failedAt) setErrorMsg('خطا در دریافت لیست کالاها و انبارها');
  }, [failedAt]);

  const selectedItemStocks = selectedItem?.stocks || {};
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
    const numQty = parseCleanNumber(quantity, 0);
    if (numQty <= 0) {
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
      const res = await fetchJson<{ data?: { refNumber?: string } }>('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          itemId: selectedItemId,
          fromLocation,
          toLocation,
          quantity: numQty,
          date,
          refNumber: refNumberToSend('transfer', refNumber, suggestedRef),
          notes
        })
      });

      // v9.0.80 (TD-489): انتقال سند «حواله انتقال» با شماره خودش می‌سازد
      const issuedRef = res?.data?.refNumber;
      setSuccessMsg(`حواله انتقال${issuedRef ? ` شماره «${issuedRef}»` : ''} صادر و موجودی انبارها به‌روزرسانی شد.`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMsg(errorMessageOf(err) || 'خطا در ثبت حواله انتقال');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <DialogLayer onClose={onClose} disabled={submitting} />
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
          <button aria-label="بستن" 
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
                <label htmlFor={`${fieldId}-selected-item-id`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                  انتخاب کالا جهت انتقال <span className="text-rose-500">*</span>
                </label>
                <SearchableSelect
                  id={`${fieldId}-selected-item-id`}
                  fetchUrl={PICK_LIST_URLS.items}
                  mapResultToOption={transferItemOption}
                  maxResults={20}
                  value={selectedItemId || ''}
                  valueLabel={selectedItem ? transferItemOption(selectedItem).label : undefined}
                  onChange={(val, raw) => setSelectedItem(Number(val) && raw ? raw as TransferPickItem : null)}
                  placeholder="جست‌وجو و انتخاب کالا..."
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
                  <label htmlFor={`${fieldId}-from-location`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    انبار مبدا (کاهش موجودی) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id={`${fieldId}-from-location`}
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
                      موجودی قابل انتقال در مبدا: <span className="font-bold text-slate-800 font-mono">{formatPersianNumber(availableSourceStock)} {selectedItem.unit}</span>
                    </div>
                  )}
                </div>

                {/* To Location */}
                <div>
                  <label htmlFor={`${fieldId}-to-location`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    انبار مقصد (افزایش موجودی) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id={`${fieldId}-to-location`}
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
                  <label htmlFor={`${fieldId}-quantity`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    تعداد / مقدار انتقال <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <DecimalInput
                      id={`${fieldId}-quantity`}
                      step="any"
                      min="0.001"
                      placeholder="۰"
                      value={quantity}
                      onValueChange={(v) => setQuantity(v)}
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
                  <label htmlFor={`${fieldId}-ref-number`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    شماره حواله / عطف
                  </label>
                  <input
                    id={`${fieldId}-ref-number`}
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="TR-..."
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor={`${fieldId}-date`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    تاریخ انتقال
                  </label>
                  <JalaliDateInput
                    id={`${fieldId}-date`}
                    value={date}
                    onChange={setDate}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor={`${fieldId}-notes`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                  علت انتقال / توضیحات
                </label>
                <textarea
                  id={`${fieldId}-notes`}
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
