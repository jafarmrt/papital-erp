import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { Category, Item, ProjectInventoryControlSectionData, ProjectProductItem } from '../../types';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { EMPTY_CUSTOM_MATERIAL_FORM, pendingMaterialRequestOf, type CustomMaterialForm } from '../../lib/pendingMaterials/customMaterialRequest';
import { withAddedWarehouseItem, withLinkedWarehouseItem, type MaterialRowTarget } from './sectionEdits';

type SetSections = React.Dispatch<React.SetStateAction<ProjectInventoryControlSectionData[]>>;

interface MaterialPickerOptions {
  projectId: number;
  sections: ProjectInventoryControlSectionData[];
  setSections: SetSections;
  products: readonly ProjectProductItem[];
  warehouseItems: readonly Item[];
  allCategories: readonly Category[];
}

/** the next free code of a raw material under a prefix (`GET /api/items/next-code`), asked when a category is chosen */
interface NextItemCode {
  code?: string;
  serial?: string;
}

/**
 * The materials tab's «افزودن / تغییر ماده اولیه» window: the section and row it adds to or changes, the warehouse item
 * picked from the list (filtered by the section's categories or codes), and the request for a material the warehouse
 * does not have yet (v9.0.398 TD-826: a request to the warehouse review queue, never an item). 10.3 (ARCH review
 * finding 3, part 11): moved out of `useProjectInventory`; the suggested code is read when a category is chosen, an
 * answer for that choice only, never cached.
 */
export function useMaterialPicker({ projectId, sections, setSections, products, warehouseItems, allCategories }: MaterialPickerOptions) {
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [materialModalSectionIdx, setMaterialModalSectionIdx] = useState<number | null>(null);
  const [materialModalTargetProdId, setMaterialModalTargetProdId] = useState<string | null>(null);
  const [materialModalTab, setMaterialModalTab] = useState<'warehouse' | 'custom'>('warehouse');
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');
  const [changingItemTarget, setChangingItemTarget] = useState<MaterialRowTarget | null>(null);
  const [codePrefix, setCodePrefix] = useState<string>('');
  const [customMaterialForm, setCustomMaterialForm] = useState<CustomMaterialForm>(EMPTY_CUSTOM_MATERIAL_FORM);

  const openFor = (secIdx: number, prodId: string | undefined, target: MaterialRowTarget | null) => {
    setMaterialModalSectionIdx(secIdx);
    setMaterialModalTargetProdId(prodId || null);
    setChangingItemTarget(target);
    setMaterialModalTab('warehouse');
    setWarehouseSearchQuery('');
    setIsMaterialModalOpen(true);
  };
  const handleOpenAddMaterialModal = (secIdx: number, prodId?: string) => openFor(secIdx, prodId, null);
  const handleOpenChangeMaterialModal = (secIdx: number, itemId: string, prodId?: string, gIdx?: number) =>
    openFor(secIdx, prodId, { secIdx, itemId, prodId, gIdx });

  // Category selection handler for generating item code
  const handleCategoryChangeForCustom = async (catName: string) => {
    const foundCat = allCategories.find(c => c.name === catName);
    const prefix = foundCat?.prefix || 'RAW';
    setCodePrefix(prefix);

    try {
      const res = await fetchJson<NextItemCode | null>(`/api/items/next-code?type=raw_material&prefix=${encodeURIComponent(prefix)}`);
      const itemCode = res?.code && res?.serial ? res.code : `${prefix}001`;
      setCustomMaterialForm(prev => ({ ...prev, category: catName, itemCode }));
    } catch (err) {
      // v9.0.422 (TD-766): پیش‌تر بی‌صدا «پیشوند۰۰۱» گذاشته می‌شد که شاید کد کالای دیگری باشد
      console.error('Failed to generate item code for custom material:', err);
      setCustomMaterialForm(prev => ({ ...prev, category: catName, itemCode: '' }));
      toast.error(`${errorMessageOf(err) || 'کد پیشنهادی کالا دریافت نشد'}؛ کد را دستی وارد کنید`);
    }
  };

  const handleSelectWarehouseItem = (whItem: Item) => {
    if (materialModalSectionIdx === null) return;
    if (changingItemTarget) {
      const target = changingItemTarget;
      setSections(prev => withLinkedWarehouseItem(prev, target, whItem, products));
      toast.success(`ماده اولیه با کالا «${whItem.name}» جاپایابی و متصل شد.`);
    } else {
      const secIdx = materialModalSectionIdx;
      const prodId = materialModalTargetProdId;
      const newItemId = `item_${Date.now()}`;
      setSections(prev => withAddedWarehouseItem(prev, secIdx, prodId, whItem, products, newItemId));
      toast.success(`ماده اولیه «${whItem.name}» افزوده شد.`);
    }
    setIsMaterialModalOpen(false);
  };

  const handleAddCustomMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (materialModalSectionIdx === null) return;

    if (!customMaterialForm.name || !customMaterialForm.category) {
      toast.error('لطفاً عنوان و دسته‌بندی ماده اولیه را وارد کنید.');
      return;
    }

    // v9.0.398 (TD-826): a request to the warehouse review queue, not an item; the item exists only after approval
    try {
      await fetchJson('/api/pending-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingMaterialRequestOf(customMaterialForm, projectId))
      });
      toast.success('درخواست ماده اولیه به صف بررسی انبار رفت. پس از تأیید انباردار، آن را از «انتخاب از انبار» برگزینید.');
      setCustomMaterialForm(EMPTY_CUSTOM_MATERIAL_FORM);
      setMaterialModalTab('warehouse');
    } catch (err) {
      console.error('Error sending custom raw material request:', err);
      toast.error(errorMessageOf(err) || 'خطا در ارسال درخواست ماده اولیه');
    }
  };

  const currentModalSection = materialModalSectionIdx !== null ? sections[materialModalSectionIdx] : undefined;

  const filteredWarehouseItems = useMemo(() => {
    // Restrict to raw materials only; exclude finished products
    let result = warehouseItems.filter(i => i.type === 'raw_material' || (i.type as string) !== 'product');
    const section = currentModalSection;
    if (section && section.filterType && section.filterType !== 'all') {
      if (section.filterType === 'category' && section.allowedCategories && section.allowedCategories.length > 0) {
        result = result.filter(i => i.category && section.allowedCategories?.includes(i.category));
      } else if (section.filterType === 'item_code' && section.allowedItemCodes && section.allowedItemCodes.length > 0) {
        result = result.filter(i => i.code && section.allowedItemCodes?.includes(i.code));
      }
    }

    if (!warehouseSearchQuery.trim()) return result.slice(0, 30);
    const q = warehouseSearchQuery.trim().toLowerCase();
    return result.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.code && i.code.toLowerCase().includes(q)) ||
      (i.category && i.category.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [warehouseItems, warehouseSearchQuery, currentModalSection]);

  return {
    isMaterialModalOpen, setIsMaterialModalOpen, materialModalTab, setMaterialModalTab, warehouseSearchQuery, setWarehouseSearchQuery,
    changingItemTarget, codePrefix, customMaterialForm, setCustomMaterialForm,
    handleCategoryChangeForCustom, handleOpenAddMaterialModal, handleOpenChangeMaterialModal, handleSelectWarehouseItem, handleAddCustomMaterial,
    filteredWarehouseItems, currentModalSection,
  };
}
