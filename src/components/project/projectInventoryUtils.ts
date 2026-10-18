import { 
  ProjectInventoryControlSectionData, 
  PurchaseListItem, 
  Item, 
  ProjectProductItem 
} from '../../types';
import { findProjectItemMatch } from '../../lib/projects/projectItemMatch';
import { MATERIAL_UNITS } from '../../lib/pendingMaterials/materialRequestRules';
import { materialFiguresOf, rowIsShort, type MaterialAvailabilityView, type MaterialRowInput, type MaterialRowState } from '../../lib/projects/materialAvailability';
import { rowQtyInItemUnit } from '../../lib/projects/projectReservation';
import { fin } from '../../lib/financialDecimal';

/** v10.0.143 (TD-1202): the same unit list as the keeper's approval window (`MATERIAL_UNITS`) */
export const COMMON_UNITS = MATERIAL_UNITS;

export const roundToOneDecimal = (val: number | undefined | null): number => {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 10) / 10;
};

/**
 * v9.0.414 (TD-750، B11-16): شناسه ردیف فهرست خرید از کد ماده، وگرنه نام آن؛ ردیف‌های بخش‌ها با کد یا نام یکسان یک ردیف‌اند.
 * تغییر وضعیت تدارکات ردیف با همین شناسه به همه ردیف‌های آن در بخش‌ها می‌رسد (`withProcurementStatus`).
 */
export const purchaseRowKey = (code: string | undefined, name: string | undefined): string =>
  code ? `code_${code}` : `name_${(name || '').trim().toLowerCase()}`;

type ProcurementStatus = NonNullable<PurchaseListItem['procurementStatus']>;

/** وضعیت تدارکات همه ردیف‌های بخش‌ها که در فهرست خرید ردیف `rowKey` می‌شوند؛ بخش‌ها و ردیف‌ها کپی می‌شوند، نه تغییر درجا */
export const withProcurementStatus = (
  sections: ProjectInventoryControlSectionData[],
  rowKey: string,
  status: ProcurementStatus
): ProjectInventoryControlSectionData[] => sections.map(sec => {
  if (sec.checkType === 'per_item' && sec.perItemResults) {
    let changed = false;
    const perItemResults = Object.fromEntries(Object.entries(sec.perItemResults).map(([productId, rows]) => [
      productId,
      Object.fromEntries(Object.entries(rows || {}).map(([rowId, row]) => {
        if (!row || purchaseRowKey(row.itemCode, row.name) !== rowKey) return [rowId, row];
        changed = true;
        return [rowId, { ...row, procurementStatus: status }];
      })),
    ]));
    return changed ? { ...sec, perItemResults } : sec;
  }
  if (sec.checkType === 'global' && sec.globalItems) {
    if (!sec.globalItems.some(g => purchaseRowKey(g.itemCode, g.name) === rowKey)) return sec;
    return { ...sec, globalItems: sec.globalItems.map(g => (purchaseRowKey(g.itemCode, g.name) === rowKey ? { ...g, procurementStatus: status } : g)) };
  }
  return sec;
});

/**
 * v10.2.2 (TD-1290، یافتهٔ D1): ستون موجودی ردیف فهرست خرید «آزاد برای این پروژه» است و کسری خرید = نیاز − آزاد − آنچه
 * به پروژه داده شده، و ردیف با وضعیت خودکار ثبت نهایی (`availability`) در فهرست می‌آید. بی ارقام کارساز (`availability` نیامده،
 * در حال خواندن یا خطا) موجودی کل و قاعدهٔ پیشین به کار می‌رود و `issuedQty` خالی می‌ماند.
 */
const stockFiguresOf = (
  availability: MaterialAvailabilityView | undefined,
  row: MaterialRowInput,
  fallbackStock: number,
  storedShort: boolean
): { stock: number; issued?: number; short: boolean } => {
  const state = availability ? availability.rowState(row) : { kind: 'unknown' as const };
  const figures = materialFiguresOf(state);
  const stock = figures ? figures.free : fallbackStock;
  return { stock, issued: figures?.issued, short: rowIsShort(state, storedShort) };
};

/** کسری خرید ردیف: نیاز − موجودی (آزاد) − داده‌شده به پروژه، کمینه صفر */
const purchaseShortfall = (required: number, row: PurchaseListItem): number =>
  Math.max(0, required - (row.warehouseStockQty || 0) - (row.issuedQty || 0));

