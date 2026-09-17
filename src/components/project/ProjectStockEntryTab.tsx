import { useState, useEffect, useMemo, useCallback } from 'react';
import { Package, CheckCircle2, RefreshCw, AlertCircle, CheckSquare, Boxes, Square, Search, DollarSign, Warehouse, ArrowDownRight, Tag, Lock } from 'lucide-react';
import { ProductionProject, ProjectProductItem, Item } from '../../types';
import { fetchJson } from '../../api';
import { useWarehousesQuery } from '../../hooks/queries/useSettingsQueries';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../../utils';

interface ProjectStockEntryTabProps {
  project: ProductionProject;
  itemsList?: Item[];
  onUpdate: () => void;
}

export default function ProjectStockEntryTab({ project, itemsList = [], onUpdate }: ProjectStockEntryTabProps) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);
  const [markCompleted, setMarkCompleted] = useState<boolean>(false);
  const { data: warehouses = [] } = useWarehousesQuery();
  const [targetLocation, setTargetLocation] = useState<string>('');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // بررسی شرط ماتریس پیشرفت فیزیکی محصولات برای امکان تکمیل پروژه
  const isAlreadyCompleted = project.status === 'completed';
  const [matrixStatus, setMatrixStatus] = useState<{
    loading: boolean;
    allMatrixCompleted: boolean;
    totalMatrixCells: number;
    completedMatrixCells: number;
    missingMatrixCells: number;
  }>({
    loading: true,
    allMatrixCompleted: false,
    totalMatrixCells: 0,
    completedMatrixCells: 0,
    missingMatrixCells: 0
  });

  const checkProgressMatrix = useCallback(async () => {
    try {
      setMatrixStatus(prev => ({ ...prev, loading: true }));
      const res = await fetchJson(`/projects/${project.id}/product-progress`);
      const payload = res?.data ?? res;
      if (payload && payload.summary) {
        const total = Number(payload.summary.total_matrix_cells) || 0;
        const comp = Number(payload.summary.completed_matrix_cells) || 0;
        const allDone = Boolean(payload.summary.all_matrix_completed);
        setMatrixStatus({
          loading: false,
          allMatrixCompleted: allDone,
          totalMatrixCells: total,
          completedMatrixCells: comp,
          missingMatrixCells: Math.max(0, total - comp)
        });
        if (!allDone && markCompleted) {
          setMarkCompleted(false);
        }
      } else {
        setMatrixStatus({
          loading: false,
          allMatrixCompleted: false,
          totalMatrixCells: 0,
          completedMatrixCells: 0,
          missingMatrixCells: 0
        });
      }
    } catch {
      setMatrixStatus(prev => ({ ...prev, loading: false }));
    }
  }, [project.id, markCompleted]);

  useEffect(() => {
    checkProgressMatrix();
  }, [checkProgressMatrix, project.progress_percent, project.status, project.updated_at, project.updatedAt]);

  useEffect(() => {
    if (!targetLocation && warehouses.length > 0) {
      setTargetLocation(warehouses[0].code);
    }
  }, [warehouses, targetLocation]);

  // Map of itemId to catalog Item for looking up WAC and cost basis
  const catalogMap = useMemo(() => {
    const map = new Map<number, Item>();
    itemsList.forEach(item => {
      if (item.id) map.set(item.id, item);
    });
    return map;
  }, [itemsList]);

  // V3.1.0: fallback فقط با کالای واقعی پروژه — بدون محصول جعلی
  const products: ProjectProductItem[] = useMemo(() => {
    return Array.isArray(project.products) && project.products.length > 0
      ? project.products
      : project.item_id ? [{
          id: 'prod-main',
          item_id: project.item_id,
          item_code: project.item_code || '',
          item_name: project.item_name || '',
          customer_code: '',
          quantity: project.quantity || 100,
          unit: project.unit || 'عدد',
          needs_assembly: true
        }] : [];
  }, [project]);

  // Initial produced quantities & optional unit cost overrides
  const [producedQuantities, setProducedQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    products.forEach(p => {
      init[p.id] = p.quantity || 100;
    });
    return init;
  });

  const [unitCosts, setUnitCosts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    products.forEach(p => {
      const itmId = p.item_id || project.item_id;
      if (itmId && catalogMap.has(Number(itmId))) {
        const catItem = catalogMap.get(Number(itmId));
        const wac = Number(catItem?.weightedAverageCost || catItem?.costPrice || 0);
        if (wac > 0) init[p.id] = wac;
      }
    });
    return init;
  });

  // Keep unit costs populated if catalogMap loads after initial render
  useEffect(() => {
    if (catalogMap.size > 0) {
      setUnitCosts(prev => {
        const next = { ...prev };
        let changed = false;
        products.forEach(p => {
          if (next[p.id] === undefined) {
            const itmId = p.item_id || project.item_id;
            if (itmId && catalogMap.has(Number(itmId))) {
              const catItem = catalogMap.get(Number(itmId));
              const wac = Number(catItem?.weightedAverageCost || catItem?.costPrice || 0);
              if (wac > 0) {
                next[p.id] = wac;
                changed = true;
              }
            }
          }
        });
        return changed ? next : prev;
      });
    }
  }, [catalogMap, products, project.item_id]);

  const handleQtyChange = (prodId: string, val: number) => {
    setProducedQuantities(prev => ({ ...prev, [prodId]: val }));
  };

  const handleCostChange = (prodId: string, val: number) => {
    setUnitCosts(prev => ({ ...prev, [prodId]: val }));
  };

  // Filtered products based on search query
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => 
      (p.item_name && p.item_name.toLowerCase().includes(q)) ||
      (p.item_code && p.item_code.toLowerCase().includes(q)) ||
      (p.customer_code && p.customer_code.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  // Selection handlers for batch delivery
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectable = filteredProducts.filter(p => Boolean(p.item_id || project.item_id));
    if (selectedIds.size >= selectable.length && selectable.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map(p => p.id)));
    }
  };

  // Single Item Delivery
  const handleAddToInventory = async (product: ProjectProductItem) => {
    const itemId = product.item_id || project.item_id;
    if (!itemId) {
      toast.error('کد کالا برای این محصول در انبار مشخص نشده است');
      return;
    }

    const qty = producedQuantities[product.id] || product.quantity || 1;
    if (qty <= 0) {
      toast.error('مقدار تحویل باید بزرگتر از صفر باشد');
      return;
    }

    const cost = unitCosts[product.id];

    if (markCompleted && !matrixStatus.allMatrixCompleted && !isAlreadyCompleted) {
      toast.error(`تنها زمانی می‌توانید تیک تغییر وضعیت به تکمیل‌شده را بزنید که در بخش «پیشرفت به تفکیک کد کالا»، تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات تیک خورده باشند. (${toPersianDigits(matrixStatus.completedMatrixCells)} از ${toPersianDigits(matrixStatus.totalMatrixCells)} مورد تکمیل شده است)`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetchJson(`/projects/${project.id}/add-to-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsToAdd: [
            {
              itemId: Number(itemId),
              quantity: Number(qty),
              location: targetLocation,
              unitPrice: cost && cost > 0 ? Number(cost) : undefined,
              notes: `ورود مستقیم از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${product.item_name}`
            }
          ],
          markCompleted
        })
      });

      if (res && (res.success || res.addedCount !== undefined || res.message)) {
        toast.success(`تعداد ${toPersianDigits(qty)} ${product.unit} «${product.item_name}» به انبار تحویل داده شد`);
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ثبت ورود به انبار');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    } finally {
      setSubmitting(false);
    }
  };

  // Batch Delivery for selected items or all valid items
  const handleBatchAddToInventory = async (targetProducts: ProjectProductItem[]) => {
    const validItems = targetProducts
      .map(p => {
        const itemId = p.item_id || project.item_id;
        const qty = producedQuantities[p.id] || p.quantity || 1;
        const cost = unitCosts[p.id];
        return {
          itemId: Number(itemId),
          quantity: Number(qty),
          location: targetLocation,
          unitPrice: cost && cost > 0 ? Number(cost) : undefined,
          notes: `ورود دسته‌ای از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${p.item_name}`,
          name: p.item_name,
          unit: p.unit
        };
      })
      .filter(entry => Boolean(entry.itemId) && !isNaN(entry.itemId) && entry.quantity > 0);

    if (validItems.length === 0) {
      toast.error('هیچ محصول معتبر و قابل تحویلی انتخاب نشده است');
      return;
    }

    if (markCompleted && !matrixStatus.allMatrixCompleted && !isAlreadyCompleted) {
      toast.error(`تنها زمانی می‌توانید تیک تغییر وضعیت به تکمیل‌شده را بزنید که در بخش «پیشرفت به تفکیک کد کالا»، تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات تیک خورده باشند. (${toPersianDigits(matrixStatus.completedMatrixCells)} از ${toPersianDigits(matrixStatus.totalMatrixCells)} مورد تکمیل شده است)`);
      return;
    }

    setBatchSubmitting(true);
    try {
      const res = await fetchJson(`/projects/${project.id}/add-to-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsToAdd: validItems.map(({ itemId, quantity, location, notes, unitPrice }) => ({
            itemId,
            quantity,
            location,
            notes,
            unitPrice
          })),
          markCompleted
        })
      });

      if (res && (res.success || res.addedCount !== undefined || res.message)) {
        toast.success(`تعداد ${toPersianDigits(res.addedCount || validItems.length)} قلم محصول با موفقیت به انبار تحویل داده شدند`);
        setSelectedIds(new Set());
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ثبت دسته‌ای محصولات به انبار');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    } finally {
      setBatchSubmitting(false);
    }
  };

  // Summary Metrics

  const totalDeliveredQty = useMemo(() => {
    return products.reduce((sum, p) => sum + (Number(producedQuantities[p.id]) || Number(p.quantity) || 0), 0);
  }, [products, producedQuantities]);

  const selectedProducts = useMemo(() => {
    return products.filter(p => selectedIds.has(p.id));
  }, [products, selectedIds]);

  return (
    <div className="space-y-4 text-xs animate-fadeIn">
      {/* Top Banner & Settings */}
      <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center justify-center shrink-0 shadow-2xs">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 text-sm">تحویل نهایی محصولات تولیدی به انبار</h4>
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-300">
                  اتصال خودکار به کاردکس و بهای تمام‌شده
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                پس از اتمام تولید، محصولات را مستقیماً وارد موجودی انبار مقصد کنید. میانگین موزون بهای تمام‌شده و سوابق کاردکس به شکل خودکار ثبت می‌شوند.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Warehouse Select */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              <Warehouse className="w-4 h-4 text-slate-500" />
              <label className="font-bold text-slate-700 text-xs whitespace-nowrap">انبار مقصد:</label>
              {warehouses.length === 0 ? (
                <span className="text-xs text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-lg border border-rose-200">
                  تعریف نشده
                </span>
              ) : (
                <select
                  value={targetLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                  className="bg-transparent font-bold text-slate-900 text-xs focus:outline-none cursor-pointer"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.code}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Mark Completed Toggle - Strictly restricted to 100% matrix completion */}
            <div className="flex flex-col gap-1">
              <label 
                onClick={(e) => {
                  if (isAlreadyCompleted) return;
                  if (!matrixStatus.allMatrixCompleted) {
                    e.preventDefault();
                    toast.error(
                      `تنها زمانی می‌توانید تیک تغییر وضعیت به تکمیل‌شده را بزنید که در بخش «پیشرفت به تفکیک کد کالا»، تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات تیک خورده باشند. (${toPersianDigits(matrixStatus.completedMatrixCells)} از ${toPersianDigits(matrixStatus.totalMatrixCells)} گزینه تیک خورده است)`,
                      { id: 'progress-matrix-incomplete', duration: 4500 }
                    );
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all select-none ${
                  isAlreadyCompleted
                    ? 'bg-emerald-50 border-emerald-200 cursor-default text-emerald-800'
                    : matrixStatus.allMatrixCompleted
                    ? 'bg-amber-50/80 border-amber-200/80 cursor-pointer hover:bg-amber-100/70 text-slate-800'
                    : 'bg-slate-100 border-slate-200 cursor-not-allowed opacity-80 text-slate-500'
                }`}
                title={
                  isAlreadyCompleted
                    ? 'پروژه قبلاً در وضعیت تکمیل‌شده قرار گرفته است'
                    : matrixStatus.allMatrixCompleted
                    ? 'تمام گزینه‌های ماتریس پیشرفت تیک خورده‌اند و امکان تغییر وضعیت فعال است'
                    : `برای تغییر وضعیت، باید تمام ${toPersianDigits(matrixStatus.totalMatrixCells)} گزینه ماتریس پیشرفت فیزیکی محصولات در تب پیشرفت به تفکیک کد کالا تیک خورده باشند`
                }
              >
                <input
                  type="checkbox"
                  disabled={!matrixStatus.allMatrixCompleted || isAlreadyCompleted}
                  checked={isAlreadyCompleted || markCompleted}
                  onChange={(e) => {
                    if (isAlreadyCompleted) return;
                    if (!matrixStatus.allMatrixCompleted) {
                      setMarkCompleted(false);
                      return;
                    }
                    setMarkCompleted(e.target.checked);
                  }}
                  className={`w-4 h-4 rounded border-slate-300 ${
                    matrixStatus.allMatrixCompleted && !isAlreadyCompleted
                      ? 'text-amber-600 focus:ring-amber-500 cursor-pointer'
                      : 'text-slate-400 cursor-not-allowed'
                  }`}
                />
                <span className="font-bold text-[11px] flex items-center gap-1.5">
                  {!matrixStatus.allMatrixCompleted && !isAlreadyCompleted && (
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  {matrixStatus.allMatrixCompleted && !isAlreadyCompleted && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  تغییر وضعیت پروژه به تکمیل‌شده
                </span>
              </label>

              {/* Status Hint */}
              {!isAlreadyCompleted && (
                <div className="text-[10px] px-1 flex items-center gap-1">
                  {matrixStatus.loading ? (
                    <span className="text-slate-400">در حال بررسی ماتریس پیشرفت فیزیکی...</span>
                  ) : matrixStatus.allMatrixCompleted ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      ✓ تمام گزینه‌های ماتریس تیک خورده‌اند ({toPersianDigits(matrixStatus.totalMatrixCells)} از {toPersianDigits(matrixStatus.totalMatrixCells)})
                    </span>
                  ) : (
                    <span className="text-amber-800 font-medium flex items-center gap-1">
                      <span>🔒 قفل:</span>
                      <span>{toPersianDigits(matrixStatus.completedMatrixCells)} از {toPersianDigits(matrixStatus.totalMatrixCells)} مرحله تیک خورده</span>
                      <span className="text-slate-500">({toPersianDigits(matrixStatus.missingMatrixCells)} گزینه مانده)</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats & Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-4 text-slate-600 text-xs">
            <span className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span>تعداد کل محصولات:</span>
              <strong className="font-mono text-slate-900">{toPersianDigits(products.length)} قلم</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5 text-slate-400" />
              <span>مجموع تیراژ تحویلی:</span>
              <strong className="font-mono text-amber-900 font-bold">{toPersianDigits(totalDeliveredQty)} واحد</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 ? (
              <button
                type="button"
                onClick={() => handleBatchAddToInventory(selectedProducts)}
                disabled={batchSubmitting || submitting}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {batchSubmitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>تحویل {toPersianDigits(selectedIds.size)} کالای انتخاب‌شده به انبار</span>
              </button>
            ) : (
              products.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleBatchAddToInventory(products)}
                  disabled={batchSubmitting || submitting}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                  title="تحویل تمامی محصولات این پروژه به انبار با یک کلیک"
                >
                  {batchSubmitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Boxes className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span>تحویل گروهی کلیه محصولات</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3 flex-1 min-w-[240px] max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در محصولات (نام، کد انبار یا کد مشتری)..."
              className="w-full pl-3 pr-9 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-400 focus:bg-white focus:outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {selectedIds.size > 0 && selectedIds.size >= filteredProducts.length ? (
              <CheckSquare className="w-4 h-4 text-amber-600" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>انتخاب همه ({toPersianDigits(filteredProducts.length)})</span>
          </button>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-500 hover:text-slate-800 font-bold text-[11px] px-2 cursor-pointer"
            >
              لغو انتخاب ({toPersianDigits(selectedIds.size)})
            </button>
          )}
        </div>
      </div>

      {/* Products List */}
      <div className="space-y-2.5">
        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
            هیچ محصولی با معیارهای جستجوی فعلی یافت نشد.
          </div>
        ) : (
          filteredProducts.map((p, idx) => {
            const isSelected = selectedIds.has(p.id);
            const itemId = p.item_id || project.item_id;
            const hasCatalogLink = Boolean(itemId);
            const catItem = itemId ? catalogMap.get(Number(itemId)) : null;
            const defaultWac = catItem?.weightedAverageCost || catItem?.costPrice || 0;
            const enteredCost = unitCosts[p.id];
            const currentStockInLoc = catItem?.stocks && targetLocation ? (catItem.stocks as Record<string, number>)[targetLocation] || 0 : catItem?.currentStock || 0;

            return (
              <div
                key={p.id || idx}
                className={`bg-white p-3.5 rounded-2xl border transition-all shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                  isSelected ? 'border-amber-400 bg-amber-50/20' : 'border-slate-200/90 hover:border-slate-300'
                }`}
              >
                {/* Product Info */}
                <div className="flex items-center gap-3 min-w-[260px]">
                  <button
                    type="button"
                    onClick={() => toggleSelect(p.id)}
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300" />
                    )}
                  </button>

                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900 text-xs">{p.item_name}</p>
                      {p.customer_code && (
                        <span className="text-[10px] font-mono text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 font-bold" title="کد مشتری">
                          {p.customer_code}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                      {hasCatalogLink ? (
                        <span className="flex items-center gap-1">
                          کد انبار: <strong className="font-mono text-slate-700">{p.item_code || catItem?.code}</strong>
                        </span>
                      ) : (
                        <span className="text-rose-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> فاقد اتصال انبار
                        </span>
                      )}
                      <span>
                        • موجودی فعلی در انبار {targetLocation}: <strong className="font-mono text-slate-800">{toPersianDigits(currentStockInLoc)} {p.unit || 'عدد'}</strong>
                      </span>
                      <span>
                        • سفارش کل: <strong className="font-mono text-slate-700">{toPersianDigits(p.quantity)} {p.unit || 'عدد'}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Entry Inputs: Quantity & Unit Cost Basis */}
                <div className="flex flex-wrap items-center gap-3 self-end lg:self-center">
                  {/* Delivered Quantity */}
                  <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
                    <span className="text-slate-600 font-semibold text-[11px]">تعداد تحویلی:</span>
                    <input
                      type="number"
                      min="1"
                      value={producedQuantities[p.id] ?? p.quantity}
                      onChange={(e) => handleQtyChange(p.id, Number(e.target.value) || 0)}
                      className="w-20 px-1.5 py-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none"
                    />
                    <span className="text-slate-500 font-semibold text-[11px]">{p.unit || 'عدد'}</span>
                  </div>

                  {/* Unit Cost Basis (Optional WAC Override) */}
                  <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200" title="بهای تمام‌شده هر واحد جهت محاسبه مجدد میانگین موزون در انبار">
                    <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-600 font-semibold text-[11px]">بهای واحد:</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder={defaultWac > 0 ? String(defaultWac) : 'میانگین جاری'}
                      value={enteredCost !== undefined && enteredCost > 0 ? enteredCost : ''}
                      onChange={(e) => handleCostChange(p.id, Number(e.target.value) || 0)}
                      className="w-24 px-1.5 py-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none placeholder:text-slate-400"
                    />
                    <span className="text-slate-400 text-[10px]">ریال</span>
                  </div>

                  {/* Single Delivery Button */}
                  <button
                    type="button"
                    onClick={() => handleAddToInventory(p)}
                    disabled={submitting || batchSubmitting}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 transition-all shadow-2xs hover:shadow disabled:opacity-50 shrink-0 cursor-pointer"
                  >
                    {submitting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5" />
                    )}
                    <span>ورود به انبار</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

