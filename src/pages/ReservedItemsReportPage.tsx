import React, { useState, useEffect, useMemo } from 'react';
import { 
  Lock, 
  Search, 
  Filter, 
  Download, 
  Printer, 
  RefreshCw, 
  Package, 
  Layers, 
  FileOutput, 
  ShoppingCart, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink,
  DollarSign,
} from 'lucide-react';
import { fetchJson } from '../api';
import { formatPersianNumber, formatPersianPrice, formatPersianDate, formatCurrencyLabel } from '../utils';
import { useAppCurrency } from '../hooks/useAppCurrency';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';

interface ReservedItemDetail {
  id: string;
  sourceType: 'proforma' | 'project';
  sourceLabel: string;
  sourceId: number;
  sourceRef: string;
  sourceTitle: string;
  buyerOrCustomer: string;
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  reservedQty: number;
  unitPrice: number;
  totalValue: number;
  date: string;
}

interface ItemReservedReportSummary {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  buyPrice: number;
  sellPrice: number;
  proformaReservedQty: number;
  projectReservedQty: number;
  totalReservedQty: number;
  availableStock: number;
  totalReservedValue: number;
  reservations: ReservedItemDetail[];
}

interface ReservedItemsFullReport {
  summaryMetrics: {
    totalReservedItemsCount: number;
    totalReservedQty: number;
    totalReservedValue: number;
    proformaReservationsCount: number;
    projectReservationsCount: number;
  };
  itemSummaries: ItemReservedReportSummary[];
  allReservationEntries: ReservedItemDetail[];
}

