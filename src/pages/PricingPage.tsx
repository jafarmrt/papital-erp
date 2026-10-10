import React, { useEffect, useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UnsavedPriceEditsBar } from '../components/pricing/UnsavedPriceEditsBar';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';
import { Item, ItemPrice } from '../types';
import { 
  Search, Save, LayoutGrid, List,
  Download, Upload, AlertCircle, Check, RefreshCw, FileSpreadsheet, Tag
} from 'lucide-react';
import { 
  cn, 
  formatPersianNumber, 
  formatPersianDateTime, 
  getStrategyCanonicalKey,
  formatStrategyDisplayTitle,
  cleanDecimalString
} from '../utils';
import { useSearch } from '../SearchContext';
import { useHasPermission } from '../contexts/AuthContext';
import { QUERY_KEYS } from '../lib/queryKeys';
import PriceHistoryModal from '../components/pricing/PriceHistoryModal';
import { PricingGridView, PricingTableView } from '../components/pricing/PricingViews';
import * as xlsx from 'xlsx';
import UnifiedExcelModal from '../components/UnifiedExcelModal';
import { buildQuickPriceUpdates } from '../lib/items/quickPriceImport';
import { priceSaveUpdates, type PriceFieldEdit } from '../lib/items/priceInput';
import { ITEM_WAC_COLUMN, priceExportCells } from '../lib/items/excelPriceColumns';
import { priceMarginPercent } from '../lib/items/priceMargin';

