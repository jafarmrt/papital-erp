import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { 
  Search, Printer, Edit3, Trash2, ChevronRight, ChevronLeft, Filter, 
  Plus, FileInput, FileOutput, ArrowDownLeft, ArrowUpRight, Eye, 
  CheckCircle2, AlertCircle, ShoppingCart, CreditCard, DollarSign, 
  Package, X, Building2, User, Layers, RefreshCw, FileText, GitBranch, ShieldCheck
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianNumber, formatPersianPrice, formatCurrencyLabel, formatPersianDate, extractDateString } from '../utils';
import { Money } from '../components/Money';
import InvoicePrintView from '../components/InvoicePrintView';
import { WorkflowStepperWidget } from '../components/workflow/WorkflowStepperWidget';
import { useSearch } from '../SearchContext';
import { useDocumentsQuery } from '../hooks/queries';
import { QUERY_KEYS } from '../lib/queryKeys';

export default function InvoicesListPage() {
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const [startDate, setStartDate] = useState<any>('');
  const [endDate, setEndDate] = useState<any>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  
  const [printedDoc, setPrintedDoc] = useState<any>(null);
  const [selectedDocDetails, setSelectedDocDetails] = useState<any>(null);
  const [workflowDoc, setWorkflowDoc] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);

  // V9 Phase 5.1: مهاجرت به React Query — کش، dedupe و حذف loadData/AbortController دستی
  const queryClient = useQueryClient();
  const formatToGregorian = (d: any): string => extractDateString(d);

  const docsQuery = useDocumentsQuery({
    page,
    limit: pageSize,
    search,
    type: filterType,
    status: filterStatus,
    startDate: formatToGregorian(startDate) || undefined,
    endDate: formatToGregorian(endDate) || undefined,
  });

  const docs = docsQuery.data?.data ?? [];
  const totalPages = docsQuery.data?.totalPages || 1;
  const totalItems = docsQuery.data?.total || (Array.isArray(docs) ? docs.length : 0);
  const loading = docsQuery.isFetching;

  // Reset page to 1 on filter or search change
  useEffect(() => {
    setPage(1);
  }, [search, filterType, filterStatus, startDate, endDate, pageSize]);

  const loadData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.documents.all });
  }, [queryClient]);

  const handleUpdateNotes = async (id: number) => {
    try {
      await fetchJson(`/documents/${id}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ notes: tempNotes })
      });
      toast.success('توضیحات با موفقیت ثبت شد.');
      loadData();
      setEditingNotesId(null);
    } catch (err) {
      console.error(err);
      toast.error('خطا در بروزرسانی توضیحات');
    }
  };

  const handlePrint = async (id: number) => {
    try {
      setPrintLoading(true);
      const doc = await fetchJson(`/documents/${id}`);
      setPrintedDoc(doc);
    } catch (err) {
      console.error(err);
      toast.error('خطا در بارگذاری اطلاعات فاکتور');
    } finally {
      setPrintLoading(false);
    }
  };

  const handleOpenDetails = async (docSummary: any) => {
    try {
      setDetailsLoading(true);
      setSelectedDocDetails(docSummary);
      const fullDoc = await fetchJson(`/documents/${docSummary.id}`);
      if (fullDoc) {
        setSelectedDocDetails(fullDoc);
      }
    } catch (err) {
      console.error('Error loading document details:', err);
      toast.error('خطا در بارگذاری جزئیات کامل اقلام سند');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDeleteDoc = async (id: number, refNum: string) => {
    if (!(await confirmAction({ title: 'ابطال سند', message: `آیا از ابطال / حذف سند یا پیش‌فاکتور شماره "${refNum}" اطمینان دارید؟` }))) return;
    try {
      await fetchJson(`/documents/${id}`, { method: 'DELETE' });
      toast.success('سند / پیش‌فاکتور با موفقیت ابطال و حذف گردید.');
      loadData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'خطا در ابطال سند');
    }
  };  const safeDocs = Array.isArray(docs) ? docs : [];

  // Summary Metrics — V9 Phase 3: گروه‌بندی مبالغ بر اساس ارز هر سند
  // (رفع جمع‌شدن ارزهای ناهمگون در یک عدد واحد با برچسب ثابت «ریال»)
  const summaryMetrics = useMemo(() => {
    const salesTotals: Record<string, number> = {};
    let salesCount = 0;
    const purchaseTotals: Record<string, number> = {};
    let purchaseCount = 0;
    const proformaTotals: Record<string, number> = {};
    let proformaCount = 0;
    let otherCount = 0;

    const addTo = (bucket: Record<string, number>, cur: string, amount: number) => {
      bucket[cur] = (bucket[cur] || 0) + amount;
    };

    for (const d of safeDocs) {
      const docAmount = Number(d.totalAmount !== undefined 
        ? d.totalAmount 
        : (d.items?.reduce((acc: any, i: any) => acc + (Number(i.quantity || 0) * Number(i.unit_price || 0)) - Number(i.discount || 0), 0) || 0)
      );
      const cur = String(d.currency || 'IRR');

      if (d.status === 'proforma' || d.type === 'proforma') {
        addTo(proformaTotals, cur, docAmount);
        proformaCount++;
      } else if (d.type === 'invoice') {
        addTo(salesTotals, cur, docAmount);
        salesCount++;
      } else if (d.type === 'receipt') {
        addTo(purchaseTotals, cur, docAmount);
        purchaseCount++;
      } else {
        otherCount++;
      }
    }

    return {
      salesTotals,
      salesCount,
      purchaseTotals,
      purchaseCount,
      proformaTotals,
      proformaCount,
      otherCount
    };
  }, [safeDocs]);

  if (printedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4 mb-4 print:hidden">
          <button 
            onClick={() => window.print()} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold cursor-pointer shadow-sm transition-colors"
          >
            <Printer size={18} /> چاپ سند / فاکتور (A4)
          </button>
          <button 
            onClick={() => setPrintedDoc(null)} 
            className="border border-slate-300 bg-white px-4 py-2 rounded-xl hover:bg-slate-50 font-medium cursor-pointer shadow-2xs transition-colors"
          >
            بازگشت به لیست اسناد
          </button>
        </div>
        
        <InvoicePrintView printedDoc={printedDoc} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Quick KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Sales Invoices Card */}
        <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 font-bold block mb-1">کل فاکتورهای فروش (این صفحه)</span>
            <div className="text-base font-black text-blue-900 font-mono">
              {Object.entries(summaryMetrics.salesTotals).map(([cur, val]: [string, number]) => (
                <div key={cur}>
                  <Money amount={val} currency={cur} />
                </div>
              ))}
            </div>
            <span className="text-[10px] text-blue-600 font-medium mt-0.5 block">
              {formatPersianNumber(summaryMetrics.salesCount)} فاکتور فروش نهایی
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0">
            <CreditCard size={20} />
          </div>
        </div>

        {/* Purchase Receipts Card */}
        <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] text-emerald-800 font-bold block mb-1">ورودی انبار / خرید کالا و مواد</span>
            <div className="text-base font-black text-emerald-950 font-mono">
              {Object.entries(summaryMetrics.purchaseTotals).map(([cur, val]: [string, number]) => (
                <div key={cur}>
                  <Money amount={val} currency={cur} />
                </div>
              ))}
            </div>
            <span className="text-[10px] text-emerald-700 font-medium mt-0.5 block">
              {formatPersianNumber(summaryMetrics.purchaseCount)} رسید خرید ثبت‌شده
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center shrink-0">
            <ShoppingCart size={20} />
          </div>
        </div>

        {/* Proformas Card */}
        <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] text-amber-800 font-bold block mb-1">ارزش پیش‌فاکتورها</span>
            <div className="text-base font-black text-amber-950 font-mono">
              {Object.entries(summaryMetrics.proformaTotals).map(([cur, val]: [string, number]) => (
                <div key={cur}>
                  <Money amount={val} currency={cur} />
                </div>
              ))}
            </div>
            <span className="text-[10px] text-amber-700 font-medium mt-0.5 block">
              {formatPersianNumber(summaryMetrics.proformaCount)} پیش‌فاکتور در جریان
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
        </div>

        {/* Remittances / Other Card */}
        <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] text-purple-800 font-bold block mb-1">حواله خروج و سایر اسناد</span>
            <div className="text-base font-black text-purple-950 font-mono">
              {formatPersianNumber(summaryMetrics.otherCount)} <span className="text-xs font-normal text-slate-500">سند</span>
            </div>
            <span className="text-[10px] text-purple-600 font-medium mt-0.5 block">
              مصرف در پروژه، مرجوعی و ضایعات
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center shrink-0">
            <FileOutput size={20} />
          </div>
        </div>
      </div>

      {/* Main Document Table Container */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-col min-h-[500px] overflow-hidden">
        {/* Header Bar */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
              📄
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                لیست اسناد، فاکتورها و رسیدهای انبار
              </h3>
              <p className="text-[11px] text-slate-500">
                مشاهده، پیگیری و گزارش‌گیری عددی و ریالی کلیه اسناد خرید، فروش و انبارداری
              </p>
            </div>
            <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full font-bold border border-slate-200 mr-2">
              {formatPersianNumber(totalItems)} سند ثبت‌شده
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              to="/receipts"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
            >
              <FileInput size={15} />
              <span>+ ورود به انبار (خرید کالا)</span>
            </Link>
            <Link
              to="/invoices/create"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
            >
              <Plus size={15} />
              <span>+ صدور فاکتور فروش</span>
            </Link>

            <button
              onClick={loadData}
              title="بارگذاری مجدد"
              className="p-2 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>

            <div className="flex items-center gap-2 border-r border-slate-200 pr-3 mr-1">
              <label className="text-xs text-slate-500 font-medium">نمایش:</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                <option value={25}>۲۵ ردیف</option>
                <option value={50}>۵۰ ردیف</option>
                <option value={100}>۱۰۰ ردیف</option>
              </select>
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
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
            <option value="proforma">پیش‌فاکتور فروش</option>
            <option value="remittance">حواله خروج / مصرف</option>
            <option value="return">برگشت از فروش</option>
            <option value="waste">حواله ضایعات</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
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
                onChange={(dateObj: any) => setStartDate(extractDateString(dateObj))} 
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
                onChange={(dateObj: any) => setEndDate(extractDateString(dateObj))} 
                calendar={persian} 
                locale={persian_fa} 
                calendarPosition="bottom-right"
                inputClass="p-1.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none w-28 bg-white text-center font-medium" 
                containerClassName="inline-block"
              />
            </div>
            {(startDate || endDate || search || filterType !== 'all' || filterStatus !== 'all') && (
              <button 
                onClick={() => { 
                  setStartDate(''); 
                  setEndDate(''); 
                  setSearch(''); 
                  setFilterType('all');
                  setFilterStatus('all');
                }} 
                className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2.5 py-1.5 bg-rose-50 rounded-xl border border-rose-200 cursor-pointer transition-colors"
              >
                پاک کردن فیلترها
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto relative min-h-[340px]">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-100/80 text-slate-700 border-b border-slate-200 sticky top-0 z-0 text-[11px] font-bold">
              <tr>
                <th className="p-3 w-28">شماره سند</th>
                <th className="p-3">نوع سند و ماهیت</th>
                <th className="p-3">وضعیت</th>
                <th className="p-3">تاریخ ثبت</th>
                <th className="p-3">طرف حساب (تامین‌کننده / خریدار)</th>
                <th className="p-3 text-center">تعداد و اقلام</th>
                <th className="p-3">ارزش کل / مبلغ سند</th>
                <th className="p-3 w-1/4">توضیحات و یادداشت</th>
                <th className="p-3 text-center w-28">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {safeDocs.map(doc => {
                const isReceipt = doc.type === 'receipt';
                const isInvoice = doc.type === 'invoice';
                const isProforma = doc.status === 'proforma' || doc.type === 'proforma';
                const isRemittance = doc.type === 'remittance';
                const isReturn = doc.type === 'return';
                const isWaste = doc.type === 'waste';

                let typeBadge = {
                  label: 'سند انبار',
                  bg: 'bg-slate-100 text-slate-800 border-slate-200',
                  icon: <Package size={13} className="shrink-0" />
                };

                if (isReceipt) {
                  typeBadge = {
                    label: 'رسید ورود (خرید کالا)',
                    bg: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold',
                    icon: <ArrowDownLeft size={13} className="shrink-0 text-emerald-600" />
                  };
                } else if (isInvoice) {
                  typeBadge = {
                    label: 'فاکتور فروش',
                    bg: 'bg-blue-50 text-blue-800 border-blue-200 font-bold',
                    icon: <CreditCard size={13} className="shrink-0 text-blue-600" />
                  };
                } else if (isProforma) {
                  typeBadge = {
                    label: 'پیش‌فاکتور',
                    bg: 'bg-amber-50 text-amber-800 border-amber-200 font-bold',
                    icon: <FileText size={13} className="shrink-0 text-amber-600" />
                  };
                } else if (isRemittance) {
                  typeBadge = {
                    label: 'حواله خروج / مصرف',
                    bg: 'bg-purple-50 text-purple-800 border-purple-200 font-bold',
                    icon: <ArrowUpRight size={13} className="shrink-0 text-purple-600" />
                  };
                } else if (isReturn) {
                  typeBadge = {
                    label: 'برگشت از فروش',
                    bg: 'bg-orange-50 text-orange-800 border-orange-200 font-bold',
                    icon: <RefreshCw size={13} className="shrink-0 text-orange-600" />
                  };
                } else if (isWaste) {
                  typeBadge = {
                    label: 'حواله ضایعات',
                    bg: 'bg-rose-50 text-rose-800 border-rose-200 font-bold',
                    icon: <AlertCircle size={13} className="shrink-0 text-rose-600" />
                  };
                }

                // Numerical Calculations
                const itemsCount = doc.itemsCount !== undefined ? doc.itemsCount : (doc.items?.length || 0);
                const totalQty = doc.totalQuantity !== undefined 
                  ? doc.totalQuantity 
                  : (doc.items?.reduce((acc: any, i: any) => acc + Number(i.quantity || 0), 0) || 0);
                
                const totalDocAmount = Number(doc.totalAmount !== undefined 
                  ? doc.totalAmount 
                  : (doc.items?.reduce((acc: any, i: any) => acc + (Number(i.quantity || 0) * Number(i.unit_price || 0)) - Number(i.discount || 0), 0) || 0)
                );

                const currencyLabel = formatCurrencyLabel(doc.currency);

                return (
                  <tr key={doc.id} className="hover:bg-blue-50/30 transition-colors">
                    {/* Ref Number */}
                    <td className="p-3">
                      <span className="font-mono font-black text-slate-800 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 inline-block text-[11px]">
                        {formatPersianNumber(doc.ref_number)}
                      </span>
                    </td>

                    {/* Doc Type Badge */}
                    <td className="p-3 whitespace-nowrap">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] ${typeBadge.bg}`}>
                        {typeBadge.icon}
                        <span>{typeBadge.label}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="p-3 whitespace-nowrap">
                      {doc.status === 'proforma' ? (
                        <span className="bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          پیش‌فاکتور
                        </span>
                      ) : (
                        <span className="bg-emerald-100 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                          <CheckCircle2 size={10} /> نهایی
                        </span>
                      )}
                    </td>

                    {/* Date */}
                    <td className="p-3 font-mono text-slate-600 font-medium whitespace-nowrap" dir="ltr">
                      {formatPersianDate(doc.date)}
                    </td>

                    {/* Party Name */}
                    <td className="p-3">
                      {doc.buyer_name ? (
                        <div>
                          <span className="font-bold text-slate-800 block text-xs">
                            {isReceipt ? `تامین‌کننده: ${doc.buyer_name}` : isInvoice || isProforma ? `مشتری: ${doc.buyer_name}` : doc.buyer_name}
                          </span>
                          {(doc.buyer_phone || doc.buyer_city) && (
                            <span className="text-[10px] text-slate-500 font-mono">
                              {[doc.buyer_city, doc.buyer_phone].filter(Boolean).join(' - ')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 font-medium">-</span>
                      )}
                    </td>

                    {/* Quantity & Items Count */}
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="inline-block bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="font-bold text-slate-800 block font-mono text-xs">
                          {formatPersianNumber(itemsCount)} ردیف
                        </span>
                        <span className="text-[10px] text-slate-500 block font-mono">
                          {formatPersianNumber(totalQty)} واحد
                        </span>
                      </div>
                    </td>

                    {/* Total Value / Amount */}
                    <td className="p-3 whitespace-nowrap">
                      {totalDocAmount > 0 ? (
                        <div>
                          <strong className={`font-mono text-xs font-black block ${
                            isReceipt ? 'text-emerald-800' : isInvoice ? 'text-blue-800' : 'text-slate-800'
                          }`}>
                            {formatPersianPrice(totalDocAmount)}
                          </strong>
                          <span className="text-[10px] text-slate-500 font-normal">{currencyLabel}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono text-[11px]">-</span>
                      )}
                    </td>

                    {/* Notes (Editable Inline) */}
                    <td className="p-3">
                      {editingNotesId === doc.id ? (
                        <div className="flex items-center gap-2">
                          <textarea 
                            value={tempNotes} 
                            onChange={e => setTempNotes(e.target.value)} 
                            className="w-full border border-blue-400 rounded-lg p-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            rows={2}
                          />
                          <div className="flex flex-col gap-1 shrink-0">
                            <button 
                              onClick={() => handleUpdateNotes(doc.id)} 
                              className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-lg text-[10px] cursor-pointer font-bold"
                            >
                              ثبت
                            </button>
                            <button 
                              onClick={() => setEditingNotesId(null)} 
                              className="bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded-lg text-[10px] cursor-pointer font-medium"
                            >
                              لغو
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between group gap-2">
                          <span className="text-slate-600 text-[11px] line-clamp-2 leading-relaxed" title={doc.notes}>
                            {doc.notes || <span className="text-slate-300">-</span>}
                          </span>
                          <button 
                            onClick={() => { setEditingNotesId(doc.id); setTempNotes(doc.notes || ''); }} 
                            className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800 p-1 cursor-pointer transition-opacity rounded hover:bg-blue-50 shrink-0"
                            title="ویرایش توضیحات"
                          >
                            <Edit3 size={13} />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button 
                          onClick={() => setWorkflowDoc(doc)} 
                          className="p-1.5 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1 font-bold"
                          title="چرخه تاییدات و ارسال به انبار (Workflow)"
                        >
                          <GitBranch size={14} />
                          <span className="hidden xl:inline text-[10px]">گردش‌کار</span>
                        </button>
                        <button 
                          onClick={() => handleOpenDetails(doc)} 
                          className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs transition-colors cursor-pointer"
                          title="مشاهده ریز اقلام و ارقام سند"
                        >
                          <Eye size={14} />
                        </button>
                        <button 
                          onClick={() => handlePrint(doc.id)} 
                          className="p-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs transition-colors cursor-pointer"
                          title="چاپ سند / فاکتور رسمی"
                        >
                          <Printer size={14} />
                        </button>
                        <button 
                          onClick={() => handleDeleteDoc(doc.id, doc.ref_number)} 
                          className="p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg text-xs transition-colors cursor-pointer"
                          title="ابطال / حذف سند"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && safeDocs.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-400 text-xs">
                    سندی مطابق فیلترهای انتخابی یا عبارت جستجو یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Bar */}
        <div className="p-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/80">
          <span className="text-slate-600 font-medium">
            نمایش {formatPersianNumber(safeDocs.length)} از مجموع {formatPersianNumber(totalItems)} سند ثبت‌شده (صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1 || loading}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs shadow-2xs"
            >
              اولین
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs"
              title="صفحه قبلی"
            >
              <ChevronRight size={15} />
            </button>
            <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg shadow-2xs">
              {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs"
              title="صفحه بعدی"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs shadow-2xs"
            >
              آخرین
            </button>
          </div>
        </div>
      </div>

      {/* Quick Document Details Modal */}
      {selectedDocDetails && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shadow-xs ${
                  selectedDocDetails.type === 'receipt' ? 'bg-emerald-600' : selectedDocDetails.type === 'invoice' ? 'bg-blue-600' : 'bg-slate-700'
                }`}>
                  {selectedDocDetails.type === 'receipt' ? <ShoppingCart size={20} /> : <FileText size={20} />}
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
                    <span>
                      {selectedDocDetails.type === 'receipt' ? 'رسید ورود و فاکتور خرید' : selectedDocDetails.type === 'invoice' ? 'صورتحساب فروش کالا' : 'جزئیات سند انبارداری'}
                    </span>
                    <span className="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                      شماره: {formatPersianNumber(selectedDocDetails.ref_number)}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                    تاریخ ثبت: {formatPersianDate(selectedDocDetails.date)} | ثبت توسط: {selectedDocDetails.user || 'سیستم'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const docId = selectedDocDetails.id;
                    setSelectedDocDetails(null);
                    handlePrint(docId);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                >
                  <Printer size={15} />
                  <span>چاپ فاکتور رسمی</span>
                </button>
                <button
                  onClick={() => setSelectedDocDetails(null)}
                  className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Parties & Metadata Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold block mb-1">طرف حساب سند</span>
                  <div className="font-bold text-slate-800 text-xs">
                    {selectedDocDetails.buyer_name || 'ثبت نشده (عمومی)'}
                  </div>
                  {selectedDocDetails.buyer_phone && (
                    <div className="text-[11px] font-mono text-slate-600 mt-1" dir="ltr">
                      {selectedDocDetails.buyer_phone}
                    </div>
                  )}
                  {selectedDocDetails.buyer_city && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      شهر / استان: {selectedDocDetails.buyer_city}
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold block mb-1">اطلاعات وضعیت و ماهیت</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-bold text-slate-700">نوع سند:</span>
                    <span className="font-medium text-slate-900">
                      {selectedDocDetails.type === 'receipt' ? 'رسید ورود (خرید کالا)' : selectedDocDetails.type === 'invoice' ? 'فاکتور فروش' : selectedDocDetails.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-bold text-slate-700">وضعیت:</span>
                    <span className="font-bold text-emerald-700">
                      {selectedDocDetails.status === 'proforma' ? 'پیش‌فاکتور' : 'نهایی‌شده'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold block mb-1">واحد پولی و مالی</span>
                  <div className="font-bold text-slate-800 text-xs">
                    واحد ارز: {formatCurrencyLabel(selectedDocDetails.currency || 'IRR')}
                  </div>
                  {selectedDocDetails.notes && (
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2" title={selectedDocDetails.notes}>
                      یادداشت: {selectedDocDetails.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Workflow Stepper in Document Details */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
                <WorkflowStepperWidget
                  entityType="document"
                  entityId={selectedDocDetails.id}
                  workflowCode="DOC_APPROVAL_WORKFLOW"
                  title={`چرخه تاییدات و گردش‌کار سند شماره ${formatPersianNumber(selectedDocDetails.ref_number)}`}
                  onStateChange={() => {
                    loadData();
                  }}
                />
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2 font-bold text-slate-700 text-xs border-b border-slate-200 flex justify-between items-center">
                  <span>ریز اقلام و ردیف‌های سند ({formatPersianNumber((selectedDocDetails.items || []).length)} قلم)</span>
                  <span className="text-[11px] font-mono text-slate-500">
                    مجموع تعداد: {formatPersianNumber((selectedDocDetails.items || []).reduce((acc: any, i: any) => acc + Number(i.quantity || 0), 0))} واحد
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px] sticky top-0">
                      <tr>
                        <th className="p-2.5 w-12 text-center">ردیف</th>
                        <th className="p-2.5 w-24">کد کالا</th>
                        <th className="p-2.5">شرح کالا و مشخصات</th>
                        <th className="p-2.5 text-center">تعداد</th>
                        <th className="p-2.5 text-center">واحد</th>
                        <th className="p-2.5 text-left">قیمت واحد</th>
                        <th className="p-2.5 text-left">تخفیف</th>
                        <th className="p-2.5 text-left">مبلغ کل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(selectedDocDetails.items || []).map((it: any, idx: number) => {
                        const qty = Number(it.quantity || 0);
                        const price = Number(it.unit_price || 0);
                        const disc = Number(it.discount || 0);
                        const total = (qty * price) - disc;

                        return (
                          <tr key={it.id || idx} className="hover:bg-slate-50">
                            <td className="p-2.5 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                            <td className="p-2.5 font-mono text-[11px] text-slate-700" dir="ltr">{formatPersianNumber(it.code || '-')}</td>
                            <td className="p-2.5 font-bold text-slate-800">{it.name || `کالای کد ${it.item_id}`}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-800">{formatPersianNumber(qty)}</td>
                            <td className="p-2.5 text-center text-slate-600">{it.unit || 'عدد'}</td>
                            <td className="p-2.5 text-left font-mono font-medium">{formatPersianPrice(price)}</td>
                            <td className="p-2.5 text-left font-mono text-rose-600">{disc > 0 ? formatPersianPrice(disc) : '-'}</td>
                            <td className="p-2.5 text-left font-mono font-black text-slate-900 bg-slate-50/50">
                              {formatPersianPrice(total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals Summary Bar */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 font-black">
                    <DollarSign size={22} />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">جمع کل ارزش نهایی سند:</span>
                    <strong className="text-base font-black text-white font-mono">
                      {formatPersianPrice((selectedDocDetails.items || []).reduce((acc: any, i: any) => acc + (Number(i.quantity || 0) * Number(i.unit_price || 0)) - Number(i.discount || 0), 0))} {formatCurrencyLabel(selectedDocDetails.currency)}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">جمع ناخالص:</span>
                    <span className="font-mono text-slate-200 font-bold">
                      {formatPersianPrice((selectedDocDetails.items || []).reduce((acc: any, i: any) => acc + (Number(i.quantity || 0) * Number(i.unit_price || 0)), 0))}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">مجموع تخفیف:</span>
                    <span className="font-mono text-rose-400 font-bold">
                      {formatPersianPrice((selectedDocDetails.items || []).reduce((acc: any, i: any) => acc + Number(i.discount || 0), 0))}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedDocDetails(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Workflow Action Modal */}
      {workflowDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 my-auto">
            <div className="bg-slate-900 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-purple-400 shrink-0" />
                <h3 className="font-bold text-xs sm:text-sm">
                  چرخه تاییدات و گردش‌کار سند شماره {formatPersianNumber(workflowDoc.ref_number)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWorkflowDoc(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-slate-500 block text-[11px]">طرف حساب:</span>
                  <span className="font-bold text-slate-900">{workflowDoc.buyer_name || 'عمومی / ثبت نشده'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">نوع سند:</span>
                  <span className="font-bold text-blue-700 font-mono">
                    {workflowDoc.type === 'invoice' ? 'فاکتور فروش' : workflowDoc.type === 'receipt' ? 'رسید ورود' : workflowDoc.type}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">وضعیت فعلی:</span>
                  <span className="font-bold text-emerald-700">
                    {workflowDoc.status === 'proforma' ? 'پیش‌فاکتور' : 'نهایی'}
                  </span>
                </div>
              </div>

              <WorkflowStepperWidget
                entityType="document"
                entityId={workflowDoc.id}
                workflowCode="DOC_APPROVAL_WORKFLOW"
                title="اقدامات و گام‌های چرخه تایید"
                onStateChange={() => {
                  loadData();
                }}
              />
            </div>
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkflowDoc(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
