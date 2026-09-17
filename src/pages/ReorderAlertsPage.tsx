import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import { User } from '../types';
import { 
  AlertTriangle, Search, RefreshCw, Printer, CheckCircle2, 
  AlertCircle, ShoppingCart, Box, Hammer, CheckSquare, Square, 
  Package
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../utils';
import { SafeImage } from '../components/SafeImage';
import { useSearch } from '../SearchContext';
import MovementAnalysisSection from './reorder/MovementAnalysisSection';
import { ReorderPurchaseModal, ReorderModalItem } from '../components/reorder/ReorderPurchaseModal';
import ProjectModal from '../components/ProjectModal';
import { ErrorStateView } from '../components/common/ErrorStateView';

export interface ReorderItem {
  id: number;
  name: string;
  code: string;
  type: 'product' | 'raw_material';
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  current_stock: number;
  reorder_point: number;
  weighted_average_cost: number;
  deficit: number;
  deficit_value: number;
  is_zero_stock: boolean;
  stocks?: Record<string, number>;
  [key: string]: any;
}

export default function ReorderAlertsPage({ user }: { user: User }) {
  const [items, setItems] = useState<ReorderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'zero' | 'below_reorder'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Checkbox selections for batch actions
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<number>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());

  // Purchase Order Modal State (For raw materials)
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [purchaseModalItems, setPurchaseModalItems] = useState<ReorderModalItem[]>([]);

  // Production Project Modal State (For products)
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [projectModalProducts, setProjectModalProducts] = useState<Array<{
    item_id: number;
    item_code: string;
    item_name: string;
    quantity: number;
    unit: string;
  }>>([]);
  const [projectModalTitle, setProjectModalTitle] = useState<string>('');

  // Quick Edit Reorder Point Modal State
  const [editingItem, setEditingItem] = useState<ReorderItem | null>(null);
  const [newReorderPoint, setNewReorderPoint] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const loadData = (signal?: AbortSignal) => {
    setLoading(true);
    fetchJson('/items/reorder-alerts', { signal })
      .then((data) => {
        if (Array.isArray(data)) {
          setItems(data);
        } else {
          setItems([]);
        }
        setError(null);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Error loading reorder alerts:', err);
        setError('خطا در دریافت لیست اقلام نیازمند سفارش');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, []);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    const safeItems = Array.isArray(items) ? items : [];
    safeItems.forEach(it => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set);
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const safeItems = Array.isArray(items) ? items : [];
    return safeItems.filter(it => {
      // Stock status filter
      if (stockStatusFilter === 'zero' && !it.is_zero_stock) return false;
      if (stockStatusFilter === 'below_reorder' && it.current_stock > 0) return false;

      // Category filter
      if (selectedCategory !== 'all' && it.category !== selectedCategory) return false;

      // Search
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const matchName = it.name.toLowerCase().includes(query);
        const matchCode = it.code.toLowerCase().includes(query);
        const matchCat = (it.category || '').toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchCat) return false;
      }

      return true;
    });
  }, [items, stockStatusFilter, selectedCategory, search]);

  // Split into raw materials and products
  const rawMaterialItems = useMemo(() => {
    return filteredItems.filter(it => it.type === 'raw_material');
  }, [filteredItems]);

  const productItems = useMemo(() => {
    return filteredItems.filter(it => it.type === 'product');
  }, [filteredItems]);

  // Stats
  const safeItemsForStats = Array.isArray(items) ? items : [];
  const totalAlarms = safeItemsForStats.length;
  const zeroStockCount = safeItemsForStats.filter(i => i.is_zero_stock).length;
  const productsCount = safeItemsForStats.filter(i => i.type === 'product').length;
  const materialsCount = safeItemsForStats.filter(i => i.type === 'raw_material').length;
  
  const totalDeficitCost = filteredItems.reduce((sum, i) => sum + i.deficit_value, 0);

  const materialsDeficitCost = rawMaterialItems.reduce((sum, i) => sum + i.deficit_value, 0);
  const productsDeficitCost = productItems.reduce((sum, i) => sum + i.deficit_value, 0);

  // Material selection handlers
  const handleToggleMaterial = (id: number) => {
    setSelectedMaterialIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAllMaterials = () => {
    if (selectedMaterialIds.size === rawMaterialItems.length && rawMaterialItems.length > 0) {
      setSelectedMaterialIds(new Set());
    } else {
      setSelectedMaterialIds(new Set(rawMaterialItems.map(i => i.id)));
    }
  };

  // Product selection handlers
  const handleToggleProduct = (id: number) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAllProducts = () => {
    if (selectedProductIds.size === productItems.length && productItems.length > 0) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(productItems.map(i => i.id)));
    }
  };

  // Purchase Order Actions (For raw materials)
  const handleOpenPurchaseOrderSingle = (item: ReorderItem) => {
    setPurchaseModalItems([{
      id: item.id,
      name: item.name,
      code: item.code,
      unit: item.unit,
      current_stock: item.current_stock,
      reorder_point: item.reorder_point,
      deficit: item.deficit,
      weighted_average_cost: item.weighted_average_cost,
      type: item.type,
      orderQty: item.deficit,
      unitPrice: item.weighted_average_cost
    }]);
    setIsPurchaseModalOpen(true);
  };

  const handleOpenPurchaseOrderBatch = () => {
    const selected = rawMaterialItems.filter(i => selectedMaterialIds.has(i.id));
    if (selected.length === 0) {
      toast.error('لطفاً حداقل یک قلم ماده اولیه را با تیک زدن انتخاب نمایید.');
      return;
    }
    setPurchaseModalItems(selected.map(item => ({
      id: item.id,
      name: item.name,
      code: item.code,
      unit: item.unit,
      current_stock: item.current_stock,
      reorder_point: item.reorder_point,
      deficit: item.deficit,
      weighted_average_cost: item.weighted_average_cost,
      type: item.type,
      orderQty: item.deficit,
      unitPrice: item.weighted_average_cost
    })));
    setIsPurchaseModalOpen(true);
  };

  // Production Project Actions (For products)
  const handleOpenProjectModalSingle = (item: ReorderItem) => {
    setProjectModalProducts([{
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      quantity: item.deficit,
      unit: item.unit || 'عدد'
    }]);
    setProjectModalTitle(`تولید محصول ${item.name} (جبران کسری انبار)`);
    setIsProjectModalOpen(true);
  };

  const handleOpenProjectModalBatch = () => {
    const selected = productItems.filter(i => selectedProductIds.has(i.id));
    if (selected.length === 0) {
      toast.error('لطفاً حداقل یک محصول را با تیک زدن انتخاب نمایید.');
      return;
    }
    setProjectModalProducts(selected.map(item => ({
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      quantity: item.deficit,
      unit: item.unit || 'عدد'
    })));
    setProjectModalTitle(`تولید کسری محصولات انبار (${formatPersianNumber(selected.length)} قلم)`);
    setIsProjectModalOpen(true);
  };

  const handleUpdateReorderPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const val = Number(newReorderPoint);
    if (isNaN(val) || val < 0) {
      toast.error('لطفاً عدد معتبری وارد نمایید.');
      return;
    }

    setSavingEdit(true);
    try {
      await fetchJson(`/items/${editingItem.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editingItem,
          reorder_point: val
        })
      });

      setEditingItem(null);
      loadData();
      toast.success('نقطه سفارش با موفقیت بروزرسانی شد.');
    } catch (err: any) {
      toast.error(err.message || 'خطا در بروزرسانی نقطه سفارش');
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePrintList = () => {
    window.print();
  };

  return (
    <div className="space-y-6 font-farsi">
      {/* Top Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden shrink-0 print:hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-500/20 border border-amber-400/30 rounded-2xl flex items-center justify-center text-amber-400 shadow-inner shrink-0">
              <AlertTriangle size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                اقلام و کالاها در آستانه سفارش
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                تفکیک هوشمند مواد اولیه نیازمند سفارش خرید و محصولات کارگاهی نیازمند تعریف پروژه تولید
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handlePrintList}
              className="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-slate-700/80 cursor-pointer"
            >
              <Printer size={16} />
              چاپ لیست تامین
            </button>
            
            <button
              onClick={() => loadData()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 cursor-pointer"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              بروزرسانی
            </button>
          </div>
        </div>
      </div>

      {error && (
        <ErrorStateView
          title="خطا در واکشی داده‌های نقطه سفارش"
          description="در ارتباط با سرور برای دریافت فهرست کالاهای نیازمند سفارش مجدد خطایی رخ داده است."
          onRetry={() => loadData()}
          compact
          className="print:hidden"
        />
      )}

      {/* ========================================================================= */}
      {/* 1. TOP SECTION: FILTERS & TABLES OF ITEMS NEEDING REORDER (FIRST IN PAGE) */}
      {/* ========================================================================= */}

      {/* Filters & Search Controls */}
      <div className="bg-white p-4 border rounded-xl shadow-xs space-y-3 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Search box */}
          <div className="relative">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="جستجو کد، نام یا دسته‌بندی..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Stock status filter */}
          <div>
            <select
              value={stockStatusFilter}
              onChange={(e) => setStockStatusFilter(e.target.value as any)}
              className="w-full p-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">همه وضعیت‌ها (موجودی صفر و دارای کسری)</option>
              <option value="zero">فقط کالاهای کاملاً ناموجود (موجودی صفر)</option>
              <option value="below_reorder">فقط کالاهای دارای موجودی کم (زیر آستانه)</option>
            </select>
          </div>

          {/* Category filter */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full p-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">همه دسته‌بندی‌ها</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center text-xs text-slate-500 border-t pt-2.5">
          <span>
            نمایش {formatPersianNumber(filteredItems.length)} مورد هشدار نقطه سفارش 
            ({formatPersianNumber(rawMaterialItems.length)} ماده اولیه + {formatPersianNumber(productItems.length)} محصول کارگاهی)
          </span>
          {(stockStatusFilter !== 'all' || selectedCategory !== 'all' || search) && (
            <button
              onClick={() => {
                setStockStatusFilter('all');
                setSelectedCategory('all');
                setSearch('');
              }}
              className="text-rose-600 hover:underline text-[11px] font-semibold cursor-pointer"
            >
              پاکسازی فیلترها
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. RAW MATERIALS BOX (کادر مواد اولیه در آستانه سفارش - ثبت سفارش خرید) */}
      {/* ========================================================================= */}
      <div className="bg-white border-2 border-amber-200/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Box Header */}
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-50/70 to-white p-4 border-b border-amber-200/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-sm">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  مواد اولیه در آستانه سفارش
                </h2>
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-950 font-black rounded-lg text-xs font-mono">
                  {formatPersianNumber(rawMaterialItems.length)} قلم نیازمند خرید
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                تامین از طریق ثبت سفارش خرید (تکی یا یکجا) و ارسال به کارتابل تدارکات یا صدور مستقیم سند
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-600">
              برآورد هزینه تامین: <span className="font-mono text-amber-800 font-black text-sm">{formatPersianPrice(materialsDeficitCost)}</span>
            </span>

            <button
              type="button"
              onClick={handleOpenPurchaseOrderBatch}
              disabled={selectedMaterialIds.size === 0}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-xs cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>ثبت سفارش خرید یکجا</span>
              {selectedMaterialIds.size > 0 && (
                <span className="px-2 py-0.5 bg-slate-950 text-white rounded-full text-[10px] font-mono">
                  {formatPersianNumber(selectedMaterialIds.size)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Table of Raw Materials */}
        {loading ? (
          <div className="p-10 text-center text-slate-400 space-y-2">
            <RefreshCw className="animate-spin mx-auto text-amber-500" size={24} />
            <p className="text-xs">در حال بارگیری اقلام مواد اولیه...</p>
          </div>
        ) : rawMaterialItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <CheckCircle2 className="mx-auto text-emerald-500" size={32} />
            <p className="text-sm font-bold text-slate-700">هیچ ماده اولیه‌ای در وضعیت هشدار نقطه سفارش نیست</p>
            <p className="text-xs text-slate-400">تمام مواد اولیه انبار دارای موجودی کافی می‌باشند.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-amber-50/50 text-slate-700 border-b border-amber-100 font-bold">
                <tr>
                  <th className="p-3 text-center w-12 print:hidden">
                    <button
                      type="button"
                      onClick={handleToggleAllMaterials}
                      className="p-1 text-slate-600 hover:text-amber-600 cursor-pointer"
                      title="انتخاب همه مواد اولیه"
                    >
                      {selectedMaterialIds.size === rawMaterialItems.length && rawMaterialItems.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-amber-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 text-center w-14">تصویر</th>
                  <th className="p-3">کد کالا</th>
                  <th className="p-3">نام ماده اولیه</th>
                  <th className="p-3">دسته‌بندی</th>
                  <th className="p-3 text-center">موجودی فعلی</th>
                  <th className="p-3 text-center">نقطه سفارش</th>
                  <th className="p-3 text-center">میزان کسری</th>
                  <th className="p-3 text-center">میانگین بهای خرید</th>
                  <th className="p-3 text-center">برآورد ارزش کسری</th>
                  <th className="p-3 text-center print:hidden">عملیات تامین</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rawMaterialItems.map((item) => {
                  const isSelected = selectedMaterialIds.has(item.id);
                  const stockPercent = item.reorder_point > 0 
                    ? Math.min(100, Math.round((item.current_stock / item.reorder_point) * 100)) 
                    : 0;

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-amber-50/30 transition-colors ${isSelected ? 'bg-amber-50/40' : item.is_zero_stock ? 'bg-rose-50/20' : ''}`}
                    >
                      <td className="p-3 text-center print:hidden">
                        <button
                          type="button"
                          onClick={() => handleToggleMaterial(item.id)}
                          className="p-1 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                          )}
                        </button>
                      </td>

                      <td className="p-3 text-center">
                        <div className="w-9 h-9 mx-auto rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                          {item.thumbnail || item.image ? (
                            <SafeImage src={item.thumbnail || item.image} alt={item.name} className="w-full h-full object-cover" fallbackIcon={<Package size={16} />} />
                          ) : (
                            <Package size={16} className="text-slate-400" />
                          )}
                        </div>
                      </td>

                      <td className="p-3 font-mono font-bold text-slate-800">{item.code}</td>

                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">{item.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal">واحد: {item.unit || 'عدد'}</span>
                      </td>

                      <td className="p-3 text-slate-600">{item.category || '-'}</td>

                      <td className="p-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className={`font-mono font-extrabold text-sm ${item.is_zero_stock ? 'text-rose-600' : 'text-amber-600'}`}>
                            {formatPersianNumber(item.current_stock)} {item.unit}
                          </span>
                          <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
                            <div 
                              style={{ width: `${stockPercent}%` }}
                              className={`h-full rounded-full ${item.is_zero_stock ? 'bg-rose-600' : 'bg-amber-500'}`}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-700">
                        {formatPersianNumber(item.reorder_point)} {item.unit}
                      </td>

                      <td className="p-3 text-center">
                        <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 font-mono font-black text-xs">
                          {formatPersianNumber(item.deficit)} {item.unit}
                        </span>
                      </td>

                      <td className="p-3 text-center font-mono text-slate-600">
                        {item.weighted_average_cost ? formatPersianPrice(item.weighted_average_cost) : '-'}
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-amber-800">
                        {item.deficit_value > 0 ? formatPersianPrice(item.deficit_value) : '-'}
                      </td>

                      {/* Procurement Action Buttons */}
                      <td className="p-3 text-center print:hidden">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenPurchaseOrderSingle(item)}
                            title="ثبت سفارش خرید برای این ماده اولیه"
                            className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <ShoppingCart size={13} />
                            ثبت سفارش خرید
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingItem(item);
                              setNewReorderPoint(String(item.reorder_point));
                            }}
                            title="ویرایش نقطه سفارش"
                            className="px-2 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            ویرایش نقطه
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. PRODUCTS BOX (کادر محصولات در آستانه سفارش - تعریف پروژه تولید) */}
      {/* ========================================================================= */}
      <div className="bg-white border-2 border-indigo-200/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Box Header */}
        <div className="bg-gradient-to-r from-indigo-500/10 via-indigo-50/70 to-white p-4 border-b border-indigo-200/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black shadow-sm">
              <Hammer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  محصولات کارگاهی در آستانه سفارش (نیازمند تولید)
                </h2>
                <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-950 font-black rounded-lg text-xs font-mono">
                  {formatPersianNumber(productItems.length)} محصول کسری
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                محصولات در کارگاه تولید می‌شوند؛ جهت جبران کسری، برای آن‌ها پروژه تولید تعریف نمایید (فاقد سفارش خرید)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-600">
              ارزش تخمینی محصولات: <span className="font-mono text-indigo-800 font-black text-sm">{formatPersianPrice(productsDeficitCost)}</span>
            </span>

            <button
              type="button"
              onClick={handleOpenProjectModalBatch}
              disabled={selectedProductIds.size === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-xs cursor-pointer"
            >
              <Hammer className="w-4 h-4" />
              <span>تعریف پروژه تولید یکجا</span>
              {selectedProductIds.size > 0 && (
                <span className="px-2 py-0.5 bg-white text-indigo-900 rounded-full text-[10px] font-mono font-bold">
                  {formatPersianNumber(selectedProductIds.size)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Table of Products */}
        {loading ? (
          <div className="p-10 text-center text-slate-400 space-y-2">
            <RefreshCw className="animate-spin mx-auto text-indigo-500" size={24} />
            <p className="text-xs">در حال بارگیری اقلام محصولات...</p>
          </div>
        ) : productItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <CheckCircle2 className="mx-auto text-emerald-500" size={32} />
            <p className="text-sm font-bold text-slate-700">هیچ محصولی در وضعیت هشدار نقطه سفارش نیست</p>
            <p className="text-xs text-slate-400">تمام محصولات کارگاه دارای موجودی مکفی در انبار می‌باشند.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-indigo-50/50 text-slate-700 border-b border-indigo-100 font-bold">
                <tr>
                  <th className="p-3 text-center w-12 print:hidden">
                    <button
                      type="button"
                      onClick={handleToggleAllProducts}
                      className="p-1 text-slate-600 hover:text-indigo-600 cursor-pointer"
                      title="انتخاب همه محصولات"
                    >
                      {selectedProductIds.size === productItems.length && productItems.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 text-center w-14">تصویر</th>
                  <th className="p-3">کد کالا</th>
                  <th className="p-3">عنوان محصول</th>
                  <th className="p-3">دسته‌بندی</th>
                  <th className="p-3 text-center">موجودی فعلی</th>
                  <th className="p-3 text-center">نقطه سفارش</th>
                  <th className="p-3 text-center">تیراژ کسری تولید</th>
                  <th className="p-3 text-center">میانگین بهای ساخت</th>
                  <th className="p-3 text-center">ارزش کل کسری</th>
                  <th className="p-3 text-center print:hidden">عملیات تولید</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productItems.map((item) => {
                  const isSelected = selectedProductIds.has(item.id);
                  const stockPercent = item.reorder_point > 0 
                    ? Math.min(100, Math.round((item.current_stock / item.reorder_point) * 100)) 
                    : 0;

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-indigo-50/30 transition-colors ${isSelected ? 'bg-indigo-50/40' : item.is_zero_stock ? 'bg-rose-50/20' : ''}`}
                    >
                      <td className="p-3 text-center print:hidden">
                        <button
                          type="button"
                          onClick={() => handleToggleProduct(item.id)}
                          className="p-1 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                          )}
                        </button>
                      </td>

                      <td className="p-3 text-center">
                        <div className="w-9 h-9 mx-auto rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                          {item.thumbnail || item.image ? (
                            <SafeImage src={item.thumbnail || item.image} alt={item.name} className="w-full h-full object-cover" fallbackIcon={<Package size={16} />} />
                          ) : (
                            <Package size={16} className="text-slate-400" />
                          )}
                        </div>
                      </td>

                      <td className="p-3 font-mono font-bold text-slate-800">{item.code}</td>

                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">{item.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal">واحد: {item.unit || 'عدد'}</span>
                      </td>

                      <td className="p-3 text-slate-600">{item.category || '-'}</td>

                      <td className="p-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className={`font-mono font-extrabold text-sm ${item.is_zero_stock ? 'text-rose-600' : 'text-indigo-600'}`}>
                            {formatPersianNumber(item.current_stock)} {item.unit}
                          </span>
                          <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
                            <div 
                              style={{ width: `${stockPercent}%` }}
                              className={`h-full rounded-full ${item.is_zero_stock ? 'bg-rose-600' : 'bg-indigo-500'}`}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-700">
                        {formatPersianNumber(item.reorder_point)} {item.unit}
                      </td>

                      <td className="p-3 text-center">
                        <span className="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-900 font-mono font-black text-xs">
                          {formatPersianNumber(item.deficit)} {item.unit}
                        </span>
                      </td>

                      <td className="p-3 text-center font-mono text-slate-600">
                        {item.weighted_average_cost ? formatPersianPrice(item.weighted_average_cost) : '-'}
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-indigo-900">
                        {item.deficit_value > 0 ? formatPersianPrice(item.deficit_value) : '-'}
                      </td>

                      {/* Production Project Action Buttons */}
                      <td className="p-3 text-center print:hidden">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenProjectModalSingle(item)}
                            title="تعریف پروژه تولید کارگاهی برای این محصول"
                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <Hammer size={13} />
                            تعریف پروژه تولید
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingItem(item);
                              setNewReorderPoint(String(item.reorder_point));
                            }}
                            title="ویرایش نقطه سفارش"
                            className="px-2 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            ویرایش نقطه
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. BOTTOM SECTION: STATS SUMMARY CARDS & MOVEMENT ANALYSIS (GRAPHS/CHART) */}
      {/* ========================================================================= */}

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
        {/* Card 1: Total Alarms */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">کل اقلام در نقطه سفارش</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">
              {formatPersianNumber(totalAlarms)} <span className="text-xs font-normal text-slate-400">قلم</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* Card 2: Zero Stock Items */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">اقلام کاملاً ناموجود (صفر)</p>
            <p className="text-2xl font-extrabold text-rose-600 mt-1">
              {formatPersianNumber(zeroStockCount)} <span className="text-xs font-normal text-rose-400">قلم</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
            <AlertCircle size={20} />
          </div>
        </div>

        {/* Card 3: Products vs Materials breakdown */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">تفکیک تامین و تولید</p>
            <p className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-2">
              <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{formatPersianNumber(materialsCount)} خرید مواد</span>
              <span className="text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{formatPersianNumber(productsCount)} تولید محصول</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Box size={20} />
          </div>
        </div>

        {/* Card 4: Estimated Deficit Value */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">مجموع ارزش برآوردی کسری</p>
            <p className="text-base font-extrabold text-blue-600 mt-1 font-mono">
              {formatPersianPrice(totalDeficitCost)}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <ShoppingCart size={20} />
          </div>
        </div>
      </div>

      {/* Movement Analysis Section (Monthly charts + Fast/Slow/Dead movers) */}
      <MovementAnalysisSection />

      {/* ========================================================================= */}
      {/* 5. MODALS                                                                 */}
      {/* ========================================================================= */}

      {/* Modal 1: Purchase Order Modal (Raw Materials) */}
      <ReorderPurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        selectedItems={purchaseModalItems}
        onSuccess={() => {
          loadData();
          setSelectedMaterialIds(new Set());
        }}
      />

      {/* Modal 2: Production Project Modal (Products) */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        customersList={[]}
        itemsList={items}
        initialProducts={projectModalProducts}
        initialTitle={projectModalTitle}
        onSuccess={() => {
          loadData();
          setSelectedProductIds(new Set());
          toast.success('پروژه تولید با موفقیت تعریف گردید.');
        }}
      />

      {/* Modal 3: Edit Reorder Point Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl space-y-4 max-h-[85vh] overflow-y-auto p-6">
            <h3 className="font-bold text-slate-800 text-base">ویرایش نقطه سفارش کالا</h3>
            <p className="text-xs text-slate-500">
              تنظیم حد آستانه هشدار برای <strong className="text-slate-800">{editingItem.name}</strong> (کد: {editingItem.code})
            </p>

            <form onSubmit={handleUpdateReorderPoint} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  نقطه سفارش جدید (تعداد/مقدار به {editingItem.unit}):
                </label>
                <input
                  type="number"
                  min="0"
                  value={newReorderPoint}
                  onChange={(e) => setNewReorderPoint(e.target.value)}
                  className="w-full p-2.5 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  موجودی فعلی این کالا در انبار: <span className="font-bold text-slate-700">{formatPersianNumber(editingItem.current_stock)} {editingItem.unit}</span> می‌باشد.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                  disabled={savingEdit}
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {savingEdit ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
