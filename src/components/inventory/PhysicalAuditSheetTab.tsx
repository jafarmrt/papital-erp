import React, { useState, useEffect } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';

interface AuditItemInput {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  system_stock_computed: number;
  physical_stock: string;
}

interface PhysicalAuditSheetTabProps {
  selectedLocation: string;
  setSelectedLocation: (loc: string) => void;
  nextRef: string;
  notes: string;
  setNotes: (val: string) => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  categoryFilter: string;
  setCategoryFilter: (val: string) => void;
  categories: string[];
  filteredItems: AuditItemInput[];
  auditedItemsMap: Record<number, AuditItemInput>;
  submitting: boolean;
  errorMsg: string | null;
  successMsg: string | null;
  handlePhysicalChange: (itemId: number, value: string) => void;
  handleApplyCurrentStockAsPhysical: () => void;
  handleSubmitAudit: () => void;
}

export function PhysicalAuditSheetTab({
  selectedLocation,
  setSelectedLocation,
  nextRef,
  notes,
  setNotes,
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  categories,
  filteredItems,
  auditedItemsMap,
  submitting,
  errorMsg,
  successMsg,
  handlePhysicalChange,
  handleApplyCurrentStockAsPhysical,
  handleSubmitAudit
}: PhysicalAuditSheetTabProps) {
  const auditedCount = Object.keys(auditedItemsMap).length;
  const [warehouses, setWarehouses] = useState<any[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/warehouses', { signal: controller.signal })
      .then((res: any) => {
        const list = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        if (list.length > 0) {
          setWarehouses(list);
        } else {
          setWarehouses([{ id: 'main', name: 'انبار مرکزی', code: 'main' }]);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load warehouses in audit sheet:', err);
        toast.error('خطا در دریافت لیست انبارها');
        setWarehouses([{ id: 'main', name: 'انبار مرکزی', code: 'main' }]);
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-xs font-bold">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs font-bold">
          {successMsg}
        </div>
      )}

      {/* Audit Header Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 font-bold mb-1">شماره ارجاع / سند انبارگردانی:</label>
            <input
              type="text"
              readOnly
              value={nextRef}
              className="w-full p-2.5 bg-slate-100 border border-slate-300 rounded-xl font-mono font-bold text-slate-700"
            />
          </div>

          <div>
            <label className="block text-slate-500 font-bold mb-1">موقعیت انبار جهت شمارش:</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500"
            >
              {warehouses.map((w: any) => (
                <option key={w.id || w.code || w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-slate-500 font-bold mb-1">توضیحات و بابت انبارگردانی:</label>
            <input
              type="text"
              placeholder="مثلاً: انبارگردانی پایان سال ۱۴۰۳ - تیم شمارش ۲"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Filter & Mass Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative min-w-[200px]">
              <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="جستجوی کد یا نام کالا..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="p-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none font-medium"
            >
              <option value="all">تمام دسته‌بندی‌ها</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyCurrentStockAsPhysical}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              کپی موجودی اسمی به موجودی فیزیکی برای تمام اقلام
            </button>

            <button
              type="button"
              disabled={submitting || auditedCount === 0}
              onClick={handleSubmitAudit}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-md disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <ClipboardCheck size={16} />
              <span>{submitting ? 'در حال ثبت...' : `ثبت نهایی سند انبارگردانی (${auditedCount} کالا)`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                <th className="py-3 px-3 text-center">#</th>
                <th className="py-3 px-3">کد کالا</th>
                <th className="py-3 px-4">نام کالا و دسته‌بندی</th>
                <th className="py-3 px-3 text-center">واحد</th>
                <th className="py-3 px-3 text-center bg-blue-50 text-blue-900 border-x border-blue-100">
                  موجودی سیستمی (موقعیت {selectedLocation})
                </th>
                <th className="py-3 px-3 text-center bg-emerald-50 text-emerald-900 border-x border-emerald-100 w-48">
                  موجودی فیزیکی واقعی (شمارش‌شده)
                </th>
                <th className="py-3 px-3 text-center">مغایرت انبارگردانی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                    هیچ کالایی برای شمارش فیزیکی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const physVal = parseFloat(item.physical_stock);
                  const hasVal = !isNaN(physVal);
                  const diff = hasVal ? physVal - item.system_stock_computed : 0;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">{item.code}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{item.name}</div>
                        <div className="text-[11px] text-slate-500">{item.category}</div>
                      </td>
                      <td className="py-3 px-3 text-center text-slate-600">{item.unit || 'عدد'}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold bg-blue-50/40 text-blue-900 border-x border-blue-100">
                        {formatPersianNumber(item.system_stock_computed)}
                      </td>
                      <td className="py-3 px-3 bg-emerald-50/40 border-x border-emerald-100">
                        <input
                          type="number"
                          step="any"
                          placeholder="عدد شمارش شده..."
                          value={item.physical_stock}
                          onChange={(e) => handlePhysicalChange(item.id, e.target.value)}
                          className="w-full p-2 bg-white border border-emerald-300 rounded-xl text-center font-mono font-bold text-emerald-900 outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-bold">
                        {!hasVal ? (
                          <span className="text-slate-300">-</span>
                        ) : diff === 0 ? (
                          <span className="text-emerald-600">بدون مغایرت (۰)</span>
                        ) : diff > 0 ? (
                          <span className="text-blue-600 font-bold dir-ltr inline-block">+{diff} (کسری سیستمی)</span>
                        ) : (
                          <span className="text-rose-600 font-bold dir-ltr inline-block">{diff} (کسری فیزیکی)</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
