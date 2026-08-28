import { 
  ProjectInventoryControlSectionData, 
  PurchaseListItem, 
  Item, 
  ProjectProductItem 
} from '../../types';

export const COMMON_UNITS = [
  'عدد', 'ریسه', 'برگ', 'کیلوگرم', 'متر', 'کارتن', 'ورق', 'رول', 'پک', 'لیتر', 'پارت', 'بسته', 'شاخه', 'طغره'
];

export const roundToOneDecimal = (val: number | undefined | null): number => {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 10) / 10;
};

export const buildConsolidatedPurchaseList = (
  sections: ProjectInventoryControlSectionData[],
  products: ProjectProductItem[],
  warehouseItems: Item[],
  manualPurchaseItems: PurchaseListItem[]
): PurchaseListItem[] => {
  const map: Record<string, PurchaseListItem> = {};

  sections.forEach(sec => {
    if (sec.checkType === 'per_item' && sec.perItemResults) {
      products.forEach(prod => {
        const prodRes = sec.perItemResults?.[prod.id] || {};
        const itemsSchema = sec.itemsSchema || [{ id: 'item_default', name: 'ماده اولیه', unit: 'عدد' }];

        itemsSchema.forEach(itemSchema => {
          const itemRes = prodRes[itemSchema.id];
          const reqQty = Number(itemRes?.requiredQty ?? prod.quantity ?? 100);
          const reqUnit = itemRes?.unit || itemSchema.unit || 'عدد';

          const effectiveCode = itemRes?.itemCode || itemSchema.itemCode || '';
          const effectiveName = itemRes?.name || itemSchema.name;

          const matchWh = warehouseItems.find(i => 
            (effectiveCode && i.code === effectiveCode) ||
            (i.name.toLowerCase() === effectiveName.toLowerCase())
          );

          const currentStock = matchWh ? matchWh.current_stock : (itemRes?.stockQty ?? 0);
          const shortfall = Math.max(0, reqQty - currentStock);

          if (itemRes && (itemRes.status === 'needs_procurement' || shortfall > 0)) {
            const key = effectiveCode ? `code_${effectiveCode}` : `name_${effectiveName.trim().toLowerCase()}`;

            if (!map[key]) {
              map[key] = {
                id: key,
                itemCode: effectiveCode,
                itemName: effectiveName,
                category: sec.title,
                unit: reqUnit,
                totalRequiredQty: 0,
                warehouseStockQty: currentStock,
                warehouseUnit: matchWh?.unit || itemRes?.warehouseUnit || reqUnit,
                convertedRequiredQty: itemRes?.convertedQty ? roundToOneDecimal(itemRes.convertedQty) : undefined,
                convertedUnit: itemRes?.convertedUnit,
                conversionRate: itemRes?.conversionRate,
                toPurchaseQty: 0,
                procurementStatus: itemRes?.procurementStatus || 'pending',
                notes: itemRes?.notes || ''
              };
            }

            map[key].totalRequiredQty += reqQty;
            if (itemRes?.convertedQty) {
              map[key].convertedRequiredQty = (map[key].convertedRequiredQty || 0) + roundToOneDecimal(itemRes.convertedQty);
              map[key].convertedToPurchaseQty = Math.max(0, (map[key].convertedRequiredQty || 0) - (map[key].warehouseStockQty || 0));
            }
            map[key].toPurchaseQty = Math.max(0, map[key].totalRequiredQty - map[key].warehouseStockQty);
          }
        });
      });
    } else if (sec.checkType === 'global' && sec.globalItems) {
      sec.globalItems.forEach(gItem => {
        const matchWh = warehouseItems.find(i => 
          (gItem.itemCode && i.code === gItem.itemCode) ||
          (i.name && i.name.toLowerCase().includes(gItem.name.toLowerCase()))
        );
        const stQty = matchWh ? matchWh.current_stock : (gItem.stockQty ?? 0);
        const reqQty = Number(gItem.requiredQty) || 0;
        const shortfall = Math.max(0, reqQty - stQty);

        if (gItem.status === 'needs_procurement' || shortfall > 0) {
          const key = gItem.itemCode ? `code_${gItem.itemCode}` : `name_${gItem.name.trim().toLowerCase()}`;

          if (!map[key]) {
            map[key] = {
              id: key,
              itemCode: gItem.itemCode,
              itemName: gItem.name,
              category: sec.title,
              unit: gItem.unit || 'عدد',
              totalRequiredQty: 0,
              warehouseStockQty: stQty,
              warehouseUnit: matchWh?.unit || gItem.warehouseUnit || gItem.unit,
              convertedRequiredQty: gItem.convertedQty ? roundToOneDecimal(gItem.convertedQty) : undefined,
              convertedUnit: gItem.convertedUnit,
              conversionRate: gItem.conversionRate,
              toPurchaseQty: 0,
              procurementStatus: gItem.procurementStatus || 'pending',
              notes: gItem.notes || ''
            };
          }

          map[key].totalRequiredQty += reqQty;
          if (gItem.convertedQty) {
            map[key].convertedRequiredQty = (map[key].convertedRequiredQty || 0) + roundToOneDecimal(gItem.convertedQty);
            map[key].convertedToPurchaseQty = Math.max(0, (map[key].convertedRequiredQty || 0) - (map[key].warehouseStockQty || 0));
          }
          map[key].toPurchaseQty = Math.max(0, map[key].totalRequiredQty - map[key].warehouseStockQty);
        }
      });
    }
  });

  const listFromSections = Object.values(map);

  const manualProcessed = (manualPurchaseItems || []).map(mItem => ({
    ...mItem,
    toPurchaseQty: Math.max(0, (mItem.totalRequiredQty || 0) - (mItem.warehouseStockQty || 0))
  }));

  return [...listFromSections, ...manualProcessed];
};

export const calculateMaterialProgress = (
  sections: ProjectInventoryControlSectionData[],
  products: ProjectProductItem[]
): number => {
  let totalItems = 0;
  let fulfilledItems = 0;

  sections.forEach(sec => {
    if (sec.checkType === 'per_item' && sec.perItemResults) {
      products.forEach(prod => {
        const prodRes = sec.perItemResults?.[prod.id] || {};
        const itemsSchema = sec.itemsSchema || [{ id: 'item_default', name: 'ماده اولیه', unit: 'عدد' }];

        itemsSchema.forEach(itemSchema => {
          totalItems++;
          const itemRes = prodRes[itemSchema.id];
          if (itemRes && itemRes.status === 'available') {
            fulfilledItems++;
          }
        });
      });
    } else if (sec.checkType === 'global' && sec.globalItems) {
      sec.globalItems.forEach(gItem => {
        totalItems++;
        if (gItem.status === 'available') {
          fulfilledItems++;
        }
      });
    }
  });

  if (totalItems === 0) return 100;
  return Math.round((fulfilledItems / totalItems) * 100);
};
