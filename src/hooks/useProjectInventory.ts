import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  ProductionProject,
  ProjectInventoryControlSectionData,
  Item,
  Category,
  PurchaseListItem,
  ProjectInventoryControlItemResult,
  ProjectProductItem
} from '../types';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS } from '../constants/inventoryControlPresets';
import {
  buildConsolidatedPurchaseList,
  calculateMaterialProgress,
  withProcurementStatus
} from '../components/project/projectInventoryUtils';
import { useProjectVersion } from './useProjectVersion';
import { hasPresetShapedSections, perItemProductKey, projectSectionsFromPreset, type MaterialStockLookup } from '../lib/projects/inventoryControlSections';
import { productOrderQuantity } from '../lib/projects/materialQuantity';
import { findProjectItemMatch } from '../lib/projects/projectItemMatch';
import { buildMaterialAvailabilityView, projectMaterialItemIds } from '../lib/projects/materialAvailability';
import { useProjectMaterialAvailability, type WarehouseItemsState } from './useProjectMaterialReports';
import { useProjectItemOptions } from './queries/useProjectWorkspaceQueries';
import { presetSectionsOfSettings, useInventoryCategoriesQuery, useInventorySettingsQuery } from './queries/useProjectInventoryQueries';
import { withGlobalItemFields, withoutSectionItem, withPerItemFields } from './projectInventory/sectionEdits';
import { useMaterialPicker } from './projectInventory/useMaterialPicker';
import { useUnitConversion } from './projectInventory/useUnitConversion';
import { useInventoryReservation } from './projectInventory/useInventoryReservation';

/** v9.0.413 (TD-748): موجودی ماده الگو با قاعده مشترک تطبیق کالا */
const materialStockLookup = (warehouseItems: readonly Item[]): MaterialStockLookup => material =>
  findProjectItemMatch({ code: material.code, name: material.name }, warehouseItems)?.current_stock;

/**
 * V3.1.0 (باگ کاربر): قبلاً وقتی product_items موجود نبود، یک محصول جعلی با «عنوان پروژه» به‌عنوان نام کالا ساخته می‌شد —
 * کنترل کد به کد عملاً به سطح پروژه سقوط می‌کرد. اکنون از products واقعی پروژه استفاده می‌شود و fallback فقط وقتی است که
 * کالای اصلی پروژه واقعاً مشخص باشد.
 */
function projectProductsOf(project: ProductionProject): ProjectProductItem[] {
  const raw = (Array.isArray((project as unknown as { products?: unknown[] }).products) ? (project as unknown as { products: Array<Record<string, unknown>> }).products : []) as Array<Record<string, unknown>>;
  // TD-1343: کلید و تعداد سفارش هر محصول همان که ثبت نهایی و تکمیل رزرو می‌خوانند
  const mapped = raw.map((p, idx) => ({
    id: perItemProductKey(p, idx),
    item_id: (p.item_id ?? null) as number | null,
    item_name: String(p.item_name ?? p.itemName ?? ''),
    item_code: String(p.item_code ?? p.itemCode ?? ''),
    customer_code: String(p.customer_code ?? ''),
    quantity: productOrderQuantity(p),
    unit: String(p.unit ?? 'عدد'),
    needs_assembly: p.needs_assembly !== false,
    selected_optional_stages: (p.selected_optional_stages ?? undefined) as string[] | undefined
  }));
  if (mapped.length > 0) return mapped;
  if (project.item_id) {
    return [{
      id: 'prod_main',
      item_id: project.item_id,
      item_name: project.item_name || '',
      item_code: project.item_code || '',
      customer_code: '',
      quantity: Number(project.quantity) || 1,
      unit: project.unit || 'عدد',
      needs_assembly: true
    }];
  }
  return [];
}

/**
 * The materials tab of a project («کنترل موجودی و تامین مواد اولیه»): its sections and manual purchase rows, the free stock
 * of each material, the purchase list and the saves. 10.3 (ARCH review finding 3, part 11): the material picker, the unit
 * conversion and the saves live in `hooks/projectInventory/`; this hook holds the sections and composes them.
 */