export default function PricingPage() {
  // v9.0.209 (O14): ورود سریع، فیلدهای قیمت و ذخیره فقط با مجوز مسیرهای ذخیره قیمت سرور، نه نقش «viewer»
  const canEditPrices = useHasPermission('products.edit_price');
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch } = useSearch();
  const [tab, setTab] = useState<'product'|'raw_material'>('product');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [priceFilter, setPriceFilter] = useState<'all' | 'missing_price' | 'has_price'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [showExcelModal, setShowExcelModal] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const excelInputRef = useRef<HTMLInputElement>(null);

  // V9 Phase 5.1: مهاجرت به React Query — چهار منبع داده در کوئری‌های مستقل با کش
  const queryClient = useQueryClient();

  // V4 Phase 6.2 (U-1): ریست صفحه با debouncedSearchQuery
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, tab, selectedCategory, priceFilter]);
  
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyStrategyFilter, setHistoryStrategyFilter] = useState<string>('all');
  
  // State for tracking un-saved local inputs: itemId -> { canonicalKey: { title: string, price: string, currency: string } }
  const [localEdits, setLocalEdits] = useState<Record<number, Record<string, { title: string; price: string; currency: string }>>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [isSavingAll, setIsSavingAll] = useState<boolean>(false);

  // آیتم‌ها بر اساس تب محصول/ماده اولیه
  const itemsQuery = useQuery<Item[]>({
    queryKey: QUERY_KEYS.items.list({ scope: 'pricing', type: tab }),
    queryFn: async () => {
      const res = await fetchJson(`/items?type=${tab}&limit=0`);
      return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const categoriesQuery = useQuery<any[]>({
    queryKey: QUERY_KEYS.categories.list('all'),
    queryFn: async () => {
      const cats = await fetchJson('/categories');
      return Array.isArray(cats) ? cats : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const pricesQuery = useQuery<Record<number, ItemPrice[]>>({
    queryKey: QUERY_KEYS.prices.byItem(null),
    queryFn: async () => {
      const allPrices = await fetchJson('/items/prices/all');
      return allPrices && typeof allPrices === 'object' && !Array.isArray(allPrices) ? allPrices : {};
    },
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const strategiesQuery = useQuery<string[]>({
    queryKey: [...QUERY_KEYS.settings.list(), 'pricing-strategies'],
    queryFn: async () => {
      const settings = await fetchJson('/settings');
      let strats: string[] = [];
      if (Array.isArray(settings)) {
        const st = settings.find((s: any) => s.key === 'pricing_strategies');
        if (st && st.value) {
          if (st.value.trim().startsWith('[')) {
            try {
              const parsed = JSON.parse(st.value);
              if (Array.isArray(parsed)) {
                strats = parsed.map((s: any) => formatStrategyDisplayTitle(String(s))).filter(Boolean);
              }
            } catch (e) {
              console.error('Failed to parse pricing_strategies JSON setting:', e);
            }
          }
          if (strats.length === 0) {
            strats = st.value.split(',').map((s: string) => formatStrategyDisplayTitle(s)).filter(Boolean);
          }
        }
      }
      return strats.length > 0 ? strats : ['فروشگاه', 'مصرف‌کننده', 'عمده'];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const items = itemsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const prices = pricesQuery.data ?? {};
  const strategies = strategiesQuery.data ?? ['فروشگاه', 'مصرف‌کننده', 'عمده'];

  const loadData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.items.all }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.prices.all }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.categories.all }),
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.settings.list(), 'pricing-strategies'] }),
    ]);
  };

  // Get effective price and currency for an item and strategy
  const getFieldValue = (itemId: number, strategyTitle: string): { price: string; currency: string } => {
    const targetCanonical = getStrategyCanonicalKey(strategyTitle);

    // Check local unsaved edits first
    const itemEdits = localEdits[itemId];
    if (itemEdits) {
      for (const [key, val] of Object.entries(itemEdits)) {
        if (getStrategyCanonicalKey(key) === targetCanonical) {
          const editVal = val as { title: string; price: string; currency: string };
          return { price: editVal.price, currency: editVal.currency || 'IRR' };
        }
      }
    }

    // Check existing prices loaded from DB
    const itemPricesList = prices[itemId] || [];
    const existing = itemPricesList.find(p => getStrategyCanonicalKey(p.title) === targetCanonical);

    if (existing) {
      return {
        price: existing.price !== undefined && existing.price !== null ? cleanDecimalString(existing.price, 1) : '',
        currency: existing.currency || 'IRR'
      };
    }

    return {
      price: '',
      currency: 'IRR'
    };
  };

  const handlePriceChange = (itemId: number, strategyTitle: string, newPrice: string, currentCurrency?: string) => {
    const cleanTitle = formatStrategyDisplayTitle(strategyTitle);
    const canKey = getStrategyCanonicalKey(cleanTitle);
    const current = getFieldValue(itemId, cleanTitle);

    setLocalEdits(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [canKey]: {
          title: cleanTitle,
          price: newPrice,
          currency: currentCurrency || current.currency || 'IRR'
        }
      }
    }));
  };

  const handleCurrencyChange = (itemId: number, strategyTitle: string, newCurrency: string, currentPrice?: string) => {
    const cleanTitle = formatStrategyDisplayTitle(strategyTitle);
    const canKey = getStrategyCanonicalKey(cleanTitle);
    const current = getFieldValue(itemId, cleanTitle);

    setLocalEdits(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [canKey]: {
          title: cleanTitle,
          price: currentPrice !== undefined ? currentPrice : current.price,
          currency: newCurrency
        }
      }
    }));
  };

  const handleSaveItemPrices = async (itemId: number) => {
    setSavingId(itemId);
    const itemLocal = localEdits[itemId] || {};
    try {
      // v9.0.176 (TD-657): خانه خالی حذف صریح است و عدد نامعتبر فرستاده نمی‌شود (پیش‌تر صفر می‌رفت و قیمت پاک می‌شد)
      const edits: PriceFieldEdit[] = [];
      for (const st of strategies) {
        const cleanTitle = formatStrategyDisplayTitle(st);
        const fieldEdit = itemLocal[getStrategyCanonicalKey(cleanTitle)];
        if (fieldEdit !== undefined) edits.push({ title: cleanTitle, price: fieldEdit.price, currency: fieldEdit.currency || 'IRR' });
      }
      const { updates, errors } = priceSaveUpdates(edits.map(edit => ({ itemId, edit })));
      if (errors.length > 0) {
        toast.error(errors[0]);
        return;
      }

      if (updates.length > 0) {
        await fetchJson('/items/prices/batch-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });
      }

      const currentPrices = await fetchJson(`/items/${itemId}/prices`);
      queryClient.setQueryData<Record<number, ItemPrice[]>>(QUERY_KEYS.prices.byItem(null), (prev) => ({
        ...(prev || {}),
        [itemId]: Array.isArray(currentPrices) ? currentPrices : [],
      }));

      setLocalEdits(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      toast.success('قیمت‌های این کالا با موفقیت ذخیره شدند.');
    } catch(err: any) { 
      toast.error(err.message || 'خطا در ذخیره قیمت‌ها'); 
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveAllLocalEdits = async () => {
    const { updates: allUpdates, errors } = priceSaveUpdates(Object.entries(localEdits).flatMap(([itemIdStr, stMap]) =>
      Number(itemIdStr) ? Object.values(stMap).map(edit => ({ itemId: Number(itemIdStr), edit })) : []));

    if (errors.length > 0) {
      toast.error(errors.length > 1 ? `${errors[0]} (و ${formatPersianNumber(errors.length - 1)} خانه دیگر)` : errors[0]);
      return;
    }
    if (allUpdates.length === 0) {
      toast('هیچ تغییر ذخیره‌نشده‌ای وجود ندارد.');
      return;
    }

    setIsSavingAll(true);
    try {
      await fetchJson('/items/prices/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: allUpdates })
      });

      setLocalEdits({});
      await loadData();
      toast.success(`تمام تغییرات قیمت (${formatPersianNumber(allUpdates.length)} مورد) با موفقیت ذخیره گردید.`);
    } catch (err: any) {
      toast.error('خطا در ذخیره‌سازی تغییرات: ' + (err.message || 'خطای نامشخص'));
    } finally {
      setIsSavingAll(false);
    }
  };

  // Dedicated Fast Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filtered.map(item => {
        const row: Record<string, any> = {
          'کد کالا': item.code,
          'نام کالا': item.name,
          'دسته‌بندی': item.category || '-',
          'نوع کالا': item.type === 'product' ? 'محصول نهایی' : 'ماده اولیه',
          'موجودی کل': item.current_stock || 0,
          'واحد شمارش': item.unit || 'عدد',
          [ITEM_WAC_COLUMN]: item.weighted_average_cost || 0,
        };

        // v9.0.207 (O12): ارز هر فهرست در ستون خودش؛ ورود سریع همان ستون را می‌خواند
        Object.assign(row, priceExportCells(strategies.map(st => formatStrategyDisplayTitle(st)), title => getFieldValue(item.id, title)));
        return row;
      });

      const ws = xlsx.utils.json_to_sheet(exportData);
      const wb = xlsx.utils.book_new();
      const sheetTitle = tab === 'product' ? 'قیمت_محصولات' : 'قیمت_مواد_اولیه';
      xlsx.utils.book_append_sheet(wb, ws, sheetTitle);
      xlsx.writeFile(wb, `${sheetTitle}.xlsx`);
      toast.success('فایل اکسل قیمت‌ها با موفقیت دانلود شد.');
    } catch (err: any) {
      console.error(err);
      toast.error('خطا در ایجاد فایل اکسل: ' + err.message);
    }
  };

  // Dedicated Fast Excel Import
  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = xlsx.read(bstr, { type: 'binary' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawData = xlsx.utils.sheet_to_json<any>(ws);

        if (!rawData || rawData.length === 0) {
          toast.error('فایل اکسل خالی است یا قالب آن خوانده نشد.');
          return;
        }

        // v9.0.152 (TD-647): فقط ستون‌های فهرست‌های قیمت تنظیم‌شده؛ ستون دیگرِ «قیمت …» نادیده گرفته و گزارش می‌شود
        const { updates, unknownColumns, invalidCells } = buildQuickPriceUpdates(rawData, Array.isArray(items) ? items : [], strategies);
        if (unknownColumns.length > 0) {
          toast.error(`این ستون‌ها فهرست قیمت تنظیم‌شده‌ای نیستند و نادیده گرفته شدند: ${unknownColumns.join('، ')}`);
        }
        // v9.0.176 (TD-657): قیمت صفر، منفی یا نامعتبر و ارز ناشناخته فرستاده نمی‌شوند و گزارش می‌شوند
        if (invalidCells.length > 0) {
          const sample = invalidCells.slice(0, 3).map(c => `${c.code} «${c.title}»: ${c.value} ${c.currency}`).join('، ');
          toast.error(`${formatPersianNumber(invalidCells.length)} قیمت عدد بزرگ‌تر از صفر یا ارز پشتیبانی‌شده نداشت و ثبت نشد: ${sample}`);
        }

        if (updates.length === 0) {
          toast.error('هیچ کالایی مطابقت پیدا نکرد یا ستون‌های قیمت اکسل شناسایی نشدند.');
          return;
        }

        const res = await fetchJson('/items/prices/batch-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });

        toast.success(`تعداد ${formatPersianNumber(res.count || updates.length)} قیمت از اکسل بارگذاری و به‌روزرسانی شد.`);
        await loadData();
      } catch (err: any) {
        console.error(err);
        toast.error('خطا در پردازش فایل اکسل: ' + (err.message || 'قالب نامعتبر'));
      } finally {
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleOpenHistory = async (item: Item) => {
    setHistoryItem(item);
    setLoadingHistory(true);
    setHistoryData([]);
    setHistoryStrategyFilter('all');
    try {
      const data = await fetchJson(`/items/${item.id}/prices/history`);
      setHistoryData(Array.isArray(data) ? data : []);
    } catch(err: any) {
      toast.error(err.message || 'خطا در دریافت تاریخچه قیمت');
    }
    setLoadingHistory(false);
  };

  // Calculate profit margin % relative to WAC
  const getMarginBadge = (priceStr: string, currency: string, wacNum?: number) => {
    const margin = priceMarginPercent(priceStr, currency, wacNum);
    if (margin === null) return null;

    if (margin > 0) {
      return (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded dir-ltr shrink-0" title="حاشیه سود نسبت به قیمت خرید">
          +{formatPersianNumber(margin)}٪ سود
        </span>
      );
    } else if (margin < 0) {
      return (
        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded dir-ltr shrink-0" title="قیمت زیر قیمت تمام‌شده خرید است!">
          {formatPersianNumber(Math.abs(margin))}٪ زیان
        </span>
      );
    } else {
      return (
        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded dir-ltr shrink-0">
          سربرسر (۰٪)
        </span>
      );
    }
  };

  const safeItems = Array.isArray(items) ? items : [];
  // V4 Phase 6.2 (U-1): فیلتر محصولات قیمت‌گذاری با useMemo و debouncedSearchQuery
  const filtered = React.useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    return safeItems.filter(item => {
      // Text search
      const matchesSearch = !q ||
        item.name.toLowerCase().includes(q) || 
        item.code.toLowerCase().includes(q) || 
        (item.category && item.category.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Category filter
      if (selectedCategory && item.category !== selectedCategory) return false;

      // Price completeness filter
      if (priceFilter === 'missing_price') {
        const hasAllStrategies = strategies.every(st => {
          const val = getFieldValue(item.id, st);
          return val.price !== '' && Number(val.price) > 0;
        });
        return !hasAllStrategies;
      } else if (priceFilter === 'has_price') {
        const hasAllStrategies = strategies.every(st => {
          const val = getFieldValue(item.id, st);
          return val.price !== '' && Number(val.price) > 0;
        });
        return hasAllStrategies;
      }

      return true;
    });
  }, [safeItems, debouncedSearchQuery, selectedCategory, priceFilter, strategies, prices, localEdits]);
  
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedItems = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalLocalEditsCount = Object.values(localEdits).reduce<number>((sum, map) => sum + Object.keys(map).length, 0);

  return (
    <div className="flex flex-col h-full bg-slate-50/50 space-y-6 p-4 md:p-6 max-w-[1700px] mx-auto text-right font-farsi">
      {/* Top Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-amber-400 shadow-inner shrink-0">
              <Tag size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                مدیریت و تعیین قیمت کالاها
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                تعیین سطوح و سیاست‌های قیمتی ({strategies.join('، ')})، ورود/خروج اکسل و ثبت چند ارزی
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2.5 items-center">
            {/* Tab Switcher */}
            <div className="flex bg-slate-800/80 backdrop-blur-xs p-1 rounded-xl border border-slate-700/80">
              <button 
                onClick={() => setTab('product')} 
                className={cn("px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer", tab === 'product' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white")}
              >
                محصولات نهایی
              </button>
              <button 
                onClick={() => setTab('raw_material')} 
                className={cn("px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer", tab === 'raw_material' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white")}
              >
                مواد اولیه
              </button>
            </div>

            {/* Fast Excel Export & Import */}
            <button
              onClick={handleExportExcel}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold px-3 py-2.5 rounded-xl border border-slate-700 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="خروجی سریع اکسل قیمت‌های فعلی"
            >
              <Download size={15} className="text-emerald-400" />
              خروجی اکسل قیمت‌ها
            </button>

            {canEditPrices && (
              <label className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold px-3 py-2.5 rounded-xl border border-slate-700 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer">
                <Upload size={15} className="text-blue-400" />
                ورود سریع اکسل قیمت
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={handleImportExcel}
                />
              </label>
            )}

            {/* Unified Excel Button */}
            <button
              onClick={() => setShowExcelModal(true)}
              className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20 active:scale-95 cursor-pointer"
              title="مدیریت پیشرفته اکسل، ورود و خروجی قیمت‌ها و محصولات"
            >
              <FileSpreadsheet size={16} />
              مدیریت جامع اکسل
            </button>
          </div>
        </div>

        {/* Stats Summary row in Hero */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 mt-5 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
            <span className="text-xs text-slate-400 font-medium">کل اقلام فهرست:</span>
            <strong className="text-sm font-black text-white font-mono">{formatPersianNumber(filtered.length)} مورد</strong>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
            <span className="text-xs text-slate-400 font-medium">سیاست‌های قیمتی فعال:</span>
            <strong className="text-sm font-black text-indigo-300">{formatPersianNumber(strategies.length)} سطح ({strategies.join('، ')})</strong>
          </div>

          {totalLocalEditsCount > 0 ? (
            <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-3 flex items-center gap-2 col-span-2 md:col-span-1">
              <AlertCircle size={16} className="text-amber-400 shrink-0" />
              <span className="text-xs text-amber-200 font-bold">
                {formatPersianNumber(totalLocalEditsCount)} تغییر ذخیره‌نشده در فرم
              </span>
            </div>
          ) : (
            <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3 flex items-center gap-2">
              <Check size={16} className="text-emerald-400 shrink-0" />
              <span className="text-xs text-slate-300">همه قیمت‌ها با پایگاه داده همگام هستند</span>
            </div>
          )}
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={15} />
            <input 
              type="text" 
              placeholder="جستجو بر اساس نام یا کد..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-9 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50 hover:bg-white"
            />
          </div>
          
          {/* Category Select */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-40 py-1.5 px-2.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50 hover:bg-white"
          >
            <option value="">همه دسته‌بندی‌ها</option>
            {categories.filter(c => c.type === tab).map((c, idx) => (
              <option key={`cat-pricing-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
            ))}
          </select>

          {/* Missing Price Filter */}
          <select
            value={priceFilter}
            onChange={(e) => setPriceFilter(e.target.value as any)}
            className="w-44 py-1.5 px-2.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50 hover:bg-white font-bold text-slate-700"
          >
            <option value="all">همه اقلام</option>
            <option value="missing_price">اقلام فاقد قیمت کامل ⚠️</option>
            <option value="has_price">اقلام دارای قیمت کامل ✅</option>
          </select>
        </div>
        
        {/* Layout Toggle & Batch Save Button */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          {totalLocalEditsCount > 0 && (
            <button
              onClick={handleSaveAllLocalEdits}
              disabled={isSavingAll}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-xs flex items-center gap-1.5 animate-bounce"
            >
              {isSavingAll ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              ذخیره یکجای {formatPersianNumber(totalLocalEditsCount)} تغییر
            </button>
          )}

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn("p-1.5 rounded-lg transition-all cursor-pointer", viewMode === 'grid' ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-500 hover:text-slate-700")}
              title="نمایش کارتی"
            >
              <LayoutGrid size={15} />
            </button>
            <button 
              onClick={() => setViewMode('table')}
              className={cn("p-1.5 rounded-lg transition-all cursor-pointer", viewMode === 'table' ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-500 hover:text-slate-700")}
              title="نمایش جدولی"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto pb-16">
        {viewMode === 'grid' ? (
          <PricingGridView
            items={paginatedItems}
            strategies={strategies}
            localEdits={localEdits}
            savingId={savingId}
            canEditPrices={canEditPrices}
            getFieldValue={getFieldValue}
            handlePriceChange={handlePriceChange}
            handleCurrencyChange={handleCurrencyChange}
            getMarginBadge={getMarginBadge}
            handleSaveItemPrices={handleSaveItemPrices}
            handleOpenHistory={handleOpenHistory}
            formatStrategyDisplayTitle={formatStrategyDisplayTitle}
            getStrategyCanonicalKey={getStrategyCanonicalKey}
          />
        ) : (
          /* Table View */
          <PricingTableView
            items={paginatedItems}
            strategies={strategies}
            localEdits={localEdits}
            savingId={savingId}
            canEditPrices={canEditPrices}
            getFieldValue={getFieldValue}
            handlePriceChange={handlePriceChange}
            handleCurrencyChange={handleCurrencyChange}
            getMarginBadge={getMarginBadge}
            handleSaveItemPrices={handleSaveItemPrices}
            handleOpenHistory={handleOpenHistory}
            formatStrategyDisplayTitle={formatStrategyDisplayTitle}
            getStrategyCanonicalKey={getStrategyCanonicalKey}
          />
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="mt-6 flex justify-center items-center gap-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="px-3 py-1.5 border rounded-xl text-xs font-bold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
            >
              قبلی
            </button>
            <span className="text-xs font-bold text-slate-600">
              صفحه {formatPersianNumber(currentPage)} از {formatPersianNumber(totalPages)}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="px-3 py-1.5 border rounded-xl text-xs font-bold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
            >
              بعدی
            </button>
          </div>
        )}
      </div>

      {/* v10.0.102 (TD-1201): نوار تغییرات ذخیره‌نشده در جریان صفحه، نه روی کارت‌ها */}
      {canEditPrices && (
        <UnsavedPriceEditsBar
          count={totalLocalEditsCount}
          isSaving={isSavingAll}
          onCancel={() => setLocalEdits({})}
          onSaveAll={handleSaveAllLocalEdits}
        />
      )}

      {/* V9 Phase 5.2: مودال تاریخچه قیمت استخراج‌شده */}
      <PriceHistoryModal
        historyItem={historyItem}
        onClose={() => setHistoryItem(null)}
        historyData={historyData}
        loadingHistory={loadingHistory}
        strategyFilter={historyStrategyFilter}
        onStrategyFilterChange={setHistoryStrategyFilter}
        getStrategyCanonicalKey={getStrategyCanonicalKey}
        formatStrategyDisplayTitle={formatStrategyDisplayTitle}
        formatPersianDateTime={formatPersianDateTime}
      />


      <UnifiedExcelModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        onSuccess={loadData}
        typeFilter={tab}
        title="مدیریت اکسل قیمت‌گذاری‌ها و کالاها"
      />
    </div>
  );
}
