import { useState } from 'react';
import { Search, ArrowDownRight, ArrowUpRight, Download, ChevronRight, ChevronLeft, Eye } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { useSearch } from '../SearchContext';
import { formatPersianNumber, formatPersianCode, formatPersianDate, extractDateString } from '../utils';
import RunningKardexModal from '../components/RunningKardexModal';
import { useTransactionsQuery } from '../hooks/queries';
import { useTransactionsExport } from '../hooks/transactions/useTransactionsExport';

export default function TransactionsPage() {
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch, clearSearch } = useSearch();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [pageSize, setPageSize] = useState(50);
  const [selectedItemIdForKardex, setSelectedItemIdForKardex] = useState<number | null>(null);

  // بازگشت به صفحه ۱ با تغییر فیلترها، همان رندر (الگوی تنظیم state هنگام رندر در React): پیش‌تر effect پس از رندر
  // صفحه را ۱ می‌کرد و پیش از آن یک درخواست اضافه برای صفحه قبلیِ فیلتر تازه فرستاده می‌شد
  const filterKey = JSON.stringify([debouncedSearchQuery, filterType, startDate, endDate, pageSize]);
  const [pageState, setPageState] = useState({ page: 1, filterKey });
  if (pageState.filterKey !== filterKey) setPageState({ page: 1, filterKey });
  const page = pageState.filterKey === filterKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ page: next, filterKey });

  const startStr = extractDateString(startDate);
  const endStr = extractDateString(endDate);

  // V4 Phase 6.2 (U-1): اتصال کوئری تراکنش‌ها به debouncedSearchQuery
  const txsQuery = useTransactionsQuery({
    page,
    limit: pageSize,
    search: debouncedSearchQuery,
    type: filterType,
    startDate: startStr || undefined,
    endDate: endStr || undefined,
  });

  const txs = txsQuery.data?.transactions ?? [];
  const totalPages = txsQuery.data?.totalPages || 1;
  const totalItems = txsQuery.data?.total || 0;
  const loading = txsQuery.isFetching;

  const exportMutation = useTransactionsExport();
  const handleExport = () => {
    exportMutation.mutate({ search, type: filterType, startDate: startStr, endDate: endStr });
  };

  const safeTxs = Array.isArray(txs) ? txs : [];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-[500px]">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">📊 گزارش تراکنش‌ها و گردش کالا</h3>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
              {formatPersianNumber(totalItems)} تراکنش
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
              <span>تعداد در صفحه:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={25}>۲۵</option>
                <option value={50}>۵۰</option>
                <option value={100}>۱۰۰</option>
              </select>
            </div>
            <button
              onClick={handleExport}
              disabled={exportMutation.isPending}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50 transition-colors flex items-center gap-1 text-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} /> خروجی اکسل
            </button>
          </div>
        </div>

        <div className="p-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="جستجو کالا، کد، سند یا توضیحات..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-10 py-1.5 rounded border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs border border-slate-300 rounded px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
          >
            <option value="all">همه انواع تراکنش</option>
            <option value="in">ورود به انبار (+)</option>
            <option value="out">خروج از انبار (-)</option>
          </select>

          <div className="flex gap-2 items-center flex-wrap">
             <div className="flex items-center gap-1 text-xs">
               <span className="text-slate-500">از:</span>
               <DatePicker 
                 value={startDate} 
                 onChange={(dateObj) => setStartDate(extractDateString(dateObj))} 
                 calendar={persian} 
                 locale={persian_fa} 
                 calendarPosition="bottom-right"
                 inputClass="p-1.5 border border-slate-300 rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none w-28 bg-white" 
                 containerClassName="inline-block"
               />
             </div>
             <div className="flex items-center gap-1 text-xs">
               <span className="text-slate-500">تا:</span>
               <DatePicker 
                 value={endDate} 
                 onChange={(dateObj) => setEndDate(extractDateString(dateObj))} 
                 calendar={persian} 
                 locale={persian_fa} 
                 calendarPosition="bottom-right"
                 inputClass="p-1.5 border border-slate-300 rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none w-28 bg-white" 
                 containerClassName="inline-block"
               />
             </div>
             {(startDate || endDate || search || filterType !== 'all') && (
                <button 
                  onClick={() => { setStartDate(''); setEndDate(''); clearSearch(); setFilterType('all'); }} 
                  className="text-xs text-rose-600 hover:text-rose-800 font-medium px-2 py-1 cursor-pointer"
                >
                  پاک کردن پالایش
                </button>
             )}
          </div>
        </div>

        <div className="flex-1 overflow-auto relative min-h-[320px]">
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0 z-0 text-xs font-bold">
              <tr>
                <th className="p-3">تاریخ</th>
                <th className="p-3">کاربر</th>
                <th className="p-3">نوع تراکنش</th>
                <th className="p-3">کالا</th>
                <th className="p-3">تعداد / مقدار</th>
                <th className="p-3">شماره سند / حواله</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {safeTxs.map(t => (
                <tr key={t.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3 font-mono text-slate-600 font-medium" dir="ltr">{formatPersianDate(t.date)}</td>
                  <td className="p-3 text-slate-700 font-medium">{t.user || '-'}</td>
                  <td className="p-3">
                    {t.type === 'in' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">
                        <ArrowDownRight size={14} /> ورود به انبار
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-bold text-xs">
                        <ArrowUpRight size={14} /> خروج از انبار
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-800">{t.item_name} <span className="text-xs text-slate-400 font-normal bg-slate-100 px-1.5 py-0.5 rounded">{t.item_type === 'product' ? 'محصول' : 'ماده اولیه'}</span></div>
                    <div className="font-mono text-xs text-slate-500 mt-1">{t.item_code}</div>
                  </td>
                  <td className="p-3 font-bold">
                    <span className={t.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}>
                      {t.type === 'in' ? '+' : '-'}{formatPersianNumber(t.quantity)}
                    </span>
                    <span className="text-xs font-normal text-slate-500 mr-1">{t.item_unit}</span>
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-800">{formatPersianCode(t.document_ref || '-')}</div>
                    <div className="text-xs text-slate-500">{t.document_type}</div>
                  </td>
                  <td className="p-3 text-center">
                    {t.item_id && (
                      <button
                        onClick={() => setSelectedItemIdForKardex(t.item_id)}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1"
                        title="مشاهده گردش و کاردکس تفصیلی این کالا"
                      >
                        <Eye size={13} />
                        <span>کاردکس</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && safeTxs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400 text-sm">موردی با پالایش انتخابی یافت نشد.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Server-Side Pagination Bar */}
        <div className="p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/70 rounded-b-xl">
          <span className="text-slate-500 font-medium">
            نمایش {formatPersianNumber(safeTxs.length)} از مجموع {formatPersianNumber(totalItems)} تراکنش (صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1 || loading}
              className="px-2 py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium cursor-pointer"
              title="صفحه اول"
            >
              اولین
            </button>
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1 || loading}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 cursor-pointer"
              title="صفحه قبلی"
            >
              <ChevronRight size={16} />
            </button>
            <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded">
              {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 cursor-pointer"
              title="صفحه بعدی"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              className="px-2 py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium cursor-pointer"
              title="آخرین صفحه"
            >
              آخرین
            </button>
          </div>
        </div>
      </div>

      {/* Running Kardex Modal */}
      {selectedItemIdForKardex && (
        <RunningKardexModal
          itemId={selectedItemIdForKardex}
          isOpen={true}
          onClose={() => setSelectedItemIdForKardex(null)}
        />
      )}
    </div>
  );
}
