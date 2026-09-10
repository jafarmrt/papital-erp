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
        const prodRes = sec.perItemResults?.[prod.id];
        let itemsToProcess: Array<{
          itemId: string;
          itemCode?: string;
          name: string;
          category?: string;
          unit?: string;
          warehouseUnit?: string;
          requiredQty?: number;
          stockQty?: number;
          status?: 'available' | 'needs_procurement' | 'not_applicable';
          convertedQty?: number;
          convertedUnit?: string;
          conversionRate?: number;
          procurementStatus?: 'pending' | 'reserved' | 'in_progress' | 'fulfilled';
          notes?: string;
        }> = [];

        if (prodRes && Object.keys(prodRes).length > 0) {
          itemsToProcess = Object.values(prodRes);
        } else if (sec.itemsSchema && sec.itemsSchema.length > 0) {
          itemsToProcess = sec.itemsSchema.map(s => ({
            itemId: s.id,
            itemCode: s.itemCode,
            name: s.name,
            unit: s.unit || 'عدد',
            requiredQty: 1,
            status: 'available'
          }));
        }

        itemsToProcess.forEach(itemRes => {
          const effectiveCode = itemRes.itemCode || '';
          const effectiveName = itemRes.name || '';
          if (!effectiveName && !effectiveCode) return;

          const reqQty = Number(itemRes.requiredQty !== undefined ? itemRes.requiredQty : 1);
          const reqUnit = itemRes.unit || 'عدد';

          const matchWh = warehouseItems.find(i => 
            (effectiveCode && i.code === effectiveCode) ||
            (i.name && effectiveName && i.name.toLowerCase() === effectiveName.toLowerCase())
          );

          const currentStock = matchWh ? matchWh.current_stock : (itemRes.stockQty ?? 0);
          const shortfall = Math.max(0, reqQty - currentStock);

          if (itemRes.status === 'needs_procurement' || shortfall > 0) {
            const key = effectiveCode ? `code_${effectiveCode}` : `name_${effectiveName.trim().toLowerCase()}`;

            if (!map[key]) {
              map[key] = {
                id: key,
                itemCode: effectiveCode,
                itemName: effectiveName,
                category: itemRes.category || matchWh?.category || sec.title,
                unit: reqUnit,
                totalRequiredQty: 0,
                warehouseStockQty: currentStock,
                warehouseUnit: matchWh?.unit || itemRes.warehouseUnit || reqUnit,
                convertedRequiredQty: itemRes.convertedQty ? roundToOneDecimal(itemRes.convertedQty) : undefined,
                convertedUnit: itemRes.convertedUnit,
                conversionRate: itemRes.conversionRate,
                toPurchaseQty: 0,
                procurementStatus: itemRes.procurementStatus || 'pending',
                notes: itemRes.notes || ''
              };
            }

            map[key].totalRequiredQty += reqQty;
            if (itemRes.convertedQty) {
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
        const prodRes = sec.perItemResults?.[prod.id];
        let itemsToProcess: Array<{ status?: string }> = [];

        if (prodRes && Object.keys(prodRes).length > 0) {
          itemsToProcess = Object.values(prodRes);
        } else if (sec.itemsSchema && sec.itemsSchema.length > 0) {
          itemsToProcess = sec.itemsSchema.map(() => ({ status: 'available' }));
        }

        itemsToProcess.forEach(itemRes => {
          totalItems++;
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

export function buildReservedItemsToFreeze(
  sections: ProjectInventoryControlSectionData[],
  products: ProjectProductItem[],
  warehouseItems: Item[],
  manualPurchaseItems: PurchaseListItem[] = []
): Array<{
  itemId?: number;
  itemCode: string;
  itemName: string;
  category?: string;
  reservedQty: number;
  originalQty: number;
  unit: string;
  originalUnit?: string;
  reservedAt: string;
}> {
  const itemTotals = new Map<string, {
    itemCode: string;
    itemName: string;
    category?: string;
    unit: string;
    totalRequiredQty: number;
  }>();

  sections.forEach(sec => {
    if (sec.checkType === 'per_item' && sec.perItemResults) {
      products.forEach(prod => {
        const prodRes = sec.perItemResults?.[prod.id] || {};
        const itemsToProcess = Object.keys(prodRes).length > 0
          ? Object.values(prodRes)
          : (sec.itemsSchema || []).map(schema => ({
              itemId: schema.id,
              itemCode: schema.itemCode,
              name: schema.name,
              unit: schema.unit || 'عدد',
              requiredQty: 1
            }));

        itemsToProcess.forEach(itemRes => {
          const effectiveCode = (itemRes?.itemCode || '').trim();
          const effectiveName = (itemRes?.name || '').trim();
          if (!effectiveCode && !effectiveName) return;
          const reqQty = Number(itemRes?.requiredQty !== undefined ? itemRes.requiredQty : 1);
          if (reqQty <= 0) return;

          const key = effectiveCode ? `C_${effectiveCode.toUpperCase()}` : `N_${effectiveName.toLowerCase()}`;
          const cur = itemTotals.get(key) || {
            itemCode: effectiveCode,
            itemName: effectiveName,
            category: itemRes.category || sec.title,
            unit: itemRes.unit || 'عدد',
            totalRequiredQty: 0
          };
          cur.totalRequiredQty += reqQty;
          itemTotals.set(key, cur);
        });
      });
    } else if (sec.checkType === 'global' && sec.globalItems) {
      sec.globalItems.forEach(gItem => {
        const effectiveCode = (gItem.itemCode || '').trim();
        const effectiveName = (gItem.name || '').trim();
        if (!effectiveCode && !effectiveName) return;
        const reqQty = Number(gItem.requiredQty || 0);
        if (reqQty <= 0) return;

        const key = effectiveCode ? `C_${effectiveCode.toUpperCase()}` : `N_${effectiveName.toLowerCase()}`;
        const cur = itemTotals.get(key) || {
          itemCode: effectiveCode,
          itemName: effectiveName,
          category: gItem.category || sec.title,
          unit: gItem.unit || 'عدد',
          totalRequiredQty: 0
        };
        cur.totalRequiredQty += reqQty;
        itemTotals.set(key, cur);
      });
    }
  });

  (manualPurchaseItems || []).forEach(mItem => {
    if (mItem && (mItem.procurementStatus === 'reserved' || mItem.toPurchaseQty === 0)) {
      const effectiveCode = (mItem.itemCode || '').trim();
      const effectiveName = (mItem.itemName || '').trim();
      if (!effectiveCode && !effectiveName) return;
      const reqQty = Number(mItem.totalRequiredQty || 0);
      if (reqQty <= 0) return;

      const key = effectiveCode ? `C_${effectiveCode.toUpperCase()}` : `N_${effectiveName.toLowerCase()}`;
      const cur = itemTotals.get(key) || {
        itemCode: effectiveCode,
        itemName: effectiveName,
        category: mItem.category || 'اقلام دستی',
        unit: mItem.unit || 'عدد',
        totalRequiredQty: 0
      };
      cur.totalRequiredQty += reqQty;
      itemTotals.set(key, cur);
    }
  });

  const nowIso = new Date().toISOString();
  const reservedList: Array<{
    itemId?: number;
    itemCode: string;
    itemName: string;
    category?: string;
    reservedQty: number;
    originalQty: number;
    unit: string;
    originalUnit?: string;
    reservedAt: string;
  }> = [];

  itemTotals.forEach((tot) => {
    const matchWh = warehouseItems.find(i => 
      (tot.itemCode && i.code && i.code.trim().toUpperCase() === tot.itemCode.toUpperCase()) ||
      (tot.itemName && i.name && i.name.trim().toLowerCase() === tot.itemName.toLowerCase())
    );

    if (matchWh && matchWh.current_stock > 0) {
      const reservedQty = Math.min(matchWh.current_stock, tot.totalRequiredQty);
      if (reservedQty > 0) {
        reservedList.push({
          itemId: matchWh.id,
          itemCode: matchWh.code || tot.itemCode,
          itemName: matchWh.name || tot.itemName,
          category: matchWh.category || tot.category,
          reservedQty,
          originalQty: tot.totalRequiredQty,
          unit: matchWh.unit || tot.unit || 'عدد',
          originalUnit: tot.unit || 'عدد',
          reservedAt: nowIso
        });
      }
    }
  });

  return reservedList;
}
