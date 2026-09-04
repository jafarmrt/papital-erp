import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import { User } from '../types';
import { 
  AlertTriangle, Search, RefreshCw, ArrowLeft, Filter, 
  Package, Box, Printer, Download, PlusCircle, CheckCircle2, AlertCircle, ShoppingCart, DollarSign
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatPersianPrice, formatPersianNumber } from '../utils';
import { SafeImage } from '../components/SafeImage';
import { useSearch } from '../SearchContext';
import MovementAnalysisSection from './reorder/MovementAnalysisSection';

interface ReorderItem {
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
  const navigate = useNavigate();
  const [items, setItems] = useState<ReorderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'raw_material'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'zero' | 'below_reorder'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

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
      // Type filter
      if (typeFilter !== 'all' && it.type !== typeFilter) return false;
      
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
  }, [items, typeFilter, stockStatusFilter, selectedCategory, search]);

  // Stats
  const safeItemsForStats = Array.isArray(items) ? items : [];
  const totalAlarms = safeItemsForStats.length;
  const zeroStockCount = safeItemsForStats.filter(i => i.is_zero_stock).length;
  const productsCount = safeItemsForStats.filter(i => i.type === 'product').length;
  const materialsCount = safeItemsForStats.filter(i => i.type === 'raw_material').length;
  
  const totalDeficitQuantity = filteredItems.reduce((sum, i) => sum + i.deficit, 0);
  const totalDeficitCost = filteredItems.reduce((sum, i) => sum + i.deficit_value, 0);

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
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden shrink-0 print:hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-rose-600/30 border border-rose-400/30 rounded-2xl flex items-center justify-center text-rose-400 shadow-inner shrink-0">
              <AlertTriangle size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                اقلام و کالاها در آستانه سفارش
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                لیست متمرکز کالاهایی که موجودی آن‌ها به حد مجاز سفارش مجدد رسیده یا صفر شده‌اند
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
              onClick={loadData}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 cursor-pointer"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              بروزرسانی
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl flex items-center gap-2 print:hidden">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
        {/* Card 1: Total Alarms */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">کل اقلام در نقطه سفارش</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">{formatPersianNumber(totalAlarms)} <span className="text-xs font-normal text-slate-400">قلم</span></p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* Card 2: Zero Stock Items */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">اقلام کاملاً ناموجود (صفر)</p>
            <p className="text-2xl font-extrabold text-rose-600 mt-1">{formatPersianNumber(zeroStockCount)} <span className="text-xs font-normal text-rose-400">قلم</span></p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
            <AlertCircle size={20} />
          </div>
        </div>

        {/* Card 3: Products vs Materials breakdown */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">تفکیک نوع کالا</p>
            <p className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-2">
              <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{formatPersianNumber(productsCount)} محصول</span>
              <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{formatPersianNumber(materialsCount)} ماده اولیه</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Box size={20} />
          </div>
        </div>

        {/* Card 4: Estimated Deficit Value */}
        <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">ارزش برآوردی تامین کسری</p>
            <p className="text-lg font-extrabold text-blue-600 mt-1 font-mono">
              {formatPersianPrice(totalDeficitCost)}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <ShoppingCart size={20} />
          </div>
        </div>
      </div>

      {/* V10-3.3: تحلیل گردش کالا — منتقل‌شده از داشبورد (نمودار ماهانه + تند/کند/راکد) */}
      <MovementAnalysisSection />

      {/* Filters & Search Controls */}
      <div className="bg-white p-4 border rounded-xl shadow-xs space-y-3 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search box */}
          <div className="relative md:col-span-1">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="جستجو کد، نام یا دسته‌بندی..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Item type filter */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full p-2 border rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">همه انواع کالاها (محصولات و مواد اولیه)</option>
              <option value="product">فقط محصولات نهایی</option>
              <option value="raw_material">فقط مواد اولیه</option>
            </select>
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
          <span>نمایش {formatPersianNumber(filteredItems.length)} از مجموع {formatPersianNumber(items.length)} مورد هشدار نقطه سفارش</span>
          <div className="flex items-center gap-2">
            {(typeFilter !== 'all' || stockStatusFilter !== 'all' || selectedCategory !== 'all' || search) && (
              <button
                onClick={() => {
                  setTypeFilter('all');
                  setStockStatusFilter('all');
                  setSelectedCategory('all');
                  setSearch('');
                }}
                className="text-rose-600 hover:underline text-[11px] font-semibold"
              >
                پاکسازی فیلترها
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Items Table */}
      <div className="bg-white border rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <RefreshCw className="animate-spin mx-auto text-blue-500" size={28} />
            <p className="text-xs">در حال بارگیری لیست اقلام نیازمند سفارش انبار...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <CheckCircle2 className="mx-auto text-emerald-500" size={36} />
            <p className="text-sm font-bold text-slate-700">هیچ کالایی بر اساس فیلترهای انتخابی در وضعیت آلارم قرار ندارد</p>
            <p className="text-xs text-slate-400">تمام اقلام انبار دارای موجودی بالا یا متناسب با آستانه تعیین‌شده می‌باشند.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b font-bold">
                <tr>
                  <th className="p-3.5 text-center">تصویر</th>
                  <th className="p-3.5">کد کالا</th>
                  <th className="p-3.5">نام کالا / عنوان</th>
                  <th className="p-3.5">دسته‌بندی</th>
                  <th className="p-3.5 text-center">نوع</th>
                  <th className="p-3.5 text-center">موجودی فعلی</th>
                  <th className="p-3.5 text-center">نقطه سفارش (آستانه)</th>
                  <th className="p-3.5 text-center">میزان کسری تامین</th>
                  <th className="p-3.5 text-center">میانگین بهای خرید</th>
                  <th className="p-3.5 text-center">برآورد هزینه کسری</th>
                  <th className="p-3.5 text-center print:hidden">عملیات تامین</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const stockPercent = item.reorder_point > 0 
                    ? Math.min(100, Math.round((item.current_stock / item.reorder_point) * 100)) 
                    : 0;

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/80 transition-colors ${item.is_zero_stock ? 'bg-rose-50/30' : ''}`}
                    >
                      {/* Image Thumbnail */}
                      <td className="p-3 text-center">
                        <div className="w-9 h-9 mx-auto rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                          {item.thumbnail || item.image ? (
                            <SafeImage src={item.thumbnail || item.image} alt={item.name} className="w-full h-full object-cover" fallbackIcon={<Package size={16} />} />
                          ) : (
                            <Package size={16} className="text-slate-400" />
                          )}
                        </div>
                      </td>

                      {/* Code */}
                      <td className="p-3 font-mono font-bold text-slate-800">{item.code}</td>

                      {/* Name */}
                      <td className="p-3 font-bold text-slate-900">
                        <div>{item.name}</div>
                        {item.unit && <span className="text-[10px] text-slate-400 font-normal">واحد: {item.unit}</span>}
                      </td>

                      {/* Category */}
                      <td className="p-3 text-slate-600">{item.category || '-'}</td>

                      {/* Type */}
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.type === 'product' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {item.type === 'product' ? 'محصول' : 'ماده اولیه'}
                        </span>
                      </td>

                      {/* Current Stock */}
                      <td className="p-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className={`font-mono font-extrabold text-sm ${item.is_zero_stock ? 'text-rose-600' : 'text-amber-600'}`}>
                            {formatPersianNumber(item.current_stock)} {item.unit}
                          </span>
                          <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
                            <div 
                              style={{ width: `${stockPercent}%` }}
                              className={`h-full rounded-full ${item.is_zero_stock ? 'bg-rose-600' : 'bg-amber-500'}`}
                            ></div>
                          </div>
                        </div>
                      </td>

                      {/* Reorder Point */}
                      <td className="p-3 text-center font-mono font-bold text-slate-700">
                        {formatPersianNumber(item.reorder_point)} {item.unit}
                      </td>

                      {/* Deficit */}
                      <td className="p-3 text-center">
                        <span className="px-2 py-1 rounded bg-rose-100 text-rose-800 font-mono font-extrabold text-xs">
                          {formatPersianNumber(item.deficit)} {item.unit}
                        </span>
                      </td>

                      {/* WAC Cost */}
                      <td className="p-3 text-center font-mono text-slate-600">
                        {item.weighted_average_cost ? formatPersianPrice(item.weighted_average_cost) : '-'}
                      </td>

                      {/* Total Deficit Value */}
                      <td className="p-3 text-center font-mono font-bold text-blue-700">
                        {item.deficit_value > 0 ? formatPersianPrice(item.deficit_value) : '-'}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center print:hidden">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => navigate('/receipts')}
                            title="ثبت ورود کالا به انبار"
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <PlusCircle size={12} />
                            ورود به انبار
                          </button>

                          <button
                            onClick={() => {
                              setEditingItem(item);
                              setNewReorderPoint(String(item.reorder_point));
                            }}
                            title="ویرایش نقطه سفارش این کالا"
                            className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-semibold transition-colors"
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

        {/* Footer info box for print or total review */}
        {filteredItems.length > 0 && (
          <div className="p-4 bg-slate-900 text-white flex flex-col md:flex-row justify-between items-center gap-3 text-xs">
            <div className="flex items-center gap-4">
              <span>خلاصه برآورد سفارش: <strong className="text-amber-300 font-mono">{formatPersianNumber(filteredItems.length)} قلم کالا</strong></span>
              <span>مجموع کل میزان کسری: <strong className="text-amber-300 font-mono">{formatPersianNumber(totalDeficitQuantity)} واحد</strong></span>
            </div>
            <div className="flex items-center gap-3">
              <span>ارزش کل تخمینی تامین کسری: <strong className="text-emerald-400 font-mono text-sm">{formatPersianPrice(totalDeficitCost)}</strong></span>
            </div>
          </div>
        )}
      </div>

      {/* Edit Reorder Point Modal */}
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
                  موجودی فعلی این کالا در انبار: <span className="font-bold text-slate-700">{formatPersianNumber(editingItem.current_stock)} {editingItem.unit}</span> می باشد.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-slate-50"
                  disabled={savingEdit}
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors flex items-center gap-1.5"
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
