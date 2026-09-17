import { useState } from 'react';
import { Boxes, ShoppingCart, CheckCircle2, Lock, Unlock, Save, FolderTree, Printer, ArrowLeft } from 'lucide-react';
import { Item, ProjectInventoryControlSectionData, PurchaseListItem } from '../../types';
import { useProjectInventory } from '../../hooks/useProjectInventory';
import { ProductTreeInventoryCards } from './ProductTreeInventoryCards';
import { GlobalInventoryControlSection } from './GlobalInventoryControlSection';
import { ManualPurchaseList } from './ManualPurchaseList';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';
import { AddMaterialModal } from './AddMaterialModal';
import { UnitConversionModal } from './UnitConversionModal';

interface ProjectInventoryTabProps {
  project: any;
  itemsList?: Item[];
  warehouseItems?: Item[];
  onUpdate?: (signal?: AbortSignal) => void | Promise<void>;
}

export function ProjectInventoryTab({
  project,
  itemsList,
  warehouseItems: initialWarehouseItems,
  onUpdate
}: ProjectInventoryTabProps) {
  const effectiveItemsList = itemsList || initialWarehouseItems || [];

  // Active Main Tab: 'control' (Tree View + Global Supplies) vs 'purchase' (Consolidated Purchase List)
  const [activeMainTab, setActiveMainTab] = useState<'control' | 'purchase'>('control');

  const {
    saving,
    isFinalized,
    reservedItems,
    isUnitConversionModalOpen,
    setIsUnitConversionModalOpen,
    conversionTarget,
    conversionForm,
    setConversionForm,
    warehouseItems,
    products,
    sections,
    isMaterialModalOpen,
    setIsMaterialModalOpen,
    materialModalTab,
    setMaterialModalTab,
    warehouseSearchQuery,
    setWarehouseSearchQuery,
    changingItemTarget,
    allCategories,
    codePrefix,
    customMaterialForm,
    setCustomMaterialForm,
    handleCategoryChangeForCustom,
    handleUpdateSectionDescription,
    handleUpdatePerItemResult,
    handleUpdateGlobalItem,
    handleOpenAddMaterialModal,
    handleOpenChangeMaterialModal,
    handleSelectWarehouseItem,
    handleAddCustomMaterial,
    handleRemoveItemFromSection,
    handleAddNewSectionOnTheFly,
    handleRemoveSectionOnTheFly,
    handleOpenUnitConversionModal,
    handleApplyUnitConversion,
    purchaseList,
    materialProgress,
    handleFinalizeAndReserveStock,
    handleUnfinalizeReservation,
    handlePrintPurchaseListWithCheck,
    handleSaveInventoryControl,
    handleAddManualPurchaseRow,
    handleUpdateManualPurchaseItem,
    handleRemoveManualPurchaseItem,
    handleUpdateProcurementStatus,
    filteredWarehouseItems,
    currentModalSection
  } = useProjectInventory(project, effectiveItemsList, onUpdate);

  // V3.1.46 (TD-070): پل مستقیم خرید از ردیف بخش — ساخت لیست خرید موقت از کسری‌های همان بخش
  const [sectionPurchase, setSectionPurchase] = useState<{ list: PurchaseListItem[]; secIdx: number } | null>(null);
  const handlePurchaseSection = (secIdx: number) => {
    const sec: ProjectInventoryControlSectionData | undefined = sections[secIdx];
    if (!sec) return;
    const items = sec.globalItems || [];
    const bridged: PurchaseListItem[] = items
      .map((item, gIdx) => ({ item, gIdx }))
      .map(({ item, gIdx }) => {
        const matchWh = (warehouseItems || []).find(i =>
          (item.itemCode && i.code === item.itemCode) ||
          (item.name && i.name.toLowerCase() === item.name.toLowerCase())
        );
        const currentStock = matchWh ? Number(matchWh.current_stock || 0) : Number(item.stockQty || 0);
        const requiredQty = Number(item.requiredQty || 1);
        const shortfall = Math.max(0, requiredQty - currentStock);
        return {
          id: `sec${secIdx}_g${gIdx}_${item.itemCode || item.name || gIdx}`,
          itemCode: item.itemCode || matchWh?.code || '',
          itemName: item.name || matchWh?.name || '',
          category: sec.title || 'بخش کنترل',
          totalRequiredQty: requiredQty,
          unit: item.unit || matchWh?.unit || 'عدد',
          warehouseStockQty: currentStock,
          warehouseUnit: matchWh?.unit || item.unit,
          toPurchaseQty: shortfall,
          procurementStatus: item.procurementStatus || 'pending',
          notes: item.notes
        };
      })
      .filter(p => p.toPurchaseQty > 0);
    if (bridged.length === 0) return;
    setSectionPurchase({ list: bridged, secIdx });
  };
  const handleSectionPurchaseSuccess = (createdDoc: any, orderedItemIds: string[]) => {
    for (const id of orderedItemIds || []) {
      const m = /^sec(\d+)_g(\d+)_/.exec(id);
      if (m) {
        handleUpdateGlobalItem(Number(m[1]), Number(m[2]), 'procurementStatus', 'in_progress');
      }
    }
    setSectionPurchase(null);
    onUpdate?.();
  };

  return (
    <div className="space-y-6 font-farsi dir-rtl">
      {/* Top Header Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg space-y-4 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base text-white">کنترل موجودی و تامین مواد اولیه پروژه</h3>
                {isFinalized && (
                  <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full font-bold text-[10px] flex items-center gap-1">
                    🔒 ثبت نهایی و فریز شده در انبار
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                بررسی ساختار درختی کد به کد محصولات و کنترل اقلام عمومی سفارش با انبار اصلی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
            {isFinalized ? (
              <button
                type="button"
                onClick={handleUnfinalizeReservation}
                disabled={saving}
                className="px-3.5 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Unlock className="w-4 h-4 text-purple-300" />
                لغو فریز و باز کردن رزرو
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalizeAndReserveStock}
                disabled={saving}
                className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              >
                <Lock className="w-4 h-4 text-purple-200" />
                ثبت نهایی و فریز انبار
              </button>
            )}

            <button
              type="button"
              onClick={handlePrintPurchaseListWithCheck}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="چاپ لیست خرید و اقلام کسری"
            >
              <Printer className="w-4 h-4 text-slate-400" />
              <span>چاپ لیست خرید</span>
            </button>

            <button
              type="button"
              onClick={handleSaveInventoryControl}
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'در حال ذخیره...' : 'ذخیره فرم'}
            </button>
          </div>
        </div>

        {/* Overall Material Readiness Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              میزان آماده‌باش و موجود بودن مواد اولیه:
            </span>
            <span className="text-amber-400 font-mono text-sm">{materialProgress}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${materialProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Tab Navigation: Control View vs Consolidated Purchase List */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2 print:hidden">
        <div className="inline-flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveMainTab('control')}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              activeMainTab === 'control'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderTree className="w-4 h-4 text-amber-400" />
            <span>کنترل مواد اولیه (کد به کد + عمومی)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMainTab('purchase')}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              activeMainTab === 'purchase'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>لیست نهایی خرید و تامین</span>
            {purchaseList.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                activeMainTab === 'purchase' ? 'bg-slate-950 text-amber-400' : 'bg-rose-500 text-white'
              }`}>
                {purchaseList.length}
              </span>
            )}
          </button>
        </div>

        <span className="text-xs text-slate-500 hidden md:inline">
          {activeMainTab === 'control' 
            ? 'ساختار درختی محصولات برای کنترل کد به کد و جدول اقلام عمومی کل سفارش'
            : 'تجمیع هوشمند کسری‌های خرید کل پروژه جهت ثبت سفارش تامین'
          }
        </span>
      </div>

      {/* Active Tab View */}
      {activeMainTab === 'control' ? (
        <div className="space-y-6">
          {/* Section 1: Per-Product Tree View (کد به کد) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-amber-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  ساختار درختی محصولات و قطعات (کنترل کد به کد به تفکیک محصول)
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                {products.length} محصول در سفارش
              </span>
            </div>

            <ProductTreeInventoryCards
              products={products}
              sections={sections}
              warehouseItems={warehouseItems}
              activeStepTab={0}
              handleUpdatePerItemResult={handleUpdatePerItemResult}
              handleOpenChangeMaterialModal={handleOpenChangeMaterialModal}
              handleOpenUnitConversionModal={handleOpenUnitConversionModal}
              handleRemoveItemFromSection={handleRemoveItemFromSection}
              handleOpenAddMaterialModal={handleOpenAddMaterialModal}
            />
          </div>

          {/* Section 2: Global Supplies for Order (کنترل کلی برای کل سفارش) */}
          <GlobalInventoryControlSection
            sections={sections}
            warehouseItems={warehouseItems}
            handleOpenAddMaterialModal={handleOpenAddMaterialModal}
            handleOpenChangeMaterialModal={handleOpenChangeMaterialModal}
            handleOpenUnitConversionModal={handleOpenUnitConversionModal}
            handleRemoveItemFromSection={handleRemoveItemFromSection}
            handleUpdateGlobalItem={handleUpdateGlobalItem}
            handleAddNewSectionOnTheFly={handleAddNewSectionOnTheFly}
            handleRemoveSectionOnTheFly={handleRemoveSectionOnTheFly}
            handleUpdateSectionDescription={handleUpdateSectionDescription}
            handlePurchaseSection={handlePurchaseSection}
          />

          {/* Quick Jump Banner to Purchase List */}
          {purchaseList.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-amber-950">
                    تعداد {purchaseList.length} قلم کالا دارای کسری موجودی یا نیاز به خرید شناسایی شد.
                  </h4>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    کسری‌های استخراج‌شده از ساختار درختی و اقلام عمومی در لیست تجمیعی خرید آماده ثبت هستند.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveMainTab('purchase')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
              >
                <span>مشاهده و مدیریت لیست خرید</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Section 3: Consolidated Purchase List */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setActiveMainTab('control')}
              className="text-xs text-slate-600 hover:text-slate-900 font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
              <span>بازگشت به کنترل موجودی و ساختار درختی</span>
            </button>
          </div>

          <ManualPurchaseList
            project={project}
            purchaseList={purchaseList}
            isFinalized={isFinalized}
            reservedItems={reservedItems}
            warehouseItems={warehouseItems}
            handleAddManualPurchaseRow={handleAddManualPurchaseRow}
            handlePrintPurchaseListWithCheck={handlePrintPurchaseListWithCheck}
            handleUpdateManualPurchaseItem={handleUpdateManualPurchaseItem}
            handleRemoveManualPurchaseItem={handleRemoveManualPurchaseItem}
            handleUpdateProcurementStatus={handleUpdateProcurementStatus}
          />
        </div>
      )}

      {/* Modals */}
      <AddMaterialModal
        isOpen={isMaterialModalOpen}
        onClose={() => setIsMaterialModalOpen(false)}
        changingItemTarget={changingItemTarget}
        materialModalTab={materialModalTab}
        setMaterialModalTab={setMaterialModalTab}
        warehouseItems={warehouseItems}
        filteredWarehouseItems={filteredWarehouseItems}
        warehouseSearchQuery={warehouseSearchQuery}
        setWarehouseSearchQuery={setWarehouseSearchQuery}
        currentModalSection={currentModalSection}
        handleSelectWarehouseItem={handleSelectWarehouseItem}
        customMaterialForm={customMaterialForm}
        setCustomMaterialForm={setCustomMaterialForm}
        allCategories={allCategories}
        codePrefix={codePrefix}
        handleCategoryChangeForCustom={handleCategoryChangeForCustom}
        handleAddCustomMaterial={handleAddCustomMaterial}
      />

      <UnitConversionModal
        isOpen={isUnitConversionModalOpen}
        onClose={() => setIsUnitConversionModalOpen(false)}
        conversionTarget={conversionTarget}
        conversionForm={conversionForm}
        setConversionForm={setConversionForm}
        handleApplyUnitConversion={handleApplyUnitConversion}
      />

      {sectionPurchase && (
        <CreatePurchaseOrderModal
          isOpen={true}
          onClose={() => setSectionPurchase(null)}
          project={project}
          purchaseList={sectionPurchase.list}
          warehouseItems={warehouseItems}
          onOrderCreated={handleSectionPurchaseSuccess}
        />
      )}
    </div>
  );
}

export default ProjectInventoryTab;
