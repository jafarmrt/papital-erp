import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  RefreshCw, Layers, Package, CheckCircle2, Circle, Clock, Ban, 
  Save, Info, Search, CheckSquare, Square, Filter, ChevronRight,
  RotateCcw, Sparkles
} from 'lucide-react';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../../utils';

// V3.1.5 — تب «پیشرفت به تفکیک کد کالا» (ماتریسی SKU × مرحله + فیلتر، انتخاب ردیف و عملیات دسته‌ای)
// مدل: هر ردیف = یک SKU (کد کالا × کمیت)؛ وضعیت هر مرحله دودویی (تمام/ناتمام)؛
// پیشرفت کل پروژه = تجمیع وزن‌دار (Σ sku%×qty / Σ qty)

interface StageMeta { stage_order: number; title: string; status?: string }
interface ProductProgressRow {
  stage_order: number;
  stage_title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  updated_at: string;
  updated_by_name: string;
}
interface ProductProgressRowData {
  item_id: number | null;
  item_code: string;
  item_name: string;
  customer_code?: string;
  quantity: number;
  unit: string;
  applicable_stage_orders: number[];
  excluded_stage_orders: number[];
  progress: ProductProgressRow[];
  completed_count: number;
  applicable_count: number;
  progress_percent: number;
}
interface ProductProgressResponse {
  stages: StageMeta[];
  products: ProductProgressRowData[];
  summary: {
    total_skus: number;
    total_quantity: number;
    weighted_progress_percent: number;
    fully_completed_skus: number;
    per_stage_counts: Array<{ stage_order: number; title: string; completed_count: number; applicable_skus: number }>;
  };
}

const STATUS_LABELS: Record<ProductProgressRow['status'], string> = {
  pending: 'ناتمام',
  in_progress: 'در جریان',
  completed: 'تمام',
  blocked: 'متوقف'
};