export default function ReservedItemsReportPage() {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const [data, setData] = useState<ReservedItemsFullReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'proforma' | 'project'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'items' | 'ledger'>('items');
  const [expandedItemCode, setExpandedItemCode] = useState<string | null>(null);

  const loadReport = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchJson('/inventory/reserved-items', { signal });
      if (res) {
        setData(res);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading reserved items report:', err);
      toast.error('خطا در دریافت گزارش اقلام رزروی');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, []);

  // Extract unique categories for filter
  const categoriesList = useMemo(() => {
    if (!data?.itemSummaries) return [];
    const cats = new Set<string>();
    data.itemSummaries.forEach(s => {
      if (s.category) cats.add(s.category);
    });
    return Array.from(cats);
  }, [data]);

  // Filtered Item Summaries
  const filteredItemSummaries = useMemo(() => {
    if (!data?.itemSummaries) return [];

    return data.itemSummaries.filter(summary => {
      // Source filter check
      if (sourceFilter === 'proforma' && summary.proformaReservedQty <= 0) return false;
      if (sourceFilter === 'project' && summary.projectReservedQty <= 0) return false;

      // Category filter
      if (categoryFilter !== 'all' && summary.category !== categoryFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = summary.itemCode.toLowerCase().includes(q);
        const nameMatch = summary.itemName.toLowerCase().includes(q);
        const catMatch = summary.category.toLowerCase().includes(q);
        const resMatch = summary.reservations.some(r => 
          r.sourceRef.toLowerCase().includes(q) ||
          r.sourceTitle.toLowerCase().includes(q) ||
          r.buyerOrCustomer.toLowerCase().includes(q)
        );
        return codeMatch || nameMatch || catMatch || resMatch;
      }

      return true;
    });
  }, [data, searchQuery, sourceFilter, categoryFilter]);

  // Filtered Ledger Entries
  const filteredLedgerEntries = useMemo(() => {
    if (!data?.allReservationEntries) return [];

    return data.allReservationEntries.filter(entry => {
      // Source filter check
      if (sourceFilter === 'proforma' && entry.sourceType !== 'proforma') return false;
      if (sourceFilter === 'project' && entry.sourceType !== 'project') return false;

      // Category filter
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          entry.itemCode.toLowerCase().includes(q) ||
          entry.itemName.toLowerCase().includes(q) ||
          entry.sourceRef.toLowerCase().includes(q) ||
          entry.sourceTitle.toLowerCase().includes(q) ||
          entry.buyerOrCustomer.toLowerCase().includes(q) ||
          entry.category.toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [data, searchQuery, sourceFilter, categoryFilter]);

  const handleExportCSV = () => {
    if (!data) return;

    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    
    if (activeTab === 'items') {
      csvContent += 'کد کالا,نام کالا,دسته‌بندی,واحد,موجودی کل انبار,سهم رزرو پیش‌فاکتور,سهم رزرو پروژه,مجموع رزرو,موجودی آزاد,ارزش رزرو (ریال)\n';
      filteredItemSummaries.forEach(s => {
        csvContent += `"${s.itemCode}","${s.itemName}","${s.category}","${s.unit}",${s.currentStock},${s.proformaReservedQty},${s.projectReservedQty},${s.totalReservedQty},${s.availableStock},${s.totalReservedValue}\n`;
      });
    } else {
      csvContent += 'کد کالا,نام کالا,دسته‌بندی,نوع منبع,شناسه مرجع,عنوان مرجع/مشتری,مقدار رزرو,واحد,قیمت واحد,ارزش کل,تاریخ ثبت\n';
      filteredLedgerEntries.forEach(e => {
        csvContent += `"${e.itemCode}","${e.itemName}","${e.category}","${e.sourceLabel}","${e.sourceRef}","${e.sourceTitle}",${e.reservedQty},"${e.unit}",${e.unitPrice},${e.totalValue},"${e.date}"\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reserved_items_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('فایل خروجی اکسل/CSV با موفقیت دریافت شد.');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm print:shadow-none print:border-none print:p-0">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200 shadow-sm shrink-0">
            <Lock size={26} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">گزارش اقلام رزروی انبار</h1>
            <p className="text-xs text-slate-500 mt-1">
              مدیریت و نظارت یکپارچه بر کالاهای رزرو شده در پیش‌فاکتورها و کنترل پروژه‌های فعال
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => loadReport()}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all cursor-pointer"
            title="به‌روزرسانی اطلاعات"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>به‌روزرسانی</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all cursor-pointer"
          >
            <Download size={15} />
            <span>خروجی اکسل</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            <Printer size={15} />
            <span>چاپ گزارش</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">تنوع اقلام رزروی</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Package size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900">
              {data ? formatPersianNumber(data.summaryMetrics.totalReservedItemsCount) : '۰'}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 inline-block">کالای دارای رزرو فعال</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">حجم کل رزرو</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900">
              {data ? formatPersianNumber(data.summaryMetrics.totalReservedQty) : '۰'}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 inline-block">مجموع تعداد واحد اقلام</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">ارزش رزرو</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign size={18} />
            </div>
          </div>
          <div>
            <div className="text-lg font-black text-slate-900 truncate" title={data ? formatPersianPrice(data.summaryMetrics.totalReservedValue) : '۰'}>
              {data ? formatPersianPrice(data.summaryMetrics.totalReservedValue, appCurrency) : '۰'}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 inline-block">ارزش برآورد شده اقلام</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">رزرو پیش‌فاکتورها</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <FileOutput size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-purple-700">
              {data ? formatPersianNumber(data.summaryMetrics.proformaReservationsCount) : '۰'}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 inline-block">مورد در پیش‌فاکتورهای باز</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">رزرو کنترل پروژه</span>
            <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center">
              <ShoppingCart size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-cyan-700">
              {data ? formatPersianNumber(data.summaryMetrics.projectReservationsCount) : '۰'}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 inline-block">مورد در پروژه‌های فعال</span>
          </div>
        </div>
      </div>

      {/* Filter and Tab Section */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full md:w-auto">
            <button
              onClick={() => setActiveTab('items')}
              className={`flex-1 md:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'items'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              خلاصه تجمیعی به تفکیک کالا ({filteredItemSummaries.length})
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`flex-1 md:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              دفتر ریز پرونده‌های رزرو ({filteredLedgerEntries.length})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute right-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو کالا، شماره پیش‌فاکتور یا پروژه..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
            <Filter size={14} />
            <span>فیلترها:</span>
          </div>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">تمام منابع (پیش‌فاکتور + پروژه)</option>
            <option value="proforma">فقط رزروهای پیش‌فاکتور فروش</option>
            <option value="project">فقط رزروهای کنترل پروژه</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">تمام دسته‌بندی‌ها</option>
            {categoriesList.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {(searchQuery || sourceFilter !== 'all' || categoryFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSourceFilter('all');
                setCategoryFilter('all');
              }}
              className="text-xs text-rose-600 hover:text-rose-700 font-bold underline cursor-pointer mr-auto"
            >
              پاکسازی فیلترها
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-semibold">در حال محاسبه و استخراج اقلام رزروی...</p>
        </div>
      ) : activeTab === 'items' ? (
        /* TAB 1: Item Summaries View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="p-3.5">کد کالا</th>
                  <th className="p-3.5">نام و مشخصات کالا</th>
                  <th className="p-3.5">دسته‌بندی</th>
                  <th className="p-3.5 text-center">موجودی کل انبار</th>
                  <th className="p-3.5 text-center">رزرو پیش‌فاکتور</th>
                  <th className="p-3.5 text-center">رزرو پروژه</th>
                  <th className="p-3.5 text-center">مجموع رزرو</th>
                  <th className="p-3.5 text-center">موجودی آزاد (قابل خروج)</th>
                  <th className="p-3.5 text-left">{`ارزش کل رزرو (${curLbl})`}</th>
                  <th className="p-3.5 text-center print:hidden">جزئیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredItemSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      هیچ کالای رزرو شده‌ای متناسب با فیلترهای انتخابی یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredItemSummaries.map((summary) => {
                    const isExpanded = expandedItemCode === summary.itemCode;
                    return (
                      <React.Fragment key={summary.itemCode || summary.itemId}>
                        <tr className={`hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-amber-50/40' : ''}`}>
                          <td className="p-3.5 font-mono font-bold text-slate-900">
                            {summary.itemCode || '---'}
                          </td>
                          <td className="p-3.5 font-bold text-slate-800">
                            {summary.itemName}
                          </td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px]">
                              {summary.category}
                            </span>
                          </td>
                          <td className="p-3.5 text-center font-bold">
                            {formatPersianNumber(summary.currentStock)} {summary.unit}
                          </td>
                          <td className="p-3.5 text-center font-bold text-purple-700">
                            {summary.proformaReservedQty > 0 ? (
                              <span className="px-2 py-0.5 rounded-lg bg-purple-50 border border-purple-200">
                                {formatPersianNumber(summary.proformaReservedQty)} {summary.unit}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="p-3.5 text-center font-bold text-cyan-700">
                            {summary.projectReservedQty > 0 ? (
                              <span className="px-2 py-0.5 rounded-lg bg-cyan-50 border border-cyan-200">
                                {formatPersianNumber(summary.projectReservedQty)} {summary.unit}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="p-3.5 text-center font-black text-amber-700">
                            <span className="px-2.5 py-1 rounded-xl bg-amber-100 border border-amber-200 shadow-2xs">
                              🔒 {formatPersianNumber(summary.totalReservedQty)} {summary.unit}
                            </span>
                          </td>
                          <td className="p-3.5 text-center font-bold">
                            <span className={`px-2.5 py-1 rounded-xl border ${
                              summary.availableStock > 0 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {formatPersianNumber(summary.availableStock)} {summary.unit}
                            </span>
                          </td>
                          <td className="p-3.5 text-left font-mono font-bold text-slate-900">
                            {formatPersianPrice(summary.totalReservedValue)}
                          </td>
                          <td className="p-3.5 text-center print:hidden">
                            <button
                              onClick={() => setExpandedItemCode(isExpanded ? null : summary.itemCode)}
                              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                              title={isExpanded ? "بستن جزئیات" : "مشاهده ریز رزروها"}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </td>
                        </tr>

                        {/* Expandable Rows Details */}
                        {isExpanded && (
                          <tr className="bg-amber-50/30 print:bg-transparent">
                            <td colSpan={10} className="p-4 border-t border-amber-100">
                              <div className="bg-white p-4 rounded-xl border border-amber-200 space-y-3 shadow-xs">
                                <h4 className="font-bold text-slate-800 text-xs flex items-center gap-2">
                                  <Lock size={14} className="text-amber-600" />
                                  <span>ریز منابع رزرو کننده کالای «{summary.itemName}»:</span>
                                </h4>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-right text-[11px]">
                                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                      <tr>
                                        <th className="p-2">منبع رزرو</th>
                                        <th className="p-2">کد / مرجع</th>
                                        <th className="p-2">عنوان / خریدار</th>
                                        <th className="p-2 text-center">مقدار رزرو</th>
                                        <th className="p-2 text-left">ارزش کل</th>
                                        <th className="p-2 text-center">تاریخ</th>
                                        <th className="p-2 text-center print:hidden">عملیات</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {summary.reservations.map(res => (
                                        <tr key={res.id} className="hover:bg-slate-50">
                                          <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                              res.sourceType === 'proforma' 
                                                ? 'bg-purple-100 text-purple-800' 
                                                : 'bg-cyan-100 text-cyan-800'
                                            }`}>
                                              {res.sourceLabel}
                                            </span>
                                          </td>
                                          <td className="p-2 font-mono font-bold">{res.sourceRef}</td>
                                          <td className="p-2 font-semibold text-slate-800">{res.sourceTitle}</td>
                                          <td className="p-2 text-center font-bold text-amber-700">
                                            {formatPersianNumber(res.reservedQty)} {res.unit}
                                          </td>
                                          <td className="p-2 text-left font-mono">{formatPersianPrice(res.totalValue, appCurrency)}</td>
                                          <td className="p-2 text-center text-slate-500">{formatPersianDate(res.date)}</td>
                                          <td className="p-2 text-center print:hidden">
                                            {res.sourceType === 'proforma' ? (
                                              <Link
                                                to={`/invoices?search=${res.sourceRef}`}
                                                className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-800 font-bold"
                                              >
                                                <span>مشاهده فاکتور</span>
                                                <ExternalLink size={12} />
                                              </Link>
                                            ) : (
                                              <Link
                                                to={`/projects?projectId=${res.sourceId}`}
                                                className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-800 font-bold"
                                              >
                                                <span>مشاهده پروژه</span>
                                                <ExternalLink size={12} />
                                              </Link>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* TAB 2: Flat Ledger View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="p-3.5">نوع منبع</th>
                  <th className="p-3.5">کد / مرجع</th>
                  <th className="p-3.5">عنوان مرجع / خریدار</th>
                  <th className="p-3.5">کد کالا</th>
                  <th className="p-3.5">نام کالا</th>
                  <th className="p-3.5">دسته‌بندی</th>
                  <th className="p-3.5 text-center">مقدار رزرو</th>
                  <th className="p-3.5 text-left">{`ارزش کل (${curLbl})`}</th>
                  <th className="p-3.5 text-center">تاریخ</th>
                  <th className="p-3.5 text-center print:hidden">لینک مستند</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredLedgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      هیچ پرونده رزروی متناسب با فیلترها یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredLedgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                          entry.sourceType === 'proforma' 
                            ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                            : 'bg-cyan-100 text-cyan-800 border border-cyan-200'
                        }`}>
                          {entry.sourceLabel}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-900">
                        {entry.sourceRef}
                      </td>
                      <td className="p-3.5 font-bold text-slate-800">
                        {entry.sourceTitle}
                      </td>
                      <td className="p-3.5 font-mono text-slate-600">
                        {entry.itemCode}
                      </td>
                      <td className="p-3.5 font-bold text-slate-900">
                        {entry.itemName}
                      </td>
                      <td className="p-3.5 text-slate-500">
                        {entry.category}
                      </td>
                      <td className="p-3.5 text-center font-bold text-amber-700">
                        <span className="px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200">
                          {formatPersianNumber(entry.reservedQty)} {entry.unit}
                        </span>
                      </td>
                      <td className="p-3.5 text-left font-mono font-bold text-slate-900">
                        {formatPersianPrice(entry.totalValue)}
                      </td>
                      <td className="p-3.5 text-center text-slate-500">
                        {formatPersianDate(entry.date)}
                      </td>
                      <td className="p-3.5 text-center print:hidden">
                        {entry.sourceType === 'proforma' ? (
                          <Link
                            to={`/invoices?search=${entry.sourceRef}`}
                            className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-800 font-bold"
                          >
                            <span>مشاهده فاکتور</span>
                            <ExternalLink size={12} />
                          </Link>
                        ) : (
                          <Link
                            to={`/projects?projectId=${entry.sourceId}`}
                            className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-800 font-bold"
                          >
                            <span>مشاهده پروژه</span>
                            <ExternalLink size={12} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
