import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { confirmAction } from '../components/ConfirmDialogHost';
import { 
  ProductionProject, 
  ProjectInventoryControlSectionData, 
  Item, 
  Category, 
  PurchaseListItem, 
  ProjectProductItem 
} from '../types';
import { fetchJson } from '../api';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS } from '../constants/inventoryControlPresets';
import { 
  buildConsolidatedPurchaseList, 
  calculateMaterialProgress, 
  roundToOneDecimal,
  buildReservedItemsToFreeze
} from '../components/project/projectInventoryUtils';

export function useProjectInventory(
  project: ProductionProject,
  initialItemsList?: Item[],
  onUpdate?: () => void
) {
  const [saving, setSaving] = useState(false);
  const [activeStepTab, setActiveStepTab] = useState(0);

  const [isFinalized, setIsFinalized] = useState<boolean>(!!project.inventory_control?.isFinalized);
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>(project.inventory_control?.finalizedAt);
  const [reservedItems, setReservedItems] = useState<any[]>(() => project.inventory_control?.reservedItems || []);

  // Unit Conversion Modal state
  const [isUnitConversionModalOpen, setIsUnitConversionModalOpen] = useState(false);
  const [conversionTarget, setConversionTarget] = useState<{
    secIdx: number;
    prodId?: string;
    itemId: string;
    gIdx?: number;
    itemName: string;
    itemCode?: string;
    originalQty: number;
    originalUnit: string;
    warehouseUnit: string;
  } | null>(null);

  const [conversionForm, setConversionForm] = useState<{
    targetUnit: string;
    mode: 'rate' | 'direct';
    rate: number;
    directConvertedQty: number;
    notes: string;
  }>({
    targetUnit: '',
    mode: 'rate',
    rate: 1,
    directConvertedQty: 1,
    notes: ''
  });

  const [warehouseItems, setWarehouseItems] = useState<Item[]>(initialItemsList || []);
  const [presetSections, setPresetSections] = useState<ProjectInventoryControlSectionData[]>(DEFAULT_INVENTORY_CONTROL_SECTIONS as any);

  // Derive products list from project
  // V3.1.0 (باگ کاربر): قبلاً وقتی product_items موجود نبود، یک محصول جعلی با
  // «عنوان پروژه» به‌عنوان نام کالا ساخته می‌شد — کنترل کد به کد عملاً به
  // سطح پروژه سقوط می‌کرد. اکنون از products واقعی پروژه استفاده می‌شود و
  // fallback فقط وقتی است که کالای اصلی پروژه واقعاً مشخص باشد.
  const products: ProjectProductItem[] = useMemo(() => {
    const raw = (Array.isArray((project as unknown as { products?: unknown[] }).products) ? (project as unknown as { products: Array<Record<string, unknown>> }).products : []) as Array<Record<string, unknown>>;
    const mapped = raw.map((p, idx) => ({
      id: String(p.id ?? `prod_${p.item_id ?? idx}`),
      item_id: (p.item_id ?? null) as number | null,
      item_name: String(p.item_name ?? p.itemName ?? ''),
      item_code: String(p.item_code ?? p.itemCode ?? ''),
      customer_code: String(p.customer_code ?? ''),
      quantity: Number(p.quantity) || 1,
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
  }, [project]);

  // Main sections state
  const [sections, setSections] = useState<ProjectInventoryControlSectionData[]>(() => {
    if (project.inventory_control?.sections && project.inventory_control.sections.length > 0) {
      return project.inventory_control.sections;
    }
    return DEFAULT_INVENTORY_CONTROL_SECTIONS as any;
  });

  // Manual purchase items state
  const [manualPurchaseItems, setManualPurchaseItems] = useState<PurchaseListItem[]>(() => {
    return project.inventory_control?.manualPurchaseItems || [];
  });

  // Modal State for adding/selecting raw materials
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [materialModalSectionIdx, setMaterialModalSectionIdx] = useState<number | null>(null);
  const [materialModalTargetProdId, setMaterialModalTargetProdId] = useState<string | null>(null);
  const [materialModalTab, setMaterialModalTab] = useState<'warehouse' | 'custom'>('warehouse');
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');
  const [changingItemTarget, setChangingItemTarget] = useState<{
    secIdx: number;
    itemId: string;
    prodId?: string;
    gIdx?: number;
  } | null>(null);

  // Custom item form state
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [codePrefix, setCodePrefix] = useState<string>('');
  const [codeNumber, setCodeNumber] = useState<string>('');

  const [customMaterialForm, setCustomMaterialForm] = useState({
    name: '',
    category: '',
    itemCode: '',
    unit: 'عدد',
    stockQty: 0,
    requiredQty: 1,
    weightedAverageCost: 0,
    reorderPoint: 5,
    color: '',
    material: '',
    size: '',
    weight: 0,
    notes: ''
  });

  // Fetch items & categories on mount
  useEffect(() => {
    const controller = new AbortController();
    async function loadData() {
      try {
        const [itemsRes, catRes, settingsRes] = await Promise.all([
          fetchJson<any>('/api/items', { signal: controller.signal }),
          fetchJson<any>('/api/categories', { signal: controller.signal }),
          fetchJson<any>('/api/settings/inventory-presets', { signal: controller.signal }).catch((err) => {
            if (err?.name === 'AbortError') throw err;
            return null;
          })
        ]);

        if (itemsRes?.data && Array.isArray(itemsRes.data)) {
          setWarehouseItems(itemsRes.data);
        } else if (Array.isArray(itemsRes)) {
          setWarehouseItems(itemsRes);
        }

        if (catRes?.data && Array.isArray(catRes.data)) {
          setAllCategories(catRes.data);
        } else if (Array.isArray(catRes)) {
          setAllCategories(catRes);
        }

        if (settingsRes?.data?.sections && Array.isArray(settingsRes.data.sections)) {
          setPresetSections(settingsRes.data.sections);
          if (!project.inventory_control?.sections || project.inventory_control.sections.length === 0) {
            setSections(settingsRes.data.sections);
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Error loading inventory control prerequisites:', err);
        toast.error('خطا در دریافت اطلاعات پیش‌نیاز کنترل موجودی پروژه');
      }
    }
    loadData();
    return () => { controller.abort(); };
  }, [project.inventory_control]);

  // Sync state if project changes
  useEffect(() => {
    if (project.inventory_control?.sections && project.inventory_control.sections.length > 0) {
      setSections(project.inventory_control.sections);
    }
    if (project.inventory_control?.manualPurchaseItems) {
      setManualPurchaseItems(project.inventory_control.manualPurchaseItems);
    }
    setIsFinalized(!!project.inventory_control?.isFinalized);
    setFinalizedAt(project.inventory_control?.finalizedAt);
    setReservedItems(project.inventory_control?.reservedItems || []);
  }, [project]);

  // Category selection handler for generating item code
  const handleCategoryChangeForCustom = async (catName: string) => {
    const foundCat = allCategories.find(c => c.name === catName);
    const prefix = foundCat?.prefix || 'RAW';
    setCodePrefix(prefix);

    try {
      const res = await fetchJson<any>(`/api/items/generate-code?prefix=${prefix}`);
      if (res?.data?.codeNumber || res?.codeNumber) {
        const numStr = String(res?.data?.codeNumber || res?.codeNumber).padStart(3, '0');
        setCodeNumber(numStr);
        setCustomMaterialForm(prev => ({
          ...prev,
          category: catName,
          itemCode: `${prefix}${numStr}`
        }));
      } else {
        setCustomMaterialForm(prev => ({ ...prev, category: catName, itemCode: `${prefix}001` }));
      }
    } catch (err: any) {
      console.error('Failed to generate item code for custom material:', err);
      setCustomMaterialForm(prev => ({ ...prev, category: catName, itemCode: `${prefix}001` }));
    }
  };

  const handleUpdateSectionDescription = (secIdx: number, newDesc: string) => {
    const updated = [...sections];
    updated[secIdx] = { ...updated[secIdx], description: newDesc };
    setSections(updated);
  };

  const handleUpdatePerItemResult = (
    secIdx: number,
    prodId: string,
    itemId: string,
    field: string,
    value: any
  ) => {
    const updated = [...sections];
    const sec = { ...updated[secIdx] };
    const perRes = { ...(sec.perItemResults || {}) };
    const prodRes = { ...(perRes[prodId] || {}) };
    const itemRes = { ...(prodRes[itemId] || { itemId, status: 'available' }) };

    itemRes[field] = value;
    prodRes[itemId] = itemRes;
    perRes[prodId] = prodRes;
    sec.perItemResults = perRes;
    updated[secIdx] = sec;
    setSections(updated);
  };

  const handleUpdateGlobalItem = (
    secIdx: number,
    gIdx: number,
    field: string,
    value: any
  ) => {
    const updated = [...sections];
    const sec = { ...updated[secIdx] };
    const gItems = [...(sec.globalItems || [])];

    gItems[gIdx] = { ...gItems[gIdx], [field]: value };
    sec.globalItems = gItems;
    updated[secIdx] = sec;
    setSections(updated);
  };

  const handleOpenAddMaterialModal = (secIdx: number, prodId?: string) => {
    setMaterialModalSectionIdx(secIdx);
    setMaterialModalTargetProdId(prodId || null);
    setChangingItemTarget(null);
    setMaterialModalTab('warehouse');
    setWarehouseSearchQuery('');
    setIsMaterialModalOpen(true);
  };

  const handleOpenChangeMaterialModal = (
    secIdx: number,
    itemId: string,
    prodId?: string,
    gIdx?: number
  ) => {
    setMaterialModalSectionIdx(secIdx);
    setMaterialModalTargetProdId(prodId || null);
    setChangingItemTarget({ secIdx, itemId, prodId, gIdx });
    setMaterialModalTab('warehouse');
    setWarehouseSearchQuery('');
    setIsMaterialModalOpen(true);
  };

  const handleSelectWarehouseItem = (whItem: Item) => {
    if (materialModalSectionIdx === null) return;

    const targetSecIdx = materialModalSectionIdx;
    const targetProdId = changingItemTarget?.prodId || materialModalTargetProdId;

    if (changingItemTarget) {
      setSections(prevSections => {
        const updated = [...prevSections];
        const sec = { ...updated[changingItemTarget.secIdx] };

        if (sec.checkType === 'per_item' && changingItemTarget.prodId) {
          const perRes = { ...(sec.perItemResults || {}) };
          const prodRes = { ...(perRes[changingItemTarget.prodId] || {}) };
          const itemRes = { ...(prodRes[changingItemTarget.itemId] || { itemId: changingItemTarget.itemId }) };

          itemRes.itemCode = whItem.code;
          itemRes.name = whItem.name;
          itemRes.category = whItem.category;
          itemRes.warehouseUnit = whItem.unit;
          itemRes.unit = itemRes.unit || whItem.unit || 'عدد';
          itemRes.stockQty = whItem.current_stock;
          const req = Number(itemRes.requiredQty !== undefined ? itemRes.requiredQty : 1);
          itemRes.status = whItem.current_stock >= req ? 'available' : 'needs_procurement';

          prodRes[changingItemTarget.itemId] = itemRes as any;
          perRes[changingItemTarget.prodId] = prodRes;
          sec.perItemResults = perRes;
        } else if (sec.checkType === 'global' && changingItemTarget.gIdx !== undefined) {
          const gItems = [...(sec.globalItems || [])];
          const gItem = { ...(gItems[changingItemTarget.gIdx] || {}) };

          gItem.itemCode = whItem.code;
          gItem.name = whItem.name;
          gItem.category = whItem.category;
          gItem.warehouseUnit = whItem.unit;
          gItem.unit = gItem.unit || whItem.unit || 'عدد';
          gItem.stockQty = whItem.current_stock;
          const req = Number(gItem.requiredQty || 1);
          gItem.status = whItem.current_stock >= req ? 'available' : 'needs_procurement';

          gItems[changingItemTarget.gIdx] = gItem as any;
          sec.globalItems = gItems;
        }

        updated[changingItemTarget.secIdx] = sec;
        return updated;
      });

      toast.success(`ماده اولیه با کالا «${whItem.name}» جاپایابی و متصل شد.`);
    } else {
      // Adding a new material
      const newItemId = `item_${Date.now()}`;

      setSections(prevSections => {
        const updated = [...prevSections];
        const sec = { ...updated[targetSecIdx] };

        if (sec.checkType === 'per_item') {
          const perRes = { ...(sec.perItemResults || {}) };
          if (targetProdId) {
            // Target specific product!
            const prodRes = { ...(perRes[targetProdId] || {}) };
            prodRes[newItemId] = {
              itemId: newItemId,
              name: whItem.name,
              itemCode: whItem.code,
              category: whItem.category,
              unit: whItem.unit || 'عدد',
              warehouseUnit: whItem.unit,
              requiredQty: 1, // Decoupled from order quantity!
              stockQty: whItem.current_stock,
              status: whItem.current_stock >= 1 ? 'available' : 'needs_procurement'
            };
            perRes[targetProdId] = prodRes;
          } else {
            // Fallback if no specific product was targeted
            products.forEach(p => {
              const prodRes = { ...(perRes[p.id] || {}) };
              prodRes[newItemId] = {
                itemId: newItemId,
                name: whItem.name,
                itemCode: whItem.code,
                category: whItem.category,
                unit: whItem.unit || 'عدد',
                warehouseUnit: whItem.unit,
                requiredQty: 1,
                stockQty: whItem.current_stock,
                status: whItem.current_stock >= 1 ? 'available' : 'needs_procurement'
              };
              perRes[p.id] = prodRes;
            });
          }
          sec.perItemResults = perRes;
        } else {
          const gItems = [...(sec.globalItems || [])];
          gItems.push({
            itemId: newItemId,
            name: whItem.name,
            itemCode: whItem.code,
            category: whItem.category,
            unit: whItem.unit || 'عدد',
            warehouseUnit: whItem.unit,
            requiredQty: 1,
            stockQty: whItem.current_stock,
            status: whItem.current_stock >= 1 ? 'available' : 'needs_procurement'
          });
          sec.globalItems = gItems;
        }

        updated[targetSecIdx] = sec;
        return updated;
      });

      toast.success(`ماده اولیه «${whItem.name}» افزوده شد.`);
    }

    setIsMaterialModalOpen(false);
  };

  const handleAddCustomMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (materialModalSectionIdx === null) return;

    if (!customMaterialForm.name || !customMaterialForm.category) {
      toast.error('لطفاً عنوان و دسته‌بندی ماده اولیه را وارد نمایید.');
      return;
    }

    try {
      const newItemPayload = {
        name: customMaterialForm.name,
        category: customMaterialForm.category,
        code: customMaterialForm.itemCode,
        type: 'raw_material',
        unit: customMaterialForm.unit,
        current_stock: customMaterialForm.stockQty || 0,
        weighted_average_cost: customMaterialForm.weightedAverageCost || 0,
        reorder_point: customMaterialForm.reorderPoint || 5,
        color: customMaterialForm.color,
        material: customMaterialForm.material,
        size: customMaterialForm.size,
        notes: customMaterialForm.notes,
        is_active: 1
      };

      const res = await fetchJson<any>('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItemPayload)
      });

      const createdItem: Item = res.data || res;
      setWarehouseItems(prev => [createdItem, ...prev]);

      handleSelectWarehouseItem(createdItem);

      setCustomMaterialForm({
        name: '',
        category: '',
        itemCode: '',
        unit: 'عدد',
        stockQty: 0,
        requiredQty: 1,
        weightedAverageCost: 0,
        reorderPoint: 5,
        color: '',
        material: '',
        size: '',
        weight: 0,
        notes: ''
      });
    } catch (err) {
      console.error('Error creating custom raw material:', err);
      toast.error(err.message || 'خطا در ثبت ماده اولیه جدید');
    }
  };

  const handleRemoveItemFromSection = (
    secIdx: number,
    itemId: string,
    prodIdOrItemIdx?: string | number,
    itemIdx?: number
  ) => {
    const prodId = typeof prodIdOrItemIdx === 'string' ? prodIdOrItemIdx : undefined;
    const effectiveItemIdx = typeof prodIdOrItemIdx === 'number' ? prodIdOrItemIdx : itemIdx;

    setSections(prevSections => {
      const updated = [...prevSections];
      const sec = { ...updated[secIdx] };

      if (sec.checkType === 'per_item') {
        if (prodId) {
          const perRes = { ...(sec.perItemResults || {}) };
          const prodRes = { ...(perRes[prodId] || {}) };
          delete prodRes[itemId];
          perRes[prodId] = prodRes;
          sec.perItemResults = perRes;
        } else {
          sec.itemsSchema = (sec.itemsSchema || []).filter(i => i.id !== itemId);
          const perRes = { ...(sec.perItemResults || {}) };
          Object.keys(perRes).forEach(pId => {
            if (perRes[pId][itemId]) {
              const copy = { ...perRes[pId] };
              delete copy[itemId];
              perRes[pId] = copy;
            }
          });
          sec.perItemResults = perRes;
        }
      } else {
        if (effectiveItemIdx !== undefined) {
          sec.globalItems = (sec.globalItems || []).filter((_, idx) => idx !== effectiveItemIdx);
        } else {
          sec.globalItems = (sec.globalItems || []).filter(i => i.itemId !== itemId);
        }
      }

      updated[secIdx] = sec;
      return updated;
    });

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
    setActiveStepTab(sections.length);
    toast.success('بخش کنترل جدید اضافه شد.');
  };

  const handleRemoveSectionOnTheFly = (secIdx: number) => {
    if (sections.length <= 1) {
      toast.error('حداقل وجود یک بخش برای کنترل الزامی است.');
      return;
    }
    const updated = sections.filter((_, idx) => idx !== secIdx);
    setSections(updated);
    setActiveStepTab(Math.max(0, activeStepTab - 1));
    toast.success('بخش مورد نظر حذف شد.');
  };

  const handleOpenUnitConversionModal = (
    secIdx: number,
    itemId: string,
    prodId: string | undefined,
    gIdx: number | undefined,
    itemName: string,
    itemCode: string | undefined,
    originalQty: number,
    originalUnit: string,
    warehouseUnit: string,
    convertedUnit?: string,
    conversionRate?: number,
    convertedQty?: number
  ) => {
    setConversionTarget({
      secIdx,
      prodId,
      itemId,
      gIdx,
      itemName,
      itemCode,
      originalQty,
      originalUnit,
      warehouseUnit
    });

    setConversionForm({
      targetUnit: convertedUnit || warehouseUnit || 'ریسه',
      mode: 'rate',
      rate: conversionRate || 1,
      directConvertedQty: convertedQty || roundToOneDecimal(originalQty / (conversionRate || 1)),
      notes: ''
    });

    setIsUnitConversionModalOpen(true);
  };

  const handleApplyUnitConversion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversionTarget) return;

    const { secIdx, prodId, itemId, gIdx, originalQty } = conversionTarget;
    const { targetUnit, mode, rate, directConvertedQty } = conversionForm;

    let finalConvertedQty = 0;
    let finalRate = rate;

    if (mode === 'rate') {
      finalRate = Math.max(0.0001, rate);
      finalConvertedQty = roundToOneDecimal(originalQty / finalRate);
    } else {
      finalConvertedQty = directConvertedQty;
      finalRate = originalQty > 0 ? roundToOneDecimal(originalQty / directConvertedQty) : 1;
    }

    if (prodId) {
      handleUpdatePerItemResult(secIdx, prodId, itemId, 'convertedUnit', targetUnit);
      handleUpdatePerItemResult(secIdx, prodId, itemId, 'conversionRate', finalRate);
      handleUpdatePerItemResult(secIdx, prodId, itemId, 'convertedQty', finalConvertedQty);
    } else if (gIdx !== undefined) {
      handleUpdateGlobalItem(secIdx, gIdx, 'convertedUnit', targetUnit);
      handleUpdateGlobalItem(secIdx, gIdx, 'conversionRate', finalRate);
      handleUpdateGlobalItem(secIdx, gIdx, 'convertedQty', finalConvertedQty);
    }

    setIsUnitConversionModalOpen(false);
    toast.success(`ضریب تبدیل unit_conversion ثبت شد: ${originalQty} ${conversionTarget.originalUnit} ➔ ${finalConvertedQty} ${targetUnit}`);
  };

  const handleUpdateItemProcurementStatus = (itemId: string, newStatus: any) => {
    const updated = sections.map(sec => {
      if (sec.checkType === 'per_item' && sec.perItemResults) {
        const newPer = { ...sec.perItemResults };
        Object.keys(newPer).forEach(pId => {
          if (newPer[pId][itemId]) {
            newPer[pId][itemId] = { ...newPer[pId][itemId], procurementStatus: newStatus };
          }
        });
        return { ...sec, perItemResults: newPer };
      } else if (sec.checkType === 'global' && sec.globalItems) {
        const newG = sec.globalItems.map(g => {
          if (g.itemId === itemId || g.itemCode === itemId) {
            return { ...g, procurementStatus: newStatus };
          }
          return g;
        });
        return { ...sec, globalItems: newG };
      }
      return sec;
    });
    setSections(updated);
  };

  // Compute purchase list
  const purchaseList = useMemo(() => {
    return buildConsolidatedPurchaseList(sections, products, warehouseItems, manualPurchaseItems);
  }, [sections, products, warehouseItems, manualPurchaseItems]);

  // Compute overall material progress %
  const materialProgress = useMemo(() => {
    return calculateMaterialProgress(sections, products);
  }, [sections, products]);

  const handleFinalizeAndReserveStock = async () => {
    if (isFinalized) {
      toast.error('این لیست قبلا به نهایی رسیده و اقلام آن در انبار فریز شده‌اند.');
      return;
    }

    if (!(await confirmAction({ title: 'ثبت نهایی و فریز اقلام', message: 'آیا از ثبت نهایی و فریز اقلام رزرو شده در انبار اطمینان دارید؟ پس از ثبت نهایی، موجودی این اقلام به این پروژه اختصاص خواهد یافت.' }))) {
      return;
    }

    try {
      setSaving(true);
      const reservedItemsToFreeze = buildReservedItemsToFreeze(sections, products, warehouseItems, manualPurchaseItems);
      const nowIso = new Date().toISOString();
      const payload = {
        inventory_control: {
          sections,
          manualPurchaseItems,
          isFinalized: true,
          finalizedAt: nowIso,
          reservedItems: reservedItemsToFreeze,
          lastUpdated: nowIso
        }
      };

      await fetchJson(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setIsFinalized(true);
      setFinalizedAt(nowIso);
      setReservedItems(reservedItemsToFreeze);
      toast.success('کنترل موجودی ثبت نهایی شد و اقلام در انبار فریز گردیدند.');
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Error finalizing inventory reservation:', err);
      toast.error(err.message || 'خطا در فریز و رزرو انبار');
    } finally {
      setSaving(false);
    }
  };

  const handleUnfinalizeReservation = async () => {
    if (!(await confirmAction({ title: 'خروج از حالت فریز', message: 'آیا از خروج از حالت فریز و باز کردن قفل انبار مطمئن هستید؟' }))) return;

    try {
      setSaving(true);
      const payload = {
        inventory_control: {
          sections,
          manualPurchaseItems,
          isFinalized: false,
          reservedItems: [],
          lastUpdated: new Date().toISOString()
        }
      };

      await fetchJson(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setIsFinalized(false);
      setFinalizedAt(undefined);
      setReservedItems([]);
      toast.success('قفل فریز انبار برداشته شد.');
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Error unfreezing reservation:', err);
      toast.error(err.message || 'خطا در لغو فریز انبار');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintPurchaseListWithCheck = () => {
    if (purchaseList.length === 0) {
      toast.error('هیچ کالایی برای چاپ وجود ندارد.');
      return;
    }
    window.print();
  };

  const handleSaveInventoryControl = async () => {
    try {
      setSaving(true);
      const effectiveReserved = isFinalized
        ? buildReservedItemsToFreeze(sections, products, warehouseItems, manualPurchaseItems)
        : (reservedItems && reservedItems.length > 0 ? reservedItems : []);

      const payload = {
        inventory_control: {
          sections,
          manualPurchaseItems,
          isFinalized,
          finalizedAt,
          reservedItems: effectiveReserved,
          lastUpdated: new Date().toISOString()
        }
      };

      await fetchJson(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setReservedItems(effectiveReserved);
      toast.success('اطلاعات کنترل موجودی با موفقیت ذخیره شد.');
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Error saving project inventory control:', err);
      toast.error(err.message || 'خطا در ذخیره‌سازی کنترل موجودی پروژه');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintPurchaseList = () => {
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

  const handleUpdateManualPurchaseItem = (id: string, field: keyof PurchaseListItem, value: any) => {
    const updated = manualPurchaseItems.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    });
    setManualPurchaseItems(updated);
  };

  const handleRemoveManualPurchaseItem = (id: string) => {
    setManualPurchaseItems(manualPurchaseItems.filter(i => i.id !== id));
    toast.success('آیتم دستی حذف شد.');
  };

  const handleUpdateProcurementStatus = (itemId: string, newStatus: any) => {
    if (itemId.startsWith('manual_')) {
      handleUpdateManualPurchaseItem(itemId, 'procurementStatus', newStatus);
    } else {
      handleUpdateItemProcurementStatus(itemId, newStatus);
    }
  };

  const filteredWarehouseItems = useMemo(() => {
    // Restrict to raw materials only; exclude finished products
    let result = warehouseItems.filter(i => i.type === 'raw_material' || (i.type as any) !== 'product');
    const currentModalSection = materialModalSectionIdx !== null ? sections[materialModalSectionIdx] : undefined;

    if (currentModalSection && currentModalSection.filterType && currentModalSection.filterType !== 'all') {
      if (currentModalSection.filterType === 'category' && currentModalSection.allowedCategories && currentModalSection.allowedCategories.length > 0) {
        result = result.filter(i => i.category && currentModalSection.allowedCategories?.includes(i.category));
      } else if (currentModalSection.filterType === 'item_codes' && currentModalSection.allowedItemCodes && currentModalSection.allowedItemCodes.length > 0) {
        result = result.filter(i => i.code && currentModalSection.allowedItemCodes?.includes(i.code));
      }
    }

    if (!warehouseSearchQuery.trim()) return result.slice(0, 30);
    const q = warehouseSearchQuery.trim().toLowerCase();
    return result.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.code && i.code.toLowerCase().includes(q)) ||
      (i.category && i.category.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [warehouseItems, warehouseSearchQuery, materialModalSectionIdx, sections]);

  const currentModalSection = materialModalSectionIdx !== null ? sections[materialModalSectionIdx] : undefined;

  return {
    saving,
    setSaving,
    activeStepTab,
    setActiveStepTab,
    isFinalized,
    setIsFinalized,
    finalizedAt,
    setFinalizedAt,
    reservedItems,
    setReservedItems,
    isUnitConversionModalOpen,
    setIsUnitConversionModalOpen,
    conversionTarget,
    setConversionTarget,
    conversionForm,
    setConversionForm,
    warehouseItems,
    setWarehouseItems,
    presetSections,
    setPresetSections,
    products,
    sections,
    setSections,
    manualPurchaseItems,
    setManualPurchaseItems,
    isMaterialModalOpen,
    setIsMaterialModalOpen,
    materialModalSectionIdx,
    setMaterialModalSectionIdx,
    materialModalTab,
    setMaterialModalTab,
    warehouseSearchQuery,
    setWarehouseSearchQuery,
    changingItemTarget,
    setChangingItemTarget,
    allCategories,
    codePrefix,
    codeNumber,
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
    handleUpdateItemProcurementStatus,
    purchaseList,
    materialProgress,
    handleFinalizeAndReserveStock,
    handleUnfinalizeReservation,
    handlePrintPurchaseListWithCheck,
    handleSaveInventoryControl,
    handlePrintPurchaseList,
    handleAddManualPurchaseRow,
    handleUpdateManualPurchaseItem,
    handleRemoveManualPurchaseItem,
    handleUpdateProcurementStatus,
    filteredWarehouseItems,
    currentModalSection
  };
}