export default function ProjectProductProgressTab({ projectId, onUpdate }: { projectId: number; onUpdate?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ProductProgressResponse | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProgress, setFilterProgress] = useState<'all' | 'incomplete' | 'completed'>('all');

  // Selected SKU item_ids for batch operations
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<number>>(new Set());

  // pending local edits: key `${itemId}|${stageOrder}` → newStatus
  const [dirty, setDirty] = useState<Map<string, ProductProgressRow['status']>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchJson(`/projects/${projectId}/product-progress`);
      const payload = res?.data ?? res;
      if (payload && Array.isArray(payload.products)) {
        setData(payload);
      } else {
        toast.error('ساختار پاسخ پیشرفت نامعتبر است');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error(err?.message || 'خطا در دریافت پیشرفت تفکیکی کد کالا');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const stages = data?.stages || [];
  const products = useMemo(() => (Array.isArray(data?.products) ? data!.products : []), [data]);

  // گروه‌بندی ستون‌ها: مراحل پایه (همه SKUها) اول، مراحل اختیاری (زیرمجموعه SKUها) بعد از آن
  const { baseStages, optionalStages } = useMemo(() => {
    const applicableEverywhere = stages.filter(s => products.length > 0 && products.every(p => p.applicable_stage_orders.includes(s.stage_order)));
    const optional = stages.filter(s => !applicableEverywhere.includes(s));
    return { baseStages: applicableEverywhere, optionalStages: optional };
  }, [stages, products]);

  const resolveStatus = (p: ProductProgressRowData, order: number): ProductProgressRow['status'] => {
    const key = `${p.item_id}|${order}`;
    if (dirty.has(key)) return dirty.get(key)!;
    const row = p.progress.find(pr => pr.stage_order === order);
    return row?.status || 'pending';
  };

  const toggleStatus = (p: ProductProgressRowData, order: number) => {
    const key = `${p.item_id}|${order}`;
    const current = resolveStatus(p, order);
    const next: ProductProgressRow['status'] = current === 'completed' ? 'pending' : 'completed';
    setDirty(prev => {
      const m = new Map(prev);
      m.set(key, next);
      return m;
    });
  };

  const progressPercent = (p: ProductProgressRowData): number => {
    const applicable = p.applicable_stage_orders;
    if (applicable.length === 0) return 0;
    const done = applicable.filter(o => resolveStatus(p, o) === 'completed').length;
    return Math.round((done / applicable.length) * 100);
  };

  // Filtered products based on search and progress status
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query || 
        (p.item_name && p.item_name.toLowerCase().includes(query)) ||
        (p.item_code && p.item_code.toLowerCase().includes(query)) ||
        (p.customer_code && p.customer_code.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      const pct = progressPercent(p);
      if (filterProgress === 'completed') return pct === 100;
      if (filterProgress === 'incomplete') return pct < 100;
      return true;
    });
  }, [products, searchQuery, filterProgress, dirty]);

  // Selection handlers
  const toggleSelectSku = (itemId: number | null) => {
    if (!itemId) return;
    setSelectedSkuIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleSelectAllSkus = () => {
    const selectable = filteredProducts.filter(p => p.item_id !== null).map(p => p.item_id as number);
    if (selectedSkuIds.size >= selectable.length && selectable.length > 0) {
      setSelectedSkuIds(new Set());
    } else {
      setSelectedSkuIds(new Set(selectable));
    }
  };

  // Bulk operation: Set all stages for selected SKUs
  const setAllStagesForSelectedSkus = (status: ProductProgressRow['status']) => {
    if (selectedSkuIds.size === 0) return;
    setDirty(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.item_id && selectedSkuIds.has(p.item_id)) {
          for (const order of p.applicable_stage_orders) {
            m.set(`${p.item_id}|${order}`, status);
          }
        }
      }
      return m;
    });
    toast.success(`وضعیت تمام مراحل برای ${toPersianDigits(selectedSkuIds.size)} محصول تغییر یافت`);
  };

  // Bulk operation: Set specific stage for all applicable SKUs
  const setStageForAllSkus = (order: number, status: ProductProgressRow['status']) => {
    setDirty(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.applicable_stage_orders.includes(order)) {
          m.set(`${p.item_id}|${order}`, status);
        }
      }
      return m;
    });
    toast.success(`وضعیت مرحله برای تمام کالاها به روز شد`);
  };

  // Bulk operation: Complete a specific stage for selected SKUs only
  const setStageForSelectedSkus = (order: number, status: ProductProgressRow['status']) => {
    if (selectedSkuIds.size === 0) return;
    setDirty(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.item_id && selectedSkuIds.has(p.item_id) && p.applicable_stage_orders.includes(order)) {
          m.set(`${p.item_id}|${order}`, status);
        }
      }
      return m;
    });
  };

  // Reset unsaved changes
  const resetDirty = () => {
    setDirty(new Map());
    toast('تغییرات ثبت‌نشده لغو شدند', { icon: '↩️' });
  };

  const hasChanges = dirty.size > 0;

  const saveChanges = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      const items = Array.from(dirty.entries()).map(([key, status]) => {
        const [itemId, order] = key.split('|');
        return { item_id: Number(itemId), stage_order: Number(order), status };
      });
      const res = await fetchJson(`/projects/${projectId}/product-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (res?.success) {
        toast.success(`${toPersianDigits(res.applied)} تغییر وضعیت ثبت شد`);
        setDirty(new Map());
        load();
        onUpdate?.();
      } else {
        toast.error(res?.error || 'خطا در ثبت تغییرات');
      }
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت تغییرات');
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <span>در حال محاسبه پیشرفت تفکیکی کد کالاها...</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2 text-center">
        <Package className="w-8 h-8 text-slate-300" />
        <p className="font-bold text-slate-600">هیچ کد کالایی (SKU) به این پروژه پیوند خورده است</p>
        <p className="text-[11px]">در فرم ویرایش پروژه، ردیف‌های «کد کالا» را با کالای انبار و تیراژ هدف تعریف کنید تا پیشرفت تفکیکی فعال شود.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs animate-fadeIn">
      {/* Summary Band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
          <span className="text-[10px] text-amber-700 font-bold block mb-1">پیشرفت وزن‌دار کل پروژه</span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${summary?.weighted_progress_percent || 0}%` }} />
            </div>
            <span className="font-mono font-bold text-amber-800 text-sm">{toPersianDigits(summary?.weighted_progress_percent || 0)}٪</span>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <span className="text-[10px] text-slate-500 font-bold block mb-1">تعداد کد کالا (SKU):</span>
          <p className="font-bold font-mono text-slate-900 text-sm">{toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
          <span className="text-[10px] text-emerald-700 font-bold block mb-1">SKUهای تکمیل‌شده (همه مراحل):</span>
          <p className="font-bold font-mono text-emerald-800 text-sm">{toPersianDigits(summary?.fully_completed_skus || 0)} از {toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
          <span className="text-[10px] text-blue-700 font-bold block mb-1">تیراژ کل سفارش:</span>
          <p className="font-bold font-mono text-blue-800 text-sm">{toPersianDigits(summary?.total_quantity || 0)}</p>
        </div>
      </div>

      {/* Per-stage rollup strip */}
      {stages.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-slate-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              وضعیت هر مرحله در کل SKUها
            </h4>
            <span className="text-[10px] text-slate-400">تعداد SKU تکمیل‌شده در هر مرحله / کل SKUهای مرتبط</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {stages.map(s => {
              const stat = summary?.per_stage_counts.find(pc => pc.stage_order === s.stage_order);
              const applicable = stat?.applicable_skus || 0;
              const done = stat?.completed_count || 0;
              const pct = applicable > 0 ? Math.round((done / applicable) * 100) : 0;
              return (
                <div key={s.stage_order} className="bg-slate-50 rounded-xl border border-slate-100 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-700 truncate" title={s.title}>{s.title}</span>
                    <span className="font-mono text-[10px] font-bold text-slate-500">{toPersianDigits(pct)}٪</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400">
                    <button
                      onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                      className="text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
                      title="تمام کردن این مرحله برای همه SKUهای اعمال‌شده"
                    >
                      تمام همه
                    </button>
                    <span>{toPersianDigits(done)}/{toPersianDigits(applicable)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SKU × Stage Matrix */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        {/* Controls and Batch Operations Bar */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold border border-amber-300 shadow-2xs shrink-0">
                <Package className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">
                  ماتریس پیشرفت فیزیکی محصولات (مرحله × SKU)
                </h4>
                <p className="text-[10px] text-slate-500">
                  کنترل و تیک‌زدن همزمان وضعیت تکمیل مراحل، فیلتر سریع و عملیات گروهی
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <button
                  type="button"
                  onClick={resetDirty}
                  disabled={saving}
                  className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                  title="لغو تمام تغییرات اعمال‌نشده"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>انصراف</span>
                </button>
              )}

              {hasChanges && (
                <button
                  type="button"
                  onClick={saveChanges}
                  disabled={saving}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs animate-pulse"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'در حال ثبت...' : `ثبت ${toPersianDigits(dirty.size)} تغییر در سامانه`}</span>
                </button>
              )}
            </div>
          </div>

          {/* Search, Filter & Quick Batch Selection */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70">
            <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="جستجو در نام، کد کالا یا کد مشتری..."
                  className="w-full pl-3 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none placeholder:text-slate-400"
                />
              </div>

              {/* Progress Filter Pills */}
              <div className="flex items-center bg-slate-200/80 p-0.5 rounded-xl text-[10px] font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setFilterProgress('all')}
                  className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                    filterProgress === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  همه ({toPersianDigits(products.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterProgress('incomplete')}
                  className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                    filterProgress === 'incomplete' ? 'bg-white text-amber-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ناتمام ({toPersianDigits(products.filter(p => progressPercent(p) < 100).length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterProgress('completed')}
                  className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                    filterProgress === 'completed' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  تکمیل ({toPersianDigits(products.filter(p => progressPercent(p) === 100).length)})
                </button>
              </div>
            </div>

            {/* Batch Action Toolbar when rows are selected */}
            {selectedSkuIds.size > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-100/80 border border-amber-300/80 px-2.5 py-1 rounded-xl text-[11px] animate-fadeIn">
                <span className="font-bold text-amber-950">
                  {toPersianDigits(selectedSkuIds.size)} ردیف انتخاب شده:
                </span>
                <button
                  type="button"
                  onClick={() => setAllStagesForSelectedSkus('completed')}
                  className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  تمام کردن کلیه مراحل
                </button>
                <button
                  type="button"
                  onClick={() => setAllStagesForSelectedSkus('pending')}
                  className="px-2 py-0.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Circle className="w-3 h-3" />
                  ریست به ناتمام
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSkuIds(new Set())}
                  className="text-slate-600 hover:text-slate-900 text-[10px] font-bold px-1.5 cursor-pointer"
                >
                  لغو انتخاب
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-700 font-bold">
                <th className="p-2 text-center w-8">
                  <button
                    type="button"
                    onClick={toggleSelectAllSkus}
                    className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                    title="انتخاب همه ردیف‌های جدول"
                  >
                    {selectedSkuIds.size > 0 && selectedSkuIds.size >= filteredProducts.length ? (
                      <CheckSquare className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="p-2.5 sticky right-0 bg-slate-100/90 z-10 border-l border-slate-200">کد محصول</th>
                <th className="p-2.5">نام محصول</th>
                <th className="p-2.5 text-center">تیراژ</th>
                {baseStages.map(s => (
                  <th key={`b-${s.stage_order}`} className="p-1.5 text-center min-w-[70px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400 font-mono">{toPersianDigits(s.stage_order)}</span>
                      <span className="truncate max-w-[80px]" title={s.title}>{s.title}</span>
                      <button
                        type="button"
                        onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                        className="text-[9px] text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
                        title={`تکمیل مرحله «${s.title}» برای همه کالاها`}
                      >
                        ✓ همه
                      </button>
                    </div>
                  </th>
                ))}
                {optionalStages.map(s => (
                  <th key={`o-${s.stage_order}`} className="p-1.5 text-center min-w-[70px] bg-amber-50/50">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-amber-600 font-mono">{toPersianDigits(s.stage_order)} ◇</span>
                      <span className="truncate max-w-[80px] text-amber-800" title={`${s.title} (اختیاری — برای برخی SKUها)`}>{s.title}</span>
                      <button
                        type="button"
                        onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                        className="text-[9px] text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
                        title={`تکمیل مرحله اختیاری «${s.title}» برای همه کالاها`}
                      >
                        ✓ همه
                      </button>
                    </div>
                  </th>
                ))}
                <th className="p-2.5 text-center">پیشرفت SKU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={4 + baseStages.length + optionalStages.length + 1} className="py-8 text-center text-slate-400">
                    هیچ محصولی با فیلتر جستجوی فعلی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p, idx) => {
                  const pct = progressPercent(p);
                  const isSelected = p.item_id ? selectedSkuIds.has(p.item_id) : false;
                  return (
                    <tr 
                      key={`${p.item_id}-${idx}`} 
                      className={`transition-colors ${
                        isSelected 
                          ? 'bg-amber-100/40' 
                          : pct === 100 
                          ? 'bg-emerald-50/20 hover:bg-emerald-50/40' 
                          : 'hover:bg-amber-50/30'
                      }`}
                    >
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectSku(p.item_id)}
                          className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>
                      </td>
                      <td className="p-2.5 font-mono font-bold text-amber-900 sticky right-0 bg-white/95 z-10 border-l border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span>{p.item_code || <span className="text-red-600 font-bold">بدون کد!</span>}</span>
                          {p.customer_code && (
                            <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1 py-0.2 rounded border border-slate-200" title="کد مشتری">
                              {p.customer_code}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5 font-bold text-slate-900 max-w-[140px] truncate" title={p.item_name}>
                        {p.item_name || '—'}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-slate-700 whitespace-nowrap">
                        {toPersianDigits(p.quantity)} {p.unit || 'عدد'}
                      </td>
                      {baseStages.map(s => {
                        const applicable = p.applicable_stage_orders.includes(s.stage_order);
                        const st = applicable ? resolveStatus(p, s.stage_order) : null;
                        const isDirty = dirty.has(`${p.item_id}|${s.stage_order}`);
                        return (
                          <td key={`c-${s.stage_order}`} className={`p-1 text-center ${isDirty ? 'bg-blue-100/50' : ''}`}>
                            {applicable ? (
                              <button
                                onClick={() => toggleStatus(p, s.stage_order)}
                                className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                                  st === 'completed'
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                                    : st === 'in_progress'
                                    ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                    : st === 'blocked'
                                    ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                                    : 'bg-slate-100 text-slate-300 border border-slate-200 hover:bg-slate-200'
                                }`}
                                title={`${s.title} — ${st ? STATUS_LABELS[st] : ''} (کلیک: تغییر تمام/ناتمام)`}
                              >
                                {st === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : st === 'in_progress' ? <Clock className="w-4 h-4" /> : st === 'blocked' ? <Ban className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                              </button>
                            ) : (
                              <span className="text-slate-200">—</span>
                            )}
                          </td>
                        );
                      })}
                      {optionalStages.map(s => {
                        const applicable = p.applicable_stage_orders.includes(s.stage_order);
                        const st = applicable ? resolveStatus(p, s.stage_order) : null;
                        const isDirty = dirty.has(`${p.item_id}|${s.stage_order}`);
                        return (
                          <td key={`oc-${s.stage_order}`} className={`p-1 text-center bg-amber-50/30 ${isDirty ? 'bg-blue-100/50' : ''}`}>
                            {applicable ? (
                              <button
                                onClick={() => toggleStatus(p, s.stage_order)}
                                className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                                  st === 'completed'
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                                    : st === 'in_progress'
                                    ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                    : st === 'blocked'
                                    ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                                    : 'bg-slate-100 text-slate-300 border border-slate-200 hover:bg-slate-200'
                                }`}
                                title={`${s.title} (اختیاری) — ${st ? STATUS_LABELS[st] : ''}`}
                              >
                                {st === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : st === 'in_progress' ? <Clock className="w-4 h-4" /> : st === 'blocked' ? <Ban className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                              </button>
                            ) : (
                              <span className="text-slate-200">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono font-bold text-[10px] text-slate-700">{toPersianDigits(pct)}٪</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> تمام</span>
          <span className="flex items-center gap-1"><Circle className="w-3.5 h-3.5 text-slate-300" /> ناتمام</span>
          <span className="flex items-center gap-1"><Info className="w-3.5 h-3.5 text-blue-500" /> مراحل اختیاری با نشان ◇ — فقط برای SKUهایی که در فرم پروژه انتخاب کرده‌اند اعمال می‌شود</span>
        </div>
      </div>
    </div>
  );
}
