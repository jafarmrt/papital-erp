import { useEffect, useState } from 'react';
import { FolderTree, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { Item, PurchaseListItem } from '../../types';
import { useProjectInventory } from '../../hooks/useProjectInventory';
import { ProductTreeInventoryCards } from './ProductTreeInventoryCards';
import { GlobalInventoryControlSection } from './GlobalInventoryControlSection';
import { ManualPurchaseList } from './ManualPurchaseList';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';
import { AddMaterialModal } from './AddMaterialModal';
import { UnitConversionModal } from './UnitConversionModal';
import { toPersianDigits } from '../../utils';
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import { storedShortagesNowFree } from '../../lib/projects/materialAvailability';
import { buildSectionPurchaseList, sectionPurchaseRows } from './projectInventoryUtils';
import { ProjectIssuedMaterialsList } from './ProjectIssuedMaterialsList';
import { InventoryHeaderCard } from './inventory/InventoryHeaderCard';
import { InventoryMainTabs, PurchaseListBanner, type InventoryMainTab } from './inventory/InventoryMainTabs';

interface ProjectInventoryTabProps {
  project: any;
  itemsList?: Item[];
  warehouseItems?: Item[];
  onUpdate?: (signal?: AbortSignal) => void | Promise<void>;
  /** v10.2.1 (10.2 package 2, review U2): told whether the sections or the manual purchase rows hold an unsaved change */
  onDirtyChange?: (dirty: boolean) => void;
  /** 10.3 (part 9 review): an unsaved change or a save under way, so the page holds the project back until both are over */
  onBusyChange?: (busy: boolean) => void;
}

export function ProjectInventoryTab({
  project,
  itemsList,
  warehouseItems: initialWarehouseItems,
  onUpdate,
  onDirtyChange,
  onBusyChange
}: ProjectInventoryTabProps) {
  const effectiveItemsList = itemsList || initialWarehouseItems || [];

  // Active Main Tab: 'control' (Tree View + Global Supplies) vs 'purchase' (Consolidated Purchase List)
  const [activeMainTab, setActiveMainTab] = useState<InventoryMainTab>('control');
  // v9.0.417 (TD-752): ذخیره و ثبت نهایی با `projects.edit` (کلید `PUT /projects/:id`)، خرید کسری با کلید درخواست خرید
  const { canEdit, canRequestPurchase } = useProjectPermissions();

  const inventory = useProjectInventory(project, effectiveItemsList, onUpdate);
  const {
    isDirty,
    saving,
    isFinalized,
    reservedItems,
    reservationShortages,
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
    handleUpdatePerItemFields,
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
    availability,
    reportsReloadKey,
    handlePrintPurchaseListWithCheck,
    handleAddManualPurchaseRow,
    handleUpdateManualPurchaseItem,
    handleRemoveManualPurchaseItem,
    handleUpdateProcurementStatus,
    filteredWarehouseItems,
    currentModalSection
  } = inventory;

  // a change being saved is not left unsaved: switching tabs mid-save does not ask
  useEffect(() => { onDirtyChange?.(isDirty && !saving); }, [isDirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  // but the page keeps the project the sections started from until the save is over, so a read mid-save resets nothing
  useEffect(() => { onBusyChange?.(isDirty || saving); }, [isDirty, saving, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // V3.1.46 (TD-070): پل مستقیم خرید از ردیف بخش — ساخت لیست خرید موقت از کسری‌های همان بخش
  // v10.2.3 (TD-1290): ردیف‌های یک کالا یکی می‌شوند و مقدار خرید از کسری کل پروژه بیشتر نیست (`buildSectionPurchaseList`)
  const [sectionPurchase, setSectionPurchase] = useState<{ list: PurchaseListItem[]; secIdx: number } | null>(null);
  const handlePurchaseSection = (secIdx: number) => {
    const list = buildSectionPurchaseList(sections[secIdx], secIdx, warehouseItems, availability);
    if (list.length === 0) {
      toast.error('برای ردیف‌های این بخش مقداری برای خرید نمانده است؛ وضعیت ردیف‌ها و «لیست نهایی خرید و تامین» را ببینید.');
      return;
    }
    setSectionPurchase({ list, secIdx });
  };
  const handleSectionPurchaseSuccess = (createdDoc: any, orderedItemIds: string[]) => {
    for (const id of orderedItemIds || []) {
      const ref = sectionPurchaseRows(id);
      if (!ref) continue;
      for (const gIdx of ref.rows) handleUpdateGlobalItem(ref.secIdx, gIdx, 'procurementStatus', 'in_progress');
    }
    setSectionPurchase(null);
    void onUpdate?.();
  };

  // v10.2.3 (TD-1290): a stored reservation does not grow when stock arrives; «تکمیل رزرو» (TD-1341) reserves the rest
  const unreservedNowFree = storedShortagesNowFree(availability, isFinalized, reservationShortages);

  return (
    <div className="space-y-6 font-farsi dir-rtl">
      <InventoryHeaderCard projectId={Number(project.id)} inventory={inventory} canEdit={canEdit} unreservedNowFree={unreservedNowFree} />

      <InventoryMainTabs activeMainTab={activeMainTab} setActiveMainTab={setActiveMainTab} purchaseCount={purchaseList.length} />

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
                {toPersianDigits(products.length)} محصول در سفارش
              </span>
            </div>

            <ProductTreeInventoryCards
              products={products}
              sections={sections}
              warehouseItems={warehouseItems}
              availability={availability}
              activeStepTab={0}
              handleUpdatePerItemResult={handleUpdatePerItemResult}
              handleUpdatePerItemFields={handleUpdatePerItemFields}
              handleOpenChangeMaterialModal={handleOpenChangeMaterialModal}
              handleOpenUnitConversionModal={handleOpenUnitConversionModal}
              handleRemoveItemFromSection={handleRemoveItemFromSection}
              handleOpenAddMaterialModal={canEdit ? handleOpenAddMaterialModal : undefined}
            />
          </div>

          {/* Section 2: Global Supplies for Order (کنترل کلی برای کل سفارش) */}
          <GlobalInventoryControlSection
            sections={sections}
            warehouseItems={warehouseItems}
            availability={availability}
            handleOpenAddMaterialModal={canEdit ? handleOpenAddMaterialModal : undefined}
            handleOpenChangeMaterialModal={handleOpenChangeMaterialModal}
            handleOpenUnitConversionModal={handleOpenUnitConversionModal}
            handleRemoveItemFromSection={handleRemoveItemFromSection}
            handleUpdateGlobalItem={handleUpdateGlobalItem}
            handleAddNewSectionOnTheFly={canEdit ? handleAddNewSectionOnTheFly : undefined}
            handleRemoveSectionOnTheFly={handleRemoveSectionOnTheFly}
            handleUpdateSectionDescription={handleUpdateSectionDescription}
            handlePurchaseSection={canRequestPurchase ? handlePurchaseSection : undefined}
          />

          {/* v10.2.3 (TD-1290): materials already taken from stock for this project */}
          <ProjectIssuedMaterialsList projectId={project.id} reloadKey={reportsReloadKey} />

          <PurchaseListBanner purchaseCount={purchaseList.length} onOpen={() => setActiveMainTab('purchase')} />
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
            reservationShortages={reservationShortages}
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
