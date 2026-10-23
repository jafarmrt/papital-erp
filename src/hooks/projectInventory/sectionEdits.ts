import type { Item, ProjectInventoryControlItemResult, ProjectInventoryControlSectionData, ProjectProductItem } from '../../types';
import { NEW_ROW_QTY_PER_UNIT, perItemRowRequiredQty, perUnitRowFields, productOrderQuantity } from '../../lib/projects/materialQuantity';

/**
 * The edits of the materials tab's sections, each a new array from the previous one (functional updates, v10.0.105
 * TD-1212: several fields set one after another all survive). 10.3 (ARCH review finding 3, part 11): moved out of
 * `useProjectInventory` unchanged.
 */
type Sections = ProjectInventoryControlSectionData[];
type ItemPatch = Partial<ProjectInventoryControlItemResult>;

/** a material row picked to be changed: a product's row (`prodId`) or a global row (`gIdx`) */
export interface MaterialRowTarget {
  secIdx: number;
  itemId: string;
  prodId?: string;
  gIdx?: number;
}

const withSection = (sections: Sections, secIdx: number, edit: (sec: ProjectInventoryControlSectionData) => void): Sections => {
  const updated = [...sections];
  const sec = { ...updated[secIdx] };
  edit(sec);
  updated[secIdx] = sec;
  return updated;
};

export const withPerItemFields = (sections: Sections, secIdx: number, prodId: string, itemId: string, patch: ItemPatch): Sections =>
  withSection(sections, secIdx, sec => {
    const perRes = { ...(sec.perItemResults || {}) };
    const prodRes = { ...(perRes[prodId] || {}) };
    prodRes[itemId] = { ...(prodRes[itemId] || { itemId, status: 'available' }), ...patch } as ProjectInventoryControlItemResult;
    perRes[prodId] = prodRes;
    sec.perItemResults = perRes;
  });

export const withGlobalItemFields = (sections: Sections, secIdx: number, gIdx: number, patch: ItemPatch): Sections =>
  withSection(sections, secIdx, sec => {
    const gItems = [...(sec.globalItems || [])];
    gItems[gIdx] = { ...gItems[gIdx], ...patch };
    sec.globalItems = gItems;
  });

/** the warehouse item's fields on a row it is linked to; the row's own unit stays when it has one */
const linkedFields = (row: Partial<ProjectInventoryControlItemResult>, whItem: Item) => ({
  itemCode: whItem.code,
  name: whItem.name,
  category: whItem.category,
  warehouseUnit: whItem.unit,
  unit: row.unit || whItem.unit || 'عدد',
  stockQty: whItem.current_stock,
});

const stockStatus = (stock: number, required: number): ProjectInventoryControlItemResult['status'] =>
  stock >= required ? 'available' : 'needs_procurement';

/** a row picked to be changed now names the warehouse item, its stock status against what the row needs */
export const withLinkedWarehouseItem = (sections: Sections, target: MaterialRowTarget, whItem: Item, products: readonly ProjectProductItem[]): Sections =>
  withSection(sections, target.secIdx, sec => {
    if (sec.checkType === 'per_item' && target.prodId) {
      const perRes = { ...(sec.perItemResults || {}) };
      const prodRes = { ...(perRes[target.prodId] || {}) };
      const row = { ...(prodRes[target.itemId] || { itemId: target.itemId }) };
      const linked = { ...row, ...linkedFields(row, whItem) } as ProjectInventoryControlItemResult;
      const req = perItemRowRequiredQty(linked, productOrderQuantity(products.find(p => p.id === target.prodId)));
      prodRes[target.itemId] = { ...linked, status: stockStatus(whItem.current_stock, req) };
      perRes[target.prodId] = prodRes;
      sec.perItemResults = perRes;
    } else if (sec.checkType === 'global' && target.gIdx !== undefined) {
      const gItems = [...(sec.globalItems || [])];
      const row = { ...(gItems[target.gIdx] || {}) };
      const req = Number(row.requiredQty || 1);
      gItems[target.gIdx] = { ...row, ...linkedFields(row, whItem), status: stockStatus(whItem.current_stock, req) } as ProjectInventoryControlItemResult;
      sec.globalItems = gItems;
    }
  });

/** a new row of a product's materials: one per unit of the product (TD-1343) */
const newPerUnitRow = (itemId: string, whItem: Item, product: ProjectProductItem | undefined): ProjectInventoryControlItemResult => {
  const qty = perUnitRowFields(NEW_ROW_QTY_PER_UNIT, productOrderQuantity(product));
  return {
    itemId,
    name: whItem.name,
    itemCode: whItem.code,
    category: whItem.category,
    unit: whItem.unit || 'عدد',
    warehouseUnit: whItem.unit,
    ...qty,
    stockQty: whItem.current_stock,
    status: stockStatus(whItem.current_stock, qty.requiredQty),
  };
};

/** a warehouse item added to a section: to one product's rows, to every product's when none is named, or as a global row */
export const withAddedWarehouseItem = (
  sections: Sections, secIdx: number, prodId: string | null, whItem: Item, products: readonly ProjectProductItem[], newItemId: string,
): Sections =>
  withSection(sections, secIdx, sec => {
    if (sec.checkType === 'per_item') {
      const perRes = { ...(sec.perItemResults || {}) };
      const targets = prodId ? [prodId] : products.map(p => p.id);
      for (const id of targets) {
        perRes[id] = { ...(perRes[id] || {}), [newItemId]: newPerUnitRow(newItemId, whItem, products.find(p => p.id === id)) };
      }
      sec.perItemResults = perRes;
    } else {
      sec.globalItems = [...(sec.globalItems || []), {
        itemId: newItemId,
        name: whItem.name,
        itemCode: whItem.code,
        category: whItem.category,
        unit: whItem.unit || 'عدد',
        warehouseUnit: whItem.unit,
        requiredQty: 1,
        stockQty: whItem.current_stock,
        status: stockStatus(whItem.current_stock, 1),
      }];
    }
  });

/**
 * a material taken out of a section: one product's row (`prodId`), the row of every product (a per-item schema row), or a
 * global row by its index, else by its id
 */
export const withoutSectionItem = (sections: Sections, secIdx: number, itemId: string, prodIdOrItemIdx?: string | number, itemIdx?: number): Sections => {
  const prodId = typeof prodIdOrItemIdx === 'string' ? prodIdOrItemIdx : undefined;
  const effectiveItemIdx = typeof prodIdOrItemIdx === 'number' ? prodIdOrItemIdx : itemIdx;
  return withSection(sections, secIdx, sec => {
    if (sec.checkType !== 'per_item') {
      sec.globalItems = effectiveItemIdx !== undefined
        ? (sec.globalItems || []).filter((_, idx) => idx !== effectiveItemIdx)
        : (sec.globalItems || []).filter(i => i.itemId !== itemId);
      return;
    }
    const perRes = { ...(sec.perItemResults || {}) };
    if (prodId) {
      const prodRes = { ...(perRes[prodId] || {}) };
      delete prodRes[itemId];
      perRes[prodId] = prodRes;
    } else {
      sec.itemsSchema = (sec.itemsSchema || []).filter(i => i.id !== itemId);
      for (const pId of Object.keys(perRes)) {
        if (perRes[pId][itemId]) {
          const copy = { ...perRes[pId] };
          delete copy[itemId];
          perRes[pId] = copy;
        }
      }
    }
    sec.perItemResults = perRes;
  });
};
