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
  roundToOneDecimal 
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
  const products: ProjectProductItem[] = useMemo(() => {
    if (project.product_items && Array.isArray(project.product_items) && project.product_items.length > 0) {
      return project.product_items;
    }
    return [{
      id: 'prod_default',
      item_name: project.title || 'محصول اصلی سفارش',
      item_code: project.project_code,
      quantity: 1,
      unit: 'عدد',
      needs_assembly: true
    }];
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

  const handleOpenAddMaterialModal = (secIdx: number) => {
    setMaterialModalSectionIdx(secIdx);
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
    setChangingItemTarget({ secIdx, itemId, prodId, gIdx });
    setMaterialModalTab('warehouse');
    setWarehouseSearchQuery('');
    setIsMaterialModalOpen(true);
  };

  const handleSelectWarehouseItem = (whItem: Item) => {
    if (materialModalSectionIdx === null) return;

    const sec = { ...sections[materialModalSectionIdx] };

    if (changingItemTarget) {
      if (sec.checkType === 'per_item' && changingItemTarget.prodId) {
        handleUpdatePerItemResult(changingItemTarget.secIdx, changingItemTarget.prodId, changingItemTarget.itemId, 'itemCode', whItem.code);
        handleUpdatePerItemResult(changingItemTarget.secIdx, changingItemTarget.prodId, changingItemTarget.itemId, 'name', whItem.name);
        handleUpdatePerItemResult(changingItemTarget.secIdx, changingItemTarget.prodId, changingItemTarget.itemId, 'warehouseUnit', whItem.unit);
        handleUpdatePerItemResult(changingItemTarget.secIdx, changingItemTarget.prodId, changingItemTarget.itemId, 'stockQty', whItem.current_stock);
      } else if (sec.checkType === 'global' && changingItemTarget.gIdx !== undefined) {
        handleUpdateGlobalItem(changingItemTarget.secIdx, changingItemTarget.gIdx, 'itemCode', whItem.code);
        handleUpdateGlobalItem(changingItemTarget.secIdx, changingItemTarget.gIdx, 'name', whItem.name);
        handleUpdateGlobalItem(changingItemTarget.secIdx, changingItemTarget.gIdx, 'warehouseUnit', whItem.unit);
        handleUpdateGlobalItem(changingItemTarget.secIdx, changingItemTarget.gIdx, 'stockQty', whItem.current_stock);
      }
      toast.success(`ماده اولیه با کالا «${whItem.name}» جاپایابی و به روز شد.`);
    } else {
      const newItemId = `item_${Date.now()}`;
      if (sec.checkType === 'per_item') {
        const schema = sec.itemsSchema || [];
        schema.push({
          id: newItemId,
          name: whItem.name,
          itemCode: whItem.code,
          unit: whItem.unit || 'عدد'
        });
        sec.itemsSchema = schema;
      } else {
        const gItems = sec.globalItems || [];
        gItems.push({
          itemId: newItemId,
          name: whItem.name,
          itemCode: whItem.code,
          unit: whItem.unit || 'عدد',
          warehouseUnit: whItem.unit,
          requiredQty: 1,
          stockQty: whItem.current_stock,
          status: 'available'
        });
        sec.globalItems = gItems;
      }
      const updated = [...sections];
      updated[materialModalSectionIdx] = sec;
      setSections(updated);
      toast.success(`ماده اولیه «${whItem.name}» به بخش کنترل اضافه شد.`);
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

  const handleRemoveItemFromSection = (secIdx: number, itemId: string, itemIdx?: number) => {
    const updated = [...sections];
    const sec = { ...updated[secIdx] };

    if (sec.checkType === 'per_item') {
      sec.itemsSchema = (sec.itemsSchema || []).filter(i => i.id !== itemId);
    } else {
      if (itemIdx !== undefined) {
        sec.globalItems = (sec.globalItems || []).filter((_, idx) => idx !== itemIdx);
      } else {
        sec.globalItems = (sec.globalItems || []).filter(i => i.itemId !== itemId);
      }
    }

    updated[secIdx] = sec;
    setSections(updated);
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

    if (!(await confirmAction({ title: 'ثبت نهایی و فریز اقلام', message: 'آیا از ثبت نهایی و فریز اقلام رزرو شده در انبار اطمینان دارید؟ پس از ثبت نهایی، موجوی این اقلام به این پروژه اختصاص خواهد یافت.' }))) {
      return;
    }

    try {
      setSaving(true);
      const reservedItemsToFreeze: any[] = [];

      sections.forEach(sec => {
        if (sec.checkType === 'per_item' && sec.perItemResults) {
          products.forEach(prod => {
            const prodRes = sec.perItemResults?.[prod.id] || {};
            const itemsSchema = sec.itemsSchema || [];
            itemsSchema.forEach(schema => {
              const itemRes = prodRes[schema.id];
              const effectiveCode = itemRes?.itemCode || schema.itemCode || '';
              const effectiveName = itemRes?.name || schema.name;
              const reqQty = Number(itemRes?.requiredQty ?? prod.quantity ?? 100);
              const matchWh = warehouseItems.find(i => (effectiveCode && i.code === effectiveCode) || (i.name.toLowerCase() === effectiveName.toLowerCase()));

              if (matchWh && matchWh.current_stock > 0) {
                const reservedQty = Math.min(matchWh.current_stock, itemRes?.convertedQty || reqQty);
                reservedItemsToFreeze.push({
                  itemId: matchWh.id,
                  itemCode: matchWh.code,
                  itemName: matchWh.name,
                  reservedQty,
                  originalQty: reqQty,
                  unit: itemRes?.convertedUnit || matchWh.unit || 'عدد',
                  originalUnit: itemRes?.unit || 'عدد',
                  reservedAt: new Date().toISOString()
                });
              }
            });
          });
        } else if (sec.checkType === 'global' && sec.globalItems) {
          sec.globalItems.forEach(gItem => {
            const matchWh = warehouseItems.find(i => (gItem.itemCode && i.code === gItem.itemCode) || (i.name && i.name.toLowerCase().includes(gItem.name.toLowerCase())));
            const reqQty = Number(gItem.requiredQty) || 0;
            if (matchWh && matchWh.current_stock > 0) {
              const reservedQty = Math.min(matchWh.current_stock, gItem.convertedQty || reqQty);
              reservedItemsToFreeze.push({
                itemId: matchWh.id,
                itemCode: matchWh.code,
                itemName: matchWh.name,
                reservedQty,
                originalQty: reqQty,
                unit: gItem.convertedUnit || matchWh.unit || 'عدد',
                originalUnit: gItem.unit || 'عدد',
                reservedAt: new Date().toISOString()
              });
            }
          });
        }
      });

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
      const payload = {
        inventory_control: {
          sections,
          manualPurchaseItems,
          isFinalized,
          finalizedAt,
          lastUpdated: new Date().toISOString()
        }
      };

      await fetchJson(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

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
    let result = warehouseItems;
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
