import { useState } from 'react';
import { X, RefreshCw, ArrowDownRight, ArrowUpRight, Download, Search, Layers, ShieldCheck } from 'lucide-react';
import { downloadSheet } from '../lib/excel/downloadSheet';
import { formatPersianNumber, formatPersianDate, errorMessageOf, formatPersianCode } from '../utils';
import { kardexDocumentTypeLabel } from '../lib/documents/documentTypeTitles';
import { warehouseLabel } from '../lib/inventory/warehouseLabel';
import { useWarehousesQuery } from '../hooks/queries/useSettingsQueries';
import { useRialDisplay } from '../hooks/useAppCurrency';
import { useItemKardexQuery } from '../hooks/queries/useTransactionQueries';
import { useDebounce } from '../hooks/useDebounce';
import { fetchJson } from '../api';
import {
  normalizeRunningKardex, runningKardexEntryLabel, runningKardexPageCount, runningKardexUrl,
  type RunningKardexDirection, type RunningKardexEntry, type RunningKardexQuery,
} from '../lib/transactions/runningKardex';
import { toast } from 'react-hot-toast';
import { EXPORT_FAILED_MESSAGE, kardexExportFileName } from '../lib/inventoryAudit/exportFileNames';
import { DialogLayer } from './common/DialogLayer';
import { JalaliDateInput } from './common/JalaliDateInput';
import { ListPager } from './common/ListPager';

interface RunningKardexModalProps {
  itemId: number;
  isOpen: boolean;
  onClose: () => void;
}

const NO_ENTRIES: RunningKardexEntry[] = [];