export const buildConsolidatedPurchaseList = (
  sections: ProjectInventoryControlSectionData[],
  products: ProjectProductItem[],
  warehouseItems: Item[],
  manualPurchaseItems: PurchaseListItem[],
  availability?: MaterialAvailabilityView
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

          const matchWh = findProjectItemMatch({ code: effectiveCode, name: effectiveName }, warehouseItems);

          const totalStock = matchWh ? matchWh.current_stock : (itemRes.stockQty ?? 0);
          const figures = stockFiguresOf(availability, itemRes, totalStock, itemRes.status === 'needs_procurement' || reqQty - totalStock > 0);
          const currentStock = figures.stock;

          if (figures.short) {
            const key = purchaseRowKey(effectiveCode, effectiveName);

            if (!map[key]) {
              map[key] = {
                id: key,
                itemCode: effectiveCode,
                itemName: effectiveName,
                category: itemRes.category || matchWh?.category || sec.title,
                unit: reqUnit,
                totalRequiredQty: 0,
                warehouseStockQty: currentStock,
                issuedQty: figures.issued,
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
              map[key].convertedToPurchaseQty = purchaseShortfall(map[key].convertedRequiredQty || 0, map[key]);
            }
            map[key].toPurchaseQty = purchaseShortfall(map[key].totalRequiredQty, map[key]);
          }
        });
      });
    } else if (sec.checkType === 'global' && sec.globalItems) {
      sec.globalItems.forEach(gItem => {
        // v9.0.363 (TD-749): نام دقیق، نه زیررشته؛ نام خالی هیچ کالایی را نمی‌گیرد
        const matchWh = findProjectItemMatch({ code: gItem.itemCode, name: gItem.name }, warehouseItems);
        const totalStock = matchWh ? matchWh.current_stock : (gItem.stockQty ?? 0);
        const reqQty = Number(gItem.requiredQty) || 0;
        const figures = stockFiguresOf(availability, gItem, totalStock, gItem.status === 'needs_procurement' || reqQty - totalStock > 0);
        const stQty = figures.stock;

        if (figures.short) {
          const key = purchaseRowKey(gItem.itemCode, gItem.name);

          if (!map[key]) {
            map[key] = {
              id: key,
              itemCode: gItem.itemCode || '',
              itemName: gItem.name,
              category: sec.title,
              unit: gItem.unit || 'عدد',
              totalRequiredQty: 0,
              warehouseStockQty: stQty,
              issuedQty: figures.issued,
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
            map[key].convertedToPurchaseQty = purchaseShortfall(map[key].convertedRequiredQty || 0, map[key]);
          }
          map[key].toPurchaseQty = purchaseShortfall(map[key].totalRequiredQty, map[key]);
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

type GlobalItem = NonNullable<ProjectInventoryControlSectionData['globalItems']>[number];

interface SectionItemGroup {
  key: string;
  rows: number[];
  first: GlobalItem;
  match: Item | undefined;
  states: MaterialRowState[];
  /** نیاز ردیف‌های بخش به واحد کالا با قاعدهٔ ثبت نهایی (ردیف بی تبدیل معتبر شمرده نمی‌شود) */
  itemQty: number;
  /** نیاز ردیف‌ها به واحد خودشان، قاعدهٔ پیشین فرم (مقدار خالی یک است) */
  rowQty: number;
  /** موجودی کل کالا (وگرنه موجودی ذخیره‌شدهٔ نخستین ردیف) برای قاعدهٔ پیشین */
  totalStock: number;
  /** ردیفی با وضعیت ذخیره‌شدهٔ «نیاز به خرید» */
  storedNeeds: boolean;
}

/**
 * v10.2.2 (TD-1290، بررسی بستهٔ ۳): «ثبت سفارش خرید» یک بخش کنترل کلی. ردیف‌های بخش به ازای کالای انبار (وگرنه کد یا نام)
 * یکی می‌شوند تا ردیف‌های تکراری یک کالا هر کدام همهٔ موجودی آزاد را جدا نشمارند. با ارقام کارساز مقدار خرید کالای کسری
 * کمینهٔ کسری کل پروژهٔ آن کالا (`shortQty` ثبت نهایی) و نیاز همین بخش است، به واحد کالا، پس بخش بیش از کسری پروژه سفارش
 * نمی‌دهد. بی ارقام کارساز (در حال خواندن، خطا، بی کالای انبار یا تبدیل واحد لازم) قاعدهٔ پیشین: نیاز گروه − موجودی − داده‌شده.
 */
export function buildSectionPurchaseList(
  sec: ProjectInventoryControlSectionData | undefined,
  secIdx: number,
  warehouseItems: Item[],
  availability: MaterialAvailabilityView
): PurchaseListItem[] {
  const groups = new Map<string, SectionItemGroup>();
  (sec?.globalItems || []).forEach((item, gIdx) => {
    const match = findProjectItemMatch({ code: item.itemCode, name: item.name }, warehouseItems);
    const key = match ? `item_${match.id}` : purchaseRowKey(item.itemCode, item.name);
    const group: SectionItemGroup = groups.get(key) ?? {
      key, rows: [], first: item, match, states: [], itemQty: 0, rowQty: 0,
      totalStock: match ? Number(match.current_stock || 0) : Number(item.stockQty || 0), storedNeeds: false,
    };
    const state = availability.rowState(item);
    const rowQty = Number(item.requiredQty || 1);
    const inItemUnit = match ? rowQtyInItemUnit(item, Number(item.requiredQty) || 0, match.unit) : null;
    group.rows.push(gIdx);
    group.states.push(state);
    group.rowQty = fin(group.rowQty).add(rowQty).toNumber();
    if (inItemUnit !== null && inItemUnit > 0) group.itemQty = fin(group.itemQty).add(inItemUnit).toNumber();
    if (item.status === 'needs_procurement') group.storedNeeds = true;
    groups.set(key, group);
  });

  const lines: PurchaseListItem[] = [];
  for (const g of groups.values()) {
    const { first, match } = g;
    const base = {
      id: `sec${secIdx}_g${g.rows.join('-')}_${g.key}`,
      itemCode: first.itemCode || match?.code || '',
      itemName: first.name || match?.name || '',
      category: sec?.title || 'بخش کنترل',
      procurementStatus: first.procurementStatus || 'pending',
      notes: first.notes,
    };
    const short = g.states.find((s): s is Extract<MaterialRowState, { kind: 'short' }> => s.kind === 'short');
    if (short) {
      const qty = Math.min(short.shortQty, g.itemQty);
      if (qty > 0) {
        lines.push({
          ...base, totalRequiredQty: g.itemQty, unit: short.unit, warehouseStockQty: short.free, issuedQty: short.issued,
          warehouseUnit: match?.unit || short.unit, toPurchaseQty: qty,
        });
      }
      continue;
    }
    // قاعدهٔ پیشین روی کل گروه: نیاز همهٔ ردیف‌های کالا در برابر موجودی کل، یا وضعیت ذخیره‌شده
    const legacyShort = g.storedNeeds || g.rowQty - g.totalStock > 0;
    if (!g.states.some(s => rowIsShort(s, legacyShort))) continue;
    const figures = materialFiguresOf(g.states[0]);
    const stock = figures ? figures.free : match ? Number(match.current_stock || 0) : Number(first.stockQty || 0);
    const issued = figures?.issued ?? 0;
    const qty = Math.max(0, fin(g.rowQty).subtract(stock).subtract(issued).toNumber());
    if (qty > 0) {
      lines.push({
        ...base, totalRequiredQty: g.rowQty, unit: first.unit || match?.unit || 'عدد', warehouseStockQty: stock, issuedQty: figures?.issued,
        warehouseUnit: match?.unit || first.unit, toPurchaseQty: qty,
      });
    }
  }
  return lines;
}

/** ردیف‌های بخش یک قلم «ثبت سفارش خرید» بخش، از شناسهٔ آن */
export function sectionPurchaseRows(lineId: string): { secIdx: number; rows: number[] } | null {
  const m = /^sec(\d+)_g(\d+(?:-\d+)*)_/.exec(lineId);
  return m ? { secIdx: Number(m[1]), rows: m[2].split('-').map(Number) } : null;
}

/**
 * درصد ردیف‌های موجود. v10.2.2 (TD-1290): با `availability` «موجود» وضعیت خودکار ثبت نهایی است، نه وضعیت ذخیره‌شده، و تا
 * ارقام کارساز نرسیده (در حال خواندن یا خطا) درصدی نیست (null). بی `availability` قاعدهٔ پیشین.
 */
export function calculateMaterialProgress(sections: ProjectInventoryControlSectionData[], products: ProjectProductItem[]): number;
export function calculateMaterialProgress(sections: ProjectInventoryControlSectionData[], products: ProjectProductItem[], availability: MaterialAvailabilityView): number | null;
export function calculateMaterialProgress(
  sections: ProjectInventoryControlSectionData[],
  products: ProjectProductItem[],
  availability?: MaterialAvailabilityView
): number | null {
  if (availability && availability.status !== 'ready') return null;
  const isAvailable = (row: (MaterialRowInput & { status?: string }) | undefined): boolean => {
    if (!row) return false;
    return availability ? availability.rowState(row).kind === 'available' : row.status === 'available';
  };
  let totalItems = 0;
  let fulfilledItems = 0;

  sections.forEach(sec => {
    if (sec.checkType === 'per_item' && sec.perItemResults) {
      products.forEach(prod => {
        const prodRes = sec.perItemResults?.[prod.id];
        let itemsToProcess: Array<MaterialRowInput & { status?: string }> = [];

        if (prodRes && Object.keys(prodRes).length > 0) {
          itemsToProcess = Object.values(prodRes);
        } else if (sec.itemsSchema && sec.itemsSchema.length > 0) {
          itemsToProcess = sec.itemsSchema.map(s => ({ itemCode: s.itemCode, name: s.name, unit: s.unit, status: 'available' }));
        }

        itemsToProcess.forEach(itemRes => {
          totalItems++;
          if (isAvailable(itemRes)) {
            fulfilledItems++;
          }
        });
      });
    } else if (sec.checkType === 'global' && sec.globalItems) {
      sec.globalItems.forEach(gItem => {
        totalItems++;
        if (isAvailable(gItem)) {
          fulfilledItems++;
        }
      });
    }
  });

  if (totalItems === 0) return 100;
  return Math.round((fulfilledItems / totalItems) * 100);
}
