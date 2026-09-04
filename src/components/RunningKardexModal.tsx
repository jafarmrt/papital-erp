import React, { useState, useEffect, useMemo } from 'react';
import { fetchJson } from '../api';
import { 
  X, RefreshCw, ArrowDownRight, ArrowUpRight, Download, 
  Search, Layers, DollarSign, Calendar, Filter, ShieldCheck
} from 'lucide-react';
import * as xlsx from 'xlsx';
import { formatPersianNumber, formatPersianPrice, formatPersianDate } from '../utils';
import { useAppCurrency } from '../hooks/useAppCurrency';

interface RunningKardexModalProps {
  itemId: number;
  isOpen: boolean;
  onClose: () => void;
}

export default function RunningKardexModal({ itemId, isOpen, onClose }: RunningKardexModalProps) {
  const appCurrency = useAppCurrency();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all');

  const loadKardex = async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await fetchJson(`/inventory/item-kardex/${itemId}`);
      // V10-0.2: نرمال‌سازی دفاعی — هر شکل پاسخ (پاکت کامل یا آرایه خام legacy)
      // به ساختار { item, summary, entries } تبدیل می‌شود؛ هیچ deref بدون گارد نیست.
      let normalized: any;
      if (Array.isArray(res)) {
        normalized = { item: null, summary: null, entries: res };
      } else if (Array.isArray(res?.entries)) {
        normalized = res;
      } else if (Array.isArray(res?.data)) {
        normalized = { item: res.data.item ?? null, summary: res.data.summary ?? null, entries: res.data.entries ?? [] };
      } else {
        normalized = { item: null, summary: null, entries: [] };
      }
      setData(normalized);
    } catch (err) {
      setError(err.message || 'خطا در بارگذاری کاردکس کالا');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && itemId) {
      loadKardex();
    }
  }, [isOpen, itemId]);

  const safeEntries = useMemo(() => {
    if (Array.isArray(data?.entries)) return data.entries;
    if (Array.isArray(data?.data?.entries)) return data.data.entries;
    return [];
  }, [data]);

  const filteredEntries = useMemo(() => {
    return safeEntries.filter((entry: any) => {
      if (filterType !== 'all' && entry.type !== filterType) return false;
      if (selectedLocation !== 'all' && entry.location !== selectedLocation) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const matchRef = String(entry.documentRef || '').toLowerCase().includes(s);
        const matchNotes = String(entry.notes || '').toLowerCase().includes(s);
        const matchDocType = String(entry.documentType || '').toLowerCase().includes(s);
        const matchUser = String(entry.createdBy || '').toLowerCase().includes(s);
        if (!matchRef && !matchNotes && !matchDocType && !matchUser) return false;
      }
      return true;
    });
  }, [safeEntries, filterType, selectedLocation, search]);

  const uniqueLocations = useMemo(() => {
    const locs = new Set<string>();
    safeEntries.forEach((e: any) => {
      if (e.location) locs.add(e.location);
    });
    return Array.from(locs);
  }, [safeEntries]);

  const handleExport = () => {
    if (!data?.item || !filteredEntries.length) return;
    try {
      const rows = filteredEntries.map((e: any, idx: number) => ({
        'ردیف': idx + 1,
        'تاریخ': formatPersianDate(e.date),
        'نوع تراکنش': e.type === 'in' ? 'ورود به انبار' : 'خروج از انبار',
        'مقدار': e.quantity,
        'واحد': data.item?.unit || '',
        'قیمت واحد': e.unitPrice,
        'مبلغ کل': e.totalAmount,
        'انبار / موقعیت': e.location,
        'مانده در این انبار': e.runningLocationStock,
        'مانده کل موجودی': e.runningGlobalStock ?? e.runningBalance,
        'میانگین بهای خرید': e.runningWac,
        'ارزش کل مانده': e.runningTotalValue,
        'شماره سند/عطف': e.documentRef,
        'نوع سند': e.documentType,
        'توضیحات': e.notes,
        'کاربر': e.createdBy
      }));

      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'کاردکس کالا');
      xlsx.writeFile(wb, `Kardex_${data.item?.code || itemId}.xlsx`);
    } catch (err) {
      console.error('Error exporting kardex:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b bg-gradient-to-l from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
              <Layers size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                کاردکس و ریز گردش کالا
                {data?.item && (
                  <span className="text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-bold">
                    {data.item.code}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ردیابی جریان مقداری و ریالی، مانده متوالی بعد از هر تراکنش و میانگین بهای خرید
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
              <RefreshCw className="animate-spin text-blue-600" size={32} />
              <span className="text-sm font-medium">در حال محاسبه و بازخوانی زنجیره کاردکس...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
              {error}
            </div>
          ) : data?.item && data?.summary ? (
            <>
              {/* Item Info & Metrics Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Item Details */}
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-1 text-xs">
                  <div className="flex justify-between items-center text-slate-500">
                    <span>نام کالا:</span>
                    <strong className="text-slate-800 text-sm font-medium">{data.item?.name || '-'}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>دسته‌بندی / واحد:</span>
                    <span className="text-slate-700">{data.item?.category || '—'} / {data.item?.unit || 'عدد'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>نوع کالا:</span>
                    <span className="text-slate-700">{data.item?.type === 'product' ? 'محصول نهایی' : 'ماده اولیه'}</span>
                  </div>
                </div>

                {/* Inbound / Outbound */}
                <div className="bg-emerald-50/70 border border-emerald-200 p-4 rounded-xl space-y-1 text-xs">
                  <div className="flex justify-between items-center text-emerald-800">
                    <span>مجموع ورود به انبار:</span>
                    <strong className="text-emerald-900 text-sm font-mono">{formatPersianNumber(data.summary?.totalIn ?? 0)} {data.item?.unit || ''}</strong>
                  </div>
                  <div className="flex justify-between items-center text-rose-700">
                    <span>مجموع خروج از انبار:</span>
                    <strong className="text-rose-900 text-sm font-mono">{formatPersianNumber(data.summary?.totalOut ?? 0)} {data.item?.unit || ''}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>تعداد کل تراکنش‌ها:</span>
                    <span className="text-slate-700 font-mono">{formatPersianNumber(data.summary?.transactionCount ?? 0)} سند</span>
                  </div>
                </div>

                {/* Net Stock Balance */}
                <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-xl space-y-1 text-xs">
                  <div className="flex justify-between items-center text-blue-800">
                    <span>مانده کل کاردکس:</span>
                    <strong className="text-blue-900 text-base font-bold font-mono">
                      {formatPersianNumber(data.summary?.netBalance ?? 0)} {data.item?.unit || ''}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>موجودی ثبت‌شده کالا:</span>
                    <span className="text-slate-700 font-mono font-medium">{formatPersianNumber(data.item?.currentStock ?? 0)} {data.item?.unit || ''}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>وضعیت انطباق:</span>
                    {Math.abs((data.summary?.netBalance ?? 0) - (data.item?.currentStock ?? 0)) < 0.0001 ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1">
                        <ShieldCheck size={13} /> کاملاً منطبق
                      </span>
                    ) : (
                      <span className="text-rose-600 font-bold">مغایرت موجودی!</span>
                    )}
                  </div>
                </div>

                {/* Valuation */}
                <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-xl space-y-1 text-xs">
                  <div className="flex justify-between items-center text-amber-900">
                    <span>میانگین بهای خرید:</span>
                    <strong className="text-amber-950 font-mono">{formatPersianPrice(data.item?.weightedAverageCost, appCurrency)}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>ارزش ریالی موجودی:</span>
                    <strong className="text-slate-800 font-mono text-sm">{formatPersianPrice(data.summary?.valuation, appCurrency)}</strong>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    محاسبه شده بر مبنای آخرین گردش‌های ورود
                  </div>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Search */}
                  <div className="relative min-w-[200px]">
                    <Search className="absolute right-3 top-2 text-slate-400" size={15} />
                    <input
                      type="text"
                      placeholder="جستجو در عطف، توضیحات، کاربر..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-3 pr-9 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Type Filter */}
                  <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 text-xs">
                    <button
                      onClick={() => setFilterType('all')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${filterType === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      همه
                    </button>
                    <button
                      onClick={() => setFilterType('in')}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${filterType === 'in' ? 'bg-emerald-600 text-white font-medium' : 'text-emerald-700 hover:bg-emerald-50'}`}
                    >
                      <ArrowDownRight size={13} /> ورود
                    </button>
                    <button
                      onClick={() => setFilterType('out')}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${filterType === 'out' ? 'bg-rose-600 text-white font-medium' : 'text-rose-700 hover:bg-rose-50'}`}
                    >
                      <ArrowUpRight size={13} /> خروج
                    </button>
                  </div>

                  {/* Location Filter */}
                  {uniqueLocations.length > 1 && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span>انبار:</span>
                      <select
                        value={selectedLocation}
                        onChange={(e) => setSelectedLocation(e.target.value)}
                        className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="all">تمام انبارها</option>
                        {uniqueLocations.map(loc => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    نمایش {formatPersianNumber(filteredEntries.length)} از {formatPersianNumber(safeEntries.length)} تراکنش
                  </span>
                  <button
                    onClick={handleExport}
                    disabled={filteredEntries.length === 0}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <Download size={14} /> خروجی اکسل
                  </button>
                </div>
              </div>

              {/* Transactions Ledger Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">تاریخ</th>
                      <th className="p-3">نوع رویداد</th>
                      <th className="p-3 text-center">مقدار</th>
                      <th className="p-3 text-center">موقعیت انبار</th>
                      <th className="p-3 text-center">مانده انبار</th>
                      <th className="p-3 text-center">مانده کل لحظه‌ای</th>
                      <th className="p-3 text-center">قیمت واحد</th>
                      <th className="p-3 text-center">میانگین بهای خرید</th>
                      <th className="p-3">شماره سند / عطف</th>
                      <th className="p-3">توضیحات و کاربر</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEntries.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400">
                          هیچ تراکنشی منطبق بر فیلترهای انتخابی یافت نشد.
                        </td>
                      </tr>
                    ) : (
                      filteredEntries.map((entry: any, idx: number) => {
                        const isIn = entry.type === 'in';
                        return (
                          <tr key={entry.transactionId || idx} className="hover:bg-slate-50/60 transition-colors">
                            <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="p-3 text-slate-700 font-mono">{formatPersianDate(entry.date)}</td>
                            <td className="p-3">
                              {isIn ? (
                                <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                                  <ArrowDownRight size={13} /> ورود
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                                  <ArrowUpRight size={13} /> خروج
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center font-mono font-bold text-slate-800">
                              {isIn ? `+${formatPersianNumber(entry.quantity)}` : `-${formatPersianNumber(entry.quantity)}`}
                            </td>
                            <td className="p-3 text-center">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono text-[11px]">
                                {entry.location || 'اصلی'}
                              </span>
                            </td>
                            <td className="p-3 text-center font-mono font-medium text-slate-700">
                              {formatPersianNumber(entry.runningLocationStock)}
                            </td>
                            <td className="p-3 text-center font-mono font-bold text-blue-900 bg-blue-50/30">
                              {formatPersianNumber(entry.runningGlobalStock)}
                            </td>
                            <td className="p-3 text-center font-mono text-slate-600">
                              {entry.unitPrice > 0 ? formatPersianPrice(entry.unitPrice) : '-'}
                            </td>
                            <td className="p-3 text-center font-mono text-amber-800 font-medium">
                              {entry.runningWAC > 0 ? formatPersianPrice(entry.runningWAC) : '-'}
                            </td>
                            <td className="p-3">
                              <div className="font-mono text-slate-800 font-medium">{entry.documentRef || '-'}</div>
                              <div className="text-[10px] text-slate-400">{entry.documentType || ''}</div>
                            </td>
                            <td className="p-3">
                              <div className="text-slate-700 max-w-[200px] truncate" title={entry.notes}>{entry.notes || '-'}</div>
                              <div className="text-[10px] text-slate-400">{entry.createdBy}</div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            ردگیری دقیق زنجیره تراکنش‌ها و اسناد کاردکس کالا
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl font-medium text-xs transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
