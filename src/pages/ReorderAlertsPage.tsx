import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { User } from '../types';
import { AlertTriangle, RefreshCw, Printer } from 'lucide-react';
import { formatPersianNumber, errorMessageOf } from '../utils';
import { useSearch } from '../SearchContext';
import MovementAnalysisSection from './reorder/MovementAnalysisSection';
import { ReorderPurchaseModal } from '../components/reorder/ReorderPurchaseModal';
import ProjectModal from '../components/ProjectModal';
import { ErrorStateView } from '../components/common/ErrorStateView';
import { ReorderFiltersBar } from '../components/reorder/ReorderFiltersBar';
import { ReorderItemsSection } from '../components/reorder/ReorderItemsSection';
import { ReorderStatsCards } from '../components/reorder/ReorderStatsCards';
import { ReorderPointEditModal } from '../components/reorder/ReorderPointEditModal';
import { MATERIALS_THEME, PRODUCTS_THEME } from '../components/reorder/reorderSectionThemes';
import { useReorderAlertsQuery } from '../hooks/reorderAlerts/useReorderAlertsQueries';
import { useUpdateReorderPoint, invalidateAfterProductionProjectCreated } from '../hooks/reorderAlerts/useReorderAlertsMutations';
import { useReorderSelection } from '../hooks/reorderAlerts/useReorderSelection';
import {
  filterReorderItems, reorderCategories, sumDeficitValue, toPurchaseModalItem, toProjectProduct,
  type ReorderItem, type ReorderModalItem, type ReorderProjectProduct, type StockStatusFilter
} from '../lib/reorderAlerts/reorderItems';

export type { ReorderItem } from '../lib/reorderAlerts/reorderItems';

/**
 * صفحه «نقطه سفارش»: داده با React Query (useReorderAlertsQuery) و ذخیره‌ها با useMutation؛
 * تغییر نقطه سفارش، درخواست خرید، سند خرید و پروژه تولید کش صفحات مرتبط (کالاها، داشبورد، تدارکات، ...) را باطل می‌کنند.
 */