export default function RunningKardexModal({ itemId, isOpen, onClose }: RunningKardexModalProps) {
  const rial = useRialDisplay();
  const { data: warehouses = [] } = useWarehousesQuery();
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [filterType, setFilterType] = useState<RunningKardexDirection>('all');
  // v11 phase 6.1ch (S11): the range, the filters and the page go to the server, which sends one page of rows
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const debouncedSearch = useDebounce(search.trim());
  const filters: RunningKardexQuery = {
    from: fromDate || undefined, to: toDate || undefined, type: filterType, location: selectedLocation, search: debouncedSearch || undefined,
  };
  const filtersKey = JSON.stringify(filters);
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: filtersKey, page: 1 });
  const page = pageState.key === filtersKey ? pageState.page : 1;

  // کاردکس کالا با React Query: هر بار باز شدن مودال تازه خوانده می‌شود و بستن مودال/صفحه درخواست را لغو می‌کند
  const kardexQuery = useItemKardexQuery(itemId, isOpen, { ...filters, page });
  const data = kardexQuery.data ?? null;
  // the first read fills the window with a spinner; a later page or filter keeps the rows and says it is updating
  const loading = kardexQuery.isFetching && !data;
  const updating = kardexQuery.isFetching && Boolean(data);
  const error = kardexQuery.isError ? (errorMessageOf(kardexQuery.error) || 'خطا در بارگذاری کاردکس کالا') : null;

  const pageEntries = data?.entries ?? NO_ENTRIES;
  const firstRowNumber = data ? (data.page - 1) * data.limit + 1 : 1;
  const uniqueLocations = data?.locations ?? [];
  const [exporting, setExporting] = useState(false);

  // خروجی اکسل: همه ردیف‌های منطبق با بازه و پالایه‌ها (`export=true`)، نه فقط صفحه روی صفحه
  const handleExport = async () => {
    if (!data?.item || data.total === 0 || exporting) return;
    setExporting(true);
    try {
      const all = normalizeRunningKardex(await fetchJson<unknown>(runningKardexUrl(itemId, filters, true)));
      const rows = all.entries.map((e, idx) => ({
        'ردیف': idx + 1,
        'تاریخ': formatPersianDate(e.date),
        'نوع تراکنش': e.type === 'in' ? 'ورود به انبار' : 'خروج از انبار',
        'مقدار': e.quantity,
        'واحد': data.item?.unit || '',
        'قیمت واحد (ریال)': e.unitPrice,
        'مبلغ کل (ریال)': e.totalAmount,
        'انبار / موقعیت': warehouseLabel(e.location, warehouses),
        'مانده در این انبار': e.runningLocationStock,
        'مانده کل موجودی': e.runningGlobalStock ?? e.runningBalance,
        'میانگین موزون بها (ریال)': e.runningWac,
        'ارزش کل مانده (ریال)': e.runningTotalValue,
        'شماره سند/عطف': e.documentRef,
        'نوع سند': kardexDocumentTypeLabel(e.documentType, e.documentRef),
        'وضعیت': runningKardexEntryLabel(e),
        'توضیحات': e.notes,
        'کاربر': e.createdBy
      }));

      await downloadSheet(rows, 'کاردکس کالا', kardexExportFileName(data.item?.code || itemId));
    } catch {
      toast.error(EXPORT_FAILED_MESSAGE);
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <DialogLayer onClose={onClose} />
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
                    {formatPersianCode(data.item.code)}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ردیابی جریان مقداری و ریالی، مانده متوالی بعد از هر تراکنش و میانگین موزون بها
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
                    <span>میانگین موزون بها:</span>
                    <strong className="text-amber-950 font-mono">{rial.amount(data.item?.weightedAverageCost)}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>ارزش موجودی:</span>
                    <strong className="text-slate-800 font-mono text-sm">{rial.amount(data.summary?.valuation)}</strong>
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
                      placeholder="جست‌وجو در عطف، توضیحات، کاربر..."
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
                          <option key={loc} value={loc}>{warehouseLabel(loc, warehouses)}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* v11 phase 6.1ch (S11): the range of days, on the server */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <JalaliDateInput value={fromDate} onChange={setFromDate} placeholder="از تاریخ..." containerClassName="inline-block"
                      className="w-28 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs text-center outline-none" />
                    <JalaliDateInput value={toDate} onChange={setToDate} placeholder="تا تاریخ..." containerClassName="inline-block"
                      className="w-28 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs text-center outline-none" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {formatPersianNumber(data.total)} تراکنش منطبق از {formatPersianNumber(data.summary?.transactionCount ?? 0)} تراکنش
                    {updating && ' (در حال به‌روزرسانی...)'}
                  </span>
                  <button
                    onClick={() => void handleExport()}
                    disabled={data.total === 0 || exporting}
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
                      <th className="p-3 text-center">{`قیمت واحد (${rial.label})`}</th>
                      <th className="p-3 text-center">{`میانگین موزون بها (${rial.label})`}</th>
                      <th className="p-3">شماره سند / عطف</th>
                      <th className="p-3">توضیحات و کاربر</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.opening && data.page === 1 && (
                      <tr className="bg-blue-50/40 font-bold">
                        <td className="p-3 text-slate-400 font-mono">—</td>
                        <td className="p-3 text-slate-700 font-mono">{formatPersianDate(data.opening.date)}</td>
                        <td className="p-3 text-slate-700" colSpan={4}>مانده پیش از بازه</td>
                        <td className="p-3 text-center font-mono text-blue-900 bg-blue-50/30">{formatPersianNumber(data.opening.runningBalance)}</td>
                        <td className="p-3 text-center font-mono text-slate-600">-</td>
                        <td className="p-3 text-center font-mono text-amber-800">
                          {data.opening.runningWac > 0 ? rial.number(data.opening.runningWac) : '-'}
                        </td>
                        <td className="p-3" colSpan={2}>{`ارزش: ${rial.amount(data.opening.runningTotalValue)}`}</td>
                      </tr>
                    )}
                    {pageEntries.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400">
                          هیچ تراکنشی با پالایش انتخابی یافت نشد.
                        </td>
                      </tr>
                    ) : (
                      pageEntries.map((entry, idx) => {
                        const isIn = entry.type === 'in';
                        const label = runningKardexEntryLabel(entry);
                        return (
                          <tr key={entry.transactionId || idx} className={`hover:bg-slate-50/60 transition-colors ${entry.isVoided ? 'text-slate-400 bg-slate-50' : ''}`}>
                            <td className="p-3 text-slate-400 font-mono">{formatPersianNumber(firstRowNumber + idx)}</td>
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
                                {warehouseLabel(entry.location, warehouses)}
                              </span>
                            </td>
                            <td className="p-3 text-center font-mono font-medium text-slate-700">
                              {formatPersianNumber(entry.runningLocationStock)}
                            </td>
                            <td className="p-3 text-center font-mono font-bold text-blue-900 bg-blue-50/30">
                              {formatPersianNumber(entry.runningGlobalStock)}
                            </td>
                            <td className="p-3 text-center font-mono text-slate-600">
                              {entry.unitPrice > 0 ? rial.number(entry.unitPrice) : '-'}
                            </td>
                            <td className="p-3 text-center font-mono text-amber-800 font-medium">
                              {(entry.runningWac ?? 0) > 0 ? rial.number(entry.runningWac) : '-'}
                            </td>
                            <td className="p-3">
                              <div className="font-mono text-slate-800 font-medium">{entry.documentRef || '-'}</div>
                              <div className="text-[10px] text-slate-400">{kardexDocumentTypeLabel(entry.documentType, entry.documentRef)}</div>
                              {label && <span className="inline-block mt-0.5 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{label}</span>}
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
              <ListPager page={data.page} totalPages={runningKardexPageCount(data)} total={data.total} limit={data.limit}
                onPage={(next) => setPageState({ key: filtersKey, page: next })} disabled={kardexQuery.isFetching} />
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
