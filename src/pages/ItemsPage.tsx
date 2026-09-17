import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Item, User } from '../types';
import { Search, Plus, FileSpreadsheet, CheckSquare, Package, Box, AlertTriangle, Layers, Tag } from 'lucide-react';
import { useSearch } from '../SearchContext';
import { cn, formatPersianNumber } from '../utils';
import ConfirmModal from '../components/ConfirmModal';
import ImagePreviewModal from '../components/items/ImagePreviewModal';
import ImportErrorsModal from '../components/items/ImportErrorsModal';
import ItemsTable from '../components/items/ItemsTable';
import ItemFormModal from '../components/items/ItemFormModal';

const UnifiedExcelModal = lazy(() => import('../components/UnifiedExcelModal'));
import {
  useItemsQuery,
  useCategoriesQuery,
  useWarehousesQuery,
  useArchiveItemMutation,
  useSyncItemMutation
} from '../hooks/queries';

export default function ItemsPage({ user }: { user: User }) {
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch } = useSearch();
  const [page, setPage] = useState(1);

  // V10-2.2: تب دوتایی محصول/مواد اولیه در یک صفحه واحد — منبع حقیقت = کوئری‌پارام URL برای deep-link
  const [searchParams, setSearchParams] = useSearchParams();
  const type: 'product' | 'raw_material' = searchParams.get('type') === 'raw_material' ? 'raw_material' : 'product';
  const pageTitle = type === 'product' ? 'مدیریت محصولات' : 'مدیریت مواد اولیه';
  const entityLabel = type === 'product' ? 'محصولات' : 'مواد اولیه';

  const handleTypeSwitch = (nextType: 'product' | 'raw_material') => {
    if (nextType === type) return;
    setPage(1);
    setSortConfig(null);
    setEditingItem(null);
    setSearchParams(nextType === 'raw_material' ? { type: nextType } : {});
  };
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [importErrors, setImportErrors] = useState<any[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [importProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncingItemId, setSyncingItemId] = useState<number | null>(null);
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; itemId: number }>({ isOpen: false, itemId: 0 });

  const [viewImage, setViewImage] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // React Query Hooks (V4 Phase 6.2 U-1: اتصال به debouncedSearchQuery برای حذف بار شبکه غیرضروری)
  const { data: itemsResponse, isLoading: loading, refetch: loadItems } = useItemsQuery(type, page, 50, debouncedSearchQuery);
  const { data: allCategories = [] } = useCategoriesQuery(type);
  const { data: warehouses = [] } = useWarehousesQuery();

  const archiveMutation = useArchiveItemMutation();
  const syncMutation = useSyncItemMutation();

  const items = itemsResponse?.data || [];
  const totalPages = itemsResponse?.totalPages || 1;
  const totalItems = itemsResponse?.total || 0;

  // Reset to page 1 on debounced search change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery]);

  const sortedItems = React.useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a: any, b: any) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        
        if (sortConfig.key === 'current_stock') {
           aVal = a.current_stock;
           bVal = b.current_stock;
        }
        
        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const executeArchive = async () => {
    const id = confirmState.itemId;
    await archiveMutation.mutateAsync(id);
    setConfirmState({ isOpen: false, itemId: 0 });
  };

  const handleSyncItem = async (itemId: number) => {
    setSyncingItemId(itemId);
    try {
      await syncMutation.mutateAsync(itemId);
    } finally {
      setSyncingItemId(null);
    }
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setShowModal(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setShowModal(true);
  };

  // Calculate stats
  const safeItemsList = Array.isArray(items) ? items : [];
  const lowStockCount = safeItemsList.filter(i => (i.reorder_point || 0) > 0 && i.current_stock <= (i.reorder_point || 0)).length;

  return (
    <div className="space-y-6">
      <ImagePreviewModal imageUrl={viewImage} onClose={() => setViewImage(null)} />

      {importProgress && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-slate-100">
            <h3 className="font-bold text-lg mb-4 text-center text-slate-800">در حال ورود اطلاعات...</h3>
            <div className="w-full bg-slate-100 rounded-full h-4 mb-2 overflow-hidden border border-slate-200">
              <div 
                className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
              ></div>
            </div>
            <p className="text-center text-sm text-slate-600 font-medium font-mono" dir="ltr">
              {importProgress.current} / {importProgress.total}
            </p>
          </div>
        </div>
      )}

      {/* Hero Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-amber-400 shadow-inner shrink-0">
              {type === 'product' ? <Package size={26} /> : <Box size={26} />}
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                {pageTitle}
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                {type === 'product' 
                  ? 'ثبت و کاتالوگ محصولات نهایی، کدگذاری دقیق، مشخصات فنی و توزیع انبارها'
                  : 'مدیریت و دسته‌بندی مواد اولیه، کنترل نقطه سفارش و زنجیره تامین انبار'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {type === 'raw_material' && (
              <Link 
                to="/pending-materials" 
                className="px-3.5 py-2 text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
              >
                <CheckSquare size={16} className="text-amber-400" />
                صف تأیید مواد اولیه جدید
              </Link>
            )}
            <button 
              onClick={() => setShowExcelModal(true)} 
              className="px-3.5 py-2 text-xs font-bold bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/30 rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet size={16} className="text-emerald-400" />
              ورود و خروج اکسل
            </button>
            {user.role !== 'viewer' && (
              <button 
                onClick={handleAddNew}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 cursor-pointer"
              >
                <Plus size={18} />
                ثبت {type === 'product' ? 'محصول جدید' : 'ماده اولیه جدید'}
              </button>
            )}
          </div>
        </div>

        {/* V10-2.2: سوییچ تب محصولات / مواد اولیه (الگوی GalleryPage) */}
        <div className="flex w-fit bg-slate-800/80 backdrop-blur-xs p-1 rounded-xl border border-slate-700/80 mt-5 shrink-0">
          <button
            onClick={() => handleTypeSwitch('product')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
              type === 'product' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white"
            )}
          >
            محصولات نهایی
          </button>
          <button
            onClick={() => handleTypeSwitch('raw_material')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
              type === 'raw_material' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white"
            )}
          >
            مواد اولیه
          </button>
        </div>

        {/* Header Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
              <Layers size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">کل اقلام ثبت‌شده</p>
              <p className="text-lg font-black text-white">{formatPersianNumber(totalItems || items.length)} مورد</p>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
              <Tag size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">دسته‌بندی‌های فعال</p>
              <p className="text-lg font-black text-purple-300">{formatPersianNumber(allCategories.length)} دسته</p>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3 col-span-2 md:col-span-1">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">اقلام زیر نقطه سفارش</p>
              <p className="text-lg font-black text-amber-300">{formatPersianNumber(lowStockCount)} مورد</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm flex flex-col min-h-[460px] overflow-hidden">
        <div className="p-4 bg-slate-50/70 border-b border-slate-200/80 flex justify-between items-center flex-wrap gap-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute right-3.5 top-3 text-slate-400" size={17} />
            <input 
              type="text" 
              placeholder="جستجو بر اساس نام کالا، کد شناسایی یا دسته‌بندی..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-300/80 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white shadow-2xs transition-all"
            />
          </div>

          <div className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
            نمایش {formatPersianNumber(sortedItems.length)} از {formatPersianNumber(totalItems || items.length)} قلم
          </div>
        </div>

        <ItemsTable
          sortedItems={sortedItems}
          warehouses={warehouses}
          sortConfig={sortConfig}
          requestSort={requestSort}
          loading={loading}
          user={user}
          onViewImage={setViewImage}
          onEditItem={handleEdit}
          onArchiveItem={(itemId) => setConfirmState({ isOpen: true, itemId })}
          onSyncItem={handleSyncItem}
          syncingItemId={syncingItemId}
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          onPageChange={setPage}
        />
      </div>

      <ItemFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        type={type}
        editingItem={editingItem}
        allCategories={allCategories}
        warehouses={warehouses}
        onSuccess={loadItems}
      />

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title="آرشیو و بایگانی کالا"
        message="آیا از حذف (آرشیو) این کالا اطمینان دارید؟ با انتقال کالا به آرشیو، این مورد دیگر در جداول فعال محصولات و مواد اولیه نشان داده نخواهد شد. اما برای حفظ ثبات و صحت اسناد مالی و فاکتورهای قبلی، تمام تراکنش‌ها و اقلام فاکتورهای ثبت شده با این کالا کماکان به طور دقیق نگهداری می‌شوند."
        onConfirm={executeArchive}
        onCancel={() => setConfirmState({ isOpen: false, itemId: 0 })}
        confirmText="بله، انتقال به آرشیو"
        cancelText="انصراف"
      />

      <ImportErrorsModal
        importErrors={importErrors}
        setImportErrors={setImportErrors}
        allCategories={allCategories}
        type={type}
        onSuccessRefresh={loadItems}
      />

      {showExcelModal && (
        <Suspense fallback={null}>
          <UnifiedExcelModal
            isOpen={showExcelModal}
            onClose={() => setShowExcelModal(false)}
            onSuccess={loadItems}
            typeFilter={type}
            title={`مدیریت اکسل ${entityLabel} و قیمت‌گذاری‌ها`}
          />
        </Suspense>
      )}
    </div>
  );
}