export default function ReorderAlertsPage(_props: { user: User }) {
  const queryClient = useQueryClient();
  const { items, loading, error, reload } = useReorderAlertsQuery();
  const updateReorderPoint = useUpdateReorderPoint();

  // Filters
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Purchase Order Modal State (For raw materials)
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [purchaseModalItems, setPurchaseModalItems] = useState<ReorderModalItem[]>([]);

  // Production Project Modal State (For products)
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [projectModalProducts, setProjectModalProducts] = useState<ReorderProjectProduct[]>([]);
  const [projectModalTitle, setProjectModalTitle] = useState<string>('');

  // Quick Edit Reorder Point Modal State
  const [editingItem, setEditingItem] = useState<ReorderItem | null>(null);

  const categories = useMemo(() => reorderCategories(items), [items]);

  const filteredItems = useMemo(
    () => filterReorderItems(items, { stockStatusFilter, selectedCategory, search }),
    [items, stockStatusFilter, selectedCategory, search]
  );

  // Split into raw materials and products
  const rawMaterialItems = useMemo(() => filteredItems.filter(it => it.type === 'raw_material'), [filteredItems]);
  const productItems = useMemo(() => filteredItems.filter(it => it.type === 'product'), [filteredItems]);

  // Checkbox selections for batch actions
  const materialSelection = useReorderSelection(rawMaterialItems);
  const productSelection = useReorderSelection(productItems);

  // Stats
  const safeItemsForStats = Array.isArray(items) ? items : [];
  const totalAlarms = safeItemsForStats.length;
  const zeroStockCount = safeItemsForStats.filter(i => i.is_zero_stock).length;
  const productsCount = safeItemsForStats.filter(i => i.type === 'product').length;
  const materialsCount = safeItemsForStats.filter(i => i.type === 'raw_material').length;

  const totalDeficitCost = sumDeficitValue(filteredItems);
  const materialsDeficitCost = sumDeficitValue(rawMaterialItems);
  const productsDeficitCost = sumDeficitValue(productItems);

  // Purchase Order Actions (For raw materials)
  const handleOpenPurchaseOrderSingle = (item: ReorderItem) => {
    setPurchaseModalItems([toPurchaseModalItem(item)]);
    setIsPurchaseModalOpen(true);
  };

  const handleOpenPurchaseOrderBatch = () => {
    const selected = rawMaterialItems.filter(i => materialSelection.selectedIds.has(i.id));
    if (selected.length === 0) {
      toast.error('لطفاً حداقل یک قلم ماده اولیه را با تیک زدن انتخاب نمایید.');
      return;
    }
    setPurchaseModalItems(selected.map(toPurchaseModalItem));
    setIsPurchaseModalOpen(true);
  };

  // Production Project Actions (For products)
  const handleOpenProjectModalSingle = (item: ReorderItem) => {
    setProjectModalProducts([toProjectProduct(item)]);
    setProjectModalTitle(`تولید محصول ${item.name} (جبران کسری انبار)`);
    setIsProjectModalOpen(true);
  };

  const handleOpenProjectModalBatch = () => {
    const selected = productItems.filter(i => productSelection.selectedIds.has(i.id));
    if (selected.length === 0) {
      toast.error('لطفاً حداقل یک محصول را با تیک زدن انتخاب نمایید.');
      return;
    }
    setProjectModalProducts(selected.map(toProjectProduct));
    setProjectModalTitle(`تولید کسری محصولات انبار (${formatPersianNumber(selected.length)} قلم)`);
    setIsProjectModalOpen(true);
  };

  const handleUpdateReorderPoint = (value: string) => {
    if (!editingItem) return;

    const val = Number(value);
    if (isNaN(val) || val < 0) {
      toast.error('لطفاً عدد معتبری وارد نمایید.');
      return;
    }

    updateReorderPoint.mutate({ item: editingItem, reorderPoint: val }, {
      onSuccess: () => {
        setEditingItem(null);
        toast.success('نقطه سفارش با موفقیت بروزرسانی شد.');
      },
      onError: (err) => {
        toast.error(errorMessageOf(err) || 'خطا در بروزرسانی نقطه سفارش');
      },
    });
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
              onClick={reload}
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
          onRetry={reload}
          compact
          className="print:hidden"
        />
      )}

      {/* 1. Filters & Search Controls */}
      <ReorderFiltersBar
        search={search}
        onSearchChange={setSearch}
        stockStatusFilter={stockStatusFilter}
        onStockStatusChange={setStockStatusFilter}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        categories={categories}
        filteredCount={filteredItems.length}
        materialsCount={rawMaterialItems.length}
        productsCount={productItems.length}
        onClear={() => {
          setStockStatusFilter('all');
          setSelectedCategory('all');
          setSearch('');
        }}
      />

      {/* 2. Raw materials box (ثبت سفارش خرید) */}
      <ReorderItemsSection
        theme={MATERIALS_THEME}
        items={rawMaterialItems}
        loading={loading}
        deficitCost={materialsDeficitCost}
        selectedIds={materialSelection.selectedIds}
        allSelected={materialSelection.allSelected}
        onToggle={materialSelection.toggle}
        onToggleAll={materialSelection.toggleAll}
        onBatchAction={handleOpenPurchaseOrderBatch}
        onAction={handleOpenPurchaseOrderSingle}
        onEditReorderPoint={setEditingItem}
      />

      {/* 3. Products box (تعریف پروژه تولید) */}
      <ReorderItemsSection
        theme={PRODUCTS_THEME}
        items={productItems}
        loading={loading}
        deficitCost={productsDeficitCost}
        selectedIds={productSelection.selectedIds}
        allSelected={productSelection.allSelected}
        onToggle={productSelection.toggle}
        onToggleAll={productSelection.toggleAll}
        onBatchAction={handleOpenProjectModalBatch}
        onAction={handleOpenProjectModalSingle}
        onEditReorderPoint={setEditingItem}
      />

      {/* 4. Stats summary cards & movement analysis */}
      <ReorderStatsCards
        totalAlarms={totalAlarms}
        zeroStockCount={zeroStockCount}
        materialsCount={materialsCount}
        productsCount={productsCount}
        totalDeficitCost={totalDeficitCost}
      />

      {/* Movement Analysis Section (Monthly charts + Fast/Slow/Dead movers) */}
      <MovementAnalysisSection />

      {/* 5. Modals */}
      {/* Modal 1: Purchase Order Modal (Raw Materials) — ذخیره و ابطال کش در useReorderPurchaseSubmit */}
      <ReorderPurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        selectedItems={purchaseModalItems}
        onSuccess={materialSelection.clear}
      />

      {/* Modal 2: Production Project Modal (Products) — مودال مشترک صفحه پروژه‌ها */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        customersList={[]}
        itemsList={items}
        initialProducts={projectModalProducts}
        initialTitle={projectModalTitle}
        onSuccess={() => {
          void invalidateAfterProductionProjectCreated(queryClient);
          productSelection.clear();
          toast.success('پروژه تولید با موفقیت تعریف گردید.');
        }}
      />

      {/* Modal 3: Edit Reorder Point Modal */}
      {editingItem && (
        <ReorderPointEditModal
          key={editingItem.id}
          item={editingItem}
          saving={updateReorderPoint.isPending}
          onCancel={() => setEditingItem(null)}
          onSave={handleUpdateReorderPoint}
        />
      )}
    </div>
  );
}
