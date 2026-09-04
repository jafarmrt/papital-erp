import React from 'react';
import { 
  Boxes, Save, Lock, Unlock, Plus, ShoppingCart, CheckCircle2 
} from 'lucide-react';
import { ProductionProject, Item } from '../../types';
import { useProjectInventory } from '../../hooks/useProjectInventory';
import { ProductInventoryCards } from './ProductInventoryCards';
import { InventorySectionsList } from './InventorySectionsList';
import { ManualPurchaseList } from './ManualPurchaseList';
import { AddMaterialModal } from './AddMaterialModal';
import { UnitConversionModal } from './UnitConversionModal';

interface ProjectInventoryTabProps {
  project: ProductionProject;
  initialItemsList?: Item[];
  itemsList?: Item[];
  onUpdate?: () => void;
}

export function ProjectInventoryTab({ project, initialItemsList, itemsList, onUpdate }: ProjectInventoryTabProps) {
  const effectiveItemsList = itemsList || initialItemsList;
  const {
    saving,
    activeStepTab,
    setActiveStepTab,
    isFinalized,
    finalizedAt,
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
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">کنترل موجودی و تامین مواد اولیه پروژه</h3>
                {isFinalized && (
                  <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full font-bold text-[10px] flex items-center gap-1">
                    🔒 ثبت نهایی و فریز شده در انبار
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                بررسی گام‌به‌گام کدهای سفارش و اقلام کلی با انبار اصلی و استخراج هوشمند کسری‌های خرید
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
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

      {/* Product Summary Cards */}
      <ProductInventoryCards products={products} sections={sections} />

      {/* Step Tabs Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none border-b border-slate-200 print:hidden">
        {sections.map((sec, idx) => (
          <button
            key={sec.id || idx}
            type="button"
            onClick={() => setActiveStepTab(idx)}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeStepTab === idx
                ? 'bg-slate-900 text-amber-400 shadow-md ring-2 ring-slate-900'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] ${
              activeStepTab === idx ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-100 text-slate-600'
            }`}>
              {idx + 1}
            </span>
            <span>{sec.title}</span>
          </button>
        ))}

        {/* Final Step Tab: Purchase List */}
        <button
          type="button"
          onClick={() => setActiveStepTab(sections.length)}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
            activeStepTab === sections.length
              ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500'
              : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
          }`}
        >
          <ShoppingCart className="w-4 h-4 text-amber-900" />
          <span>لیست نهایی خرید</span>
          {purchaseList.length > 0 && (
            <span className="px-2 py-0.5 bg-amber-900 text-amber-100 rounded-full font-mono text-[10px] font-bold">
              {purchaseList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleAddNewSectionOnTheFly}
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer border border-slate-200 mr-auto shrink-0"
          title="افزودن بخش کنترل جدید"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content Area */}
      {activeStepTab < sections.length ? (
        <InventorySectionsList
          activeStepTab={activeStepTab}
          setActiveStepTab={setActiveStepTab}
          sections={sections}
          products={products}
          warehouseItems={warehouseItems}
          handleUpdateSectionDescription={handleUpdateSectionDescription}
          handleOpenAddMaterialModal={handleOpenAddMaterialModal}
          handleRemoveSectionOnTheFly={handleRemoveSectionOnTheFly}
          handleOpenChangeMaterialModal={handleOpenChangeMaterialModal}
          handleUpdatePerItemResult={handleUpdatePerItemResult}
          handleOpenUnitConversionModal={handleOpenUnitConversionModal}
          handleRemoveItemFromSection={handleRemoveItemFromSection}
          handleUpdateGlobalItem={handleUpdateGlobalItem}
        />
      ) : (
        <ManualPurchaseList
          project={project}
          purchaseList={purchaseList}
          isFinalized={isFinalized}
          warehouseItems={warehouseItems}
          handleAddManualPurchaseRow={handleAddManualPurchaseRow}
          handlePrintPurchaseListWithCheck={handlePrintPurchaseListWithCheck}
          handleUpdateManualPurchaseItem={handleUpdateManualPurchaseItem}
          handleRemoveManualPurchaseItem={handleRemoveManualPurchaseItem}
          handleUpdateProcurementStatus={handleUpdateProcurementStatus}
        />
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
    </div>
  );
}

export default ProjectInventoryTab;
