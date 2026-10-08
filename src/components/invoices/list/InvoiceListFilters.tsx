import { Search } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { extractDateString } from '../../../utils';
import type { InvoiceListQueryState } from '../../../hooks/invoices/useInvoiceListQuery';
import { SALES_PROFORMA_FILTER } from '../../../lib/invoices/invoiceListDocuments';

/** TD-080 (بخش ۳): نوار فیلتر لیست اسناد (جستجو، نوع، وضعیت، بازه تاریخ، پاک کردن شرط‌های جستجو) */
export function InvoiceListFilters({ query }: { query: InvoiceListQueryState }) {
  const {
    search, setSearch, filterType, setFilterType, filterStatus, setFilterStatus,
    startDate, setStartDate, endDate, setEndDate, hasActiveFilters, clearFilters,
  } = query;
  return (
    <div className="p-3 bg-slate-50/90 border-b border-slate-200 flex flex-wrap gap-3 items-center">
      {/* Search Box */}
      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
        <input 
          type="text" 
          placeholder="جستجوی شماره سند، خریدار، تامین‌کننده، کالا..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-3 pr-10 py-1.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium"
        />
      </div>

      {/* Type Filter */}
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value)}
        className="text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
      >
        <option value="all">همه انواع سند (خرید، فروش، انبار)</option>
        <option value="receipt">رسید ورود / خرید کالا و مواد</option>
        <option value="invoice">فاکتور فروش کالا</option>
        <option value={SALES_PROFORMA_FILTER}>پیش‌فاکتور فروش</option>
        <option value="remittance">حواله خروج / مصرف</option>
        <option value="return">برگشت از فروش</option>
        <option value="waste">حواله ضایعات</option>
        <option value="production_receipt">رسید تولید و تحویل محصول</option>
      </select>

      {/* Status Filter — v9.0.344 (TD-800): «پیش‌فاکتور فروش» خودش وضعیت پیش‌فاکتور را می‌خواهد */}
      <select
        value={filterType === SALES_PROFORMA_FILTER ? 'proforma' : filterStatus}
        onChange={(e) => setFilterStatus(e.target.value)}
        disabled={filterType === SALES_PROFORMA_FILTER}
        className="text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
      >
        <option value="all">همه وضعیت‌ها</option>
        <option value="final">نهایی شده (تایید انبار و مالی)</option>
        <option value="proforma">پیش‌فاکتور (در انتظار تایید)</option>
      </select>

      {/* Date Pickers */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500 font-medium">از تاریخ:</span>
          <DatePicker 
            value={startDate} 
            onChange={(dateObj) => setStartDate(extractDateString(dateObj))} 
            calendar={persian} 
            locale={persian_fa} 
            calendarPosition="bottom-right"
            inputClass="p-1.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none w-28 bg-white text-center font-medium" 
            containerClassName="inline-block"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500 font-medium">تا تاریخ:</span>
          <DatePicker 
            value={endDate} 
            onChange={(dateObj) => setEndDate(extractDateString(dateObj))} 
            calendar={persian} 
            locale={persian_fa} 
            calendarPosition="bottom-right"
            inputClass="p-1.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none w-28 bg-white text-center font-medium" 
            containerClassName="inline-block"
          />
        </div>
        {hasActiveFilters && (
          <button 
            onClick={clearFilters}
            className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2.5 py-1.5 bg-rose-50 rounded-xl border border-rose-200 cursor-pointer transition-colors"
          >
            پاک کردن شرط‌های جستجو
          </button>
        )}
      </div>
    </div>
  );
}