export function useProjectInventory(
  project: ProductionProject,
  initialItemsList?: Item[],
  // the page's refresh may return a promise; the handlers do not wait for it (10.3, ARCH review finding 4)
  onUpdate?: () => void | Promise<void>
) {
  const projectVersion = useProjectVersion(project);

  // v10.2 package 11 part 5e (TD-1364): the item pick list, categories and settings come from React Query, the keys the
  // workspace tabs, the settings screens and the other forms read, so a stock, category or settings change refreshes them
  const itemsQuery = useProjectItemOptions(true);
  const categoriesQuery = useInventoryCategoriesQuery();
  const settingsQuery = useInventorySettingsQuery();
  const warehouseItems = useMemo<Item[]>(() => itemsQuery.data ?? initialItemsList ?? [], [itemsQuery.data, initialItemsList]);
  // v10.2.3 (TD-1290): ارقام آزاد پس از رسیدن فهرست کالاها خوانده می‌شوند
  const warehouseItemsState: WarehouseItemsState = itemsQuery.data ? 'loaded' : (itemsQuery.isError ? 'failed' : 'loading');
  const allCategories: Category[] = categoriesQuery.data ?? [];
  // v9.0.422 (TD-766): a settings preset that cannot be read or parsed falls back to the default preset, and the user is told
  const presetRead = useMemo<{ sections: unknown[] | null; unreadable: boolean }>(() => {
    try {
      return { sections: presetSectionsOfSettings(settingsQuery.data), unreadable: false };
    } catch {
      return { sections: null, unreadable: true };
    }
  }, [settingsQuery.data]);

  const products = useMemo(() => projectProductsOf(project), [project]);

  // Main sections state
  // v9.0.413 (TD-748): بخش الگو (مواد در items) به ردیف‌های پروژه برده می‌شود تا فهرست خرید، پیشرفت و رزرو آن را ببینند
  const [sections, setSectionsState] = useState<ProjectInventoryControlSectionData[]>(() => {
    const stored = project.inventory_control?.sections;
    const hasStored = Array.isArray(stored) && stored.length > 0;
    // TD-1343 review M1: only the presets of a project without sections start at one per unit; stored preset rows keep their total
    return projectSectionsFromPreset(hasStored ? stored : DEFAULT_INVENTORY_CONTROL_SECTIONS, products, materialStockLookup(initialItemsList || []), { perUnit: !hasStored });
  });
  const [manualPurchaseItems, setManualPurchaseItemsState] = useState<PurchaseListItem[]>(() => project.inventory_control?.manualPurchaseItems || []);

  // v10.2.1 (10.2 package 2, review U2): a change the user made and has not saved; loading or syncing the project
  // writes the state directly and leaves it clean, every edit goes through these setters and marks it. 10.3 (part 11):
  // the edits are counted, so a save clears the mark only when nothing was edited while it was under way
  const [isDirty, setIsDirty] = useState(false);
  const editCount = useRef(0);
  const setSections = useCallback<React.Dispatch<React.SetStateAction<ProjectInventoryControlSectionData[]>>>(value => {
    editCount.current += 1;
    setIsDirty(true);
    setSectionsState(value);
  }, []);
  const setManualPurchaseItems = useCallback<React.Dispatch<React.SetStateAction<PurchaseListItem[]>>>(value => {
    editCount.current += 1;
    setIsDirty(true);
    setManualPurchaseItemsState(value);
  }, []);
  const editsNow = useCallback(() => editCount.current, []);
  const savedAsOf = useCallback((editsAtSend: number) => {
    if (editCount.current === editsAtSend) setIsDirty(false);
  }, []);

  // what failed to load is said once per failure
  const prerequisitesFailed = itemsQuery.isError || categoriesQuery.isError;
  useEffect(() => {
    if (prerequisitesFailed) toast.error('خطا در دریافت اطلاعات پیش‌نیاز کنترل موجودی پروژه');
  }, [prerequisitesFailed]);
  useEffect(() => {
    if (settingsQuery.isError) toast.error('الگوی بخش‌های کنترل موجودی از تنظیمات دریافت نشد؛ الگوی پیش‌فرض به کار رفت');
  }, [settingsQuery.isError]);
  useEffect(() => {
    if (presetRead.unreadable) toast.error('الگوی بخش‌های کنترل موجودی در تنظیمات خوانا نیست؛ الگوی پیش‌فرض به کار رفت');
  }, [presetRead.unreadable]);

  // v9.0.413 (TD-748): پروژه بی بخش الگوی تنظیمات (یا پیش‌فرض) را می‌گیرد و بخش الگوی ذخیره‌شده ردیف پروژه؛ وضعیت هر ماده از موجودی.
  // Once per project as given, when its items and settings have arrived: a later read of the item list
  // (a stock change elsewhere) never replaces the sections on screen. A cached item list or settings being read
  // again is waited for (#357 review M1), so the stock statuses come from the current read, as before v10.2.39.
  const sectionsBuiltFor = useRef<{ inventoryControl: unknown; products: unknown } | null>(null);
  const prerequisitesReady = Boolean(itemsQuery.data) && !itemsQuery.isFetching
    && (settingsQuery.isSuccess || settingsQuery.isError) && !settingsQuery.isFetching;
  useEffect(() => {
    if (!prerequisitesReady) return;
    const built = sectionsBuiltFor.current;
    if (built && built.inventoryControl === project.inventory_control && built.products === products) return;
    sectionsBuiltFor.current = { inventoryControl: project.inventory_control, products };
    const stored = project.inventory_control?.sections;
    const hasStored = Array.isArray(stored) && stored.length > 0;
    if (!hasStored || hasPresetShapedSections(stored)) {
      setSectionsState(projectSectionsFromPreset(hasStored ? stored : (presetRead.sections ?? DEFAULT_INVENTORY_CONTROL_SECTIONS), products, materialStockLookup(warehouseItems), { perUnit: !hasStored }));
    }
  }, [prerequisitesReady, project.inventory_control, products, presetRead.sections, warehouseItems]);

  // Sync state if project changes
  useEffect(() => {
    if (project.inventory_control?.sections && project.inventory_control.sections.length > 0) {
      setSectionsState(projectSectionsFromPreset(project.inventory_control.sections, products));
    }
    if (project.inventory_control?.manualPurchaseItems) {
      setManualPurchaseItemsState(project.inventory_control.manualPurchaseItems);
    }
    setIsDirty(false);
  }, [project, products]);

  const handleUpdateSectionDescription = (secIdx: number, newDesc: string) => {
    const updated = [...sections];
    updated[secIdx] = { ...updated[secIdx], description: newDesc };
    setSections(updated);
  };

  // v10.0.105 (TD-1212): updates read the latest sections (functional update), so several fields set one after another
  // all survive; before, each call copied the same stale sections and only the last field (convertedQty) was kept
  const updatePerItemFields = (secIdx: number, prodId: string, itemId: string, patch: Partial<ProjectInventoryControlItemResult>) =>
    setSections(prev => withPerItemFields(prev, secIdx, prodId, itemId, patch));
  const handleUpdatePerItemResult = (secIdx: number, prodId: string, itemId: string, field: string, value: unknown) =>
    updatePerItemFields(secIdx, prodId, itemId, { [field]: value });
  const updateGlobalItemFields = (secIdx: number, gIdx: number, patch: Partial<ProjectInventoryControlItemResult>) =>
    setSections(prev => withGlobalItemFields(prev, secIdx, gIdx, patch));
  const handleUpdateGlobalItem = (secIdx: number, gIdx: number, field: string, value: unknown) =>
    updateGlobalItemFields(secIdx, gIdx, { [field]: value });

  const picker = useMaterialPicker({ projectId: project.id, sections, setSections, products, warehouseItems, allCategories });
  const conversion = useUnitConversion({ updatePerItemFields, updateGlobalItemFields });

  const handleRemoveItemFromSection = (secIdx: number, itemId: string, prodIdOrItemIdx?: string | number, itemIdx?: number) => {
    setSections(prev => withoutSectionItem(prev, secIdx, itemId, prodIdOrItemIdx, itemIdx));
    toast.success('ماده اولیه از این بخش حذف شد.');
  };

  const handleAddNewSectionOnTheFly = () => {
    const newSec: ProjectInventoryControlSectionData = {
      id: `custom_sec_${Date.now()}`,
      title: 'بخش کنترل جدید',
      description: 'تعریف سفارشی جهت بررسی موجودی',
      checkType: 'global',
      filterType: 'all',
      globalItems: []
    };
    setSections([...sections, newSec]);
    toast.success('بخش کنترل جدید اضافه شد.');
  };

  const handleRemoveSectionOnTheFly = (secIdx: number) => {
    if (sections.length <= 1) {
      toast.error('حداقل وجود یک بخش برای کنترل الزامی است.');
      return;
    }
    setSections(sections.filter((_, idx) => idx !== secIdx));
    toast.success('بخش مورد نظر حذف شد.');
  };

  // v10.2.3 (TD-1290): موجودی آزاد هر ماده برای این پروژه و وضعیت خودکار ردیف‌ها با قاعدهٔ ثبت نهایی
  const materialItemIds = useMemo(() => projectMaterialItemIds(sections, manualPurchaseItems, warehouseItems), [sections, manualPurchaseItems, warehouseItems]);
  const availabilityRead = useProjectMaterialAvailability(project.id, materialItemIds, warehouseItemsState, projectVersion.version);
  const availability = useMemo(() => buildMaterialAvailabilityView({
    sections, products, manualPurchaseItems, stockItems: warehouseItems, report: availabilityRead.report, status: availabilityRead.status,
  }), [sections, products, manualPurchaseItems, warehouseItems, availabilityRead.report, availabilityRead.status]);

  const purchaseList = useMemo(
    () => buildConsolidatedPurchaseList(sections, products, warehouseItems, manualPurchaseItems, availability),
    [sections, products, warehouseItems, manualPurchaseItems, availability],
  );
  // overall material progress % (null until the free stock figures are read)
  const materialProgress = useMemo(() => calculateMaterialProgress(sections, products, availability), [sections, products, availability]);

  const reservation = useInventoryReservation({ project, projectVersion, sections, manualPurchaseItems, editsNow, saved: savedAsOf, onUpdate });

  const handlePrintPurchaseListWithCheck = () => {
    if (purchaseList.length === 0) {
      toast.error('هیچ کالایی برای چاپ وجود ندارد.');
      return;
    }
    window.print();
  };

  const handleAddManualPurchaseRow = () => {
    const newItem: PurchaseListItem = {
      id: `manual_${Date.now()}`,
      itemName: '',
      itemCode: '',
      category: 'اقلام دستی',
      unit: 'عدد',
      totalRequiredQty: 1,
      warehouseStockQty: 0,
      toPurchaseQty: 1,
      procurementStatus: 'pending',
      notes: ''
    };
    setManualPurchaseItems([...manualPurchaseItems, newItem]);
  };

  const handleUpdateManualPurchaseItem = (id: string, field: keyof PurchaseListItem, value: unknown) => {
    setManualPurchaseItems(prev => prev.map(item => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleRemoveManualPurchaseItem = (id: string) => {
    setManualPurchaseItems(manualPurchaseItems.filter(i => i.id !== id));
    toast.success('قلم دستی حذف شد.');
  };

  // v9.0.414 (TD-750): شناسه ردیف فهرست خرید (`code_…` / `name_…`) به ردیف‌های بخش‌ها می‌رسد و state درجا تغییر نمی‌کند؛
  // به‌روزرسانی تابعی است تا چند ردیف سفارش‌داده‌شده پشت سر هم یکدیگر را پاک نکنند
  const handleUpdateProcurementStatus = (itemId: string, newStatus: NonNullable<PurchaseListItem['procurementStatus']>) => {
    if (itemId.startsWith('manual_')) handleUpdateManualPurchaseItem(itemId, 'procurementStatus', newStatus);
    else setSections(prev => withProcurementStatus(prev, itemId, newStatus));
  };

  return {
    ...picker,
    ...conversion,
    ...reservation,
    isDirty,
    warehouseItems,
    products,
    sections,
    setSections,
    allCategories,
    handleUpdateSectionDescription,
    handleUpdatePerItemResult,
    handleUpdatePerItemFields: updatePerItemFields,
    handleUpdateGlobalItem,
    handleRemoveItemFromSection,
    handleAddNewSectionOnTheFly,
    handleRemoveSectionOnTheFly,
    purchaseList,
    materialProgress,
    availability,
    /** v10.2.3 (TD-1290): changes with each save of the project, so the materials reports are read again */
    reportsReloadKey: projectVersion.version,
    /** TD-1341 / TD-1342: نسخه و نشانهٔ بخش‌هایی که «تکمیل رزرو» با آن ثبت می‌شود */
    projectWriteBase: projectVersion.writeBase,
    handlePrintPurchaseListWithCheck,
    handleAddManualPurchaseRow,
    handleUpdateManualPurchaseItem,
    handleRemoveManualPurchaseItem,
    handleUpdateProcurementStatus,
  };
}

export type ProjectInventory = ReturnType<typeof useProjectInventory>;
