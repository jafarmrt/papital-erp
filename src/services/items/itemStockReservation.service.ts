import { sql, eq, and, or, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, warehouses, productionProjects, documents, documentItems } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';

export interface ReservedItemDetail {
  id: string;
  sourceType: 'proforma' | 'project';
  sourceLabel: string;
  sourceId: number;
  sourceRef: string;
  sourceTitle: string;
  buyerOrCustomer: string;
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  reservedQty: number;
  unitPrice: number;
  totalValue: number;
  date: string;
}

export interface ItemReservedReportSummary {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  buyPrice: number;
  sellPrice: number;
  proformaReservedQty: number;
  projectReservedQty: number;
  totalReservedQty: number;
  availableStock: number;
  totalReservedValue: number;
  reservations: ReservedItemDetail[];
}

export interface ReservedItemsFullReport {
  summaryMetrics: {
    totalReservedItemsCount: number;
    totalReservedQty: number;
    totalReservedValue: number;
    proformaReservationsCount: number;
    projectReservationsCount: number;
  };
  itemSummaries: ItemReservedReportSummary[];
  allReservationEntries: ReservedItemDetail[];
}

export interface ReservedStockInfo {
  totalReserved: number;
  reservations: Array<{
    projectId: number;
    projectCode: string;
    projectTitle: string;
    reservedQty: number;
    unit: string;
  }>;
}

interface InventoryControlItem {
  itemCode?: string;
  code?: string;
  convertedReservedQty?: number;
  convertedQty?: number;
  reservedQty?: number;
  warehouseStockQty?: number;
  stockQty?: number;
  itemId?: number | string;
  unitPrice?: number;
  itemName?: string;
  name?: string;
  category?: string;
  convertedUnit?: string;
  warehouseUnit?: string;
  unit?: string;
}

interface InventoryControlData {
  isFinalized?: boolean;
  isReserved?: boolean;
  reservedItems?: InventoryControlItem[];
  purchaseList?: InventoryControlItem[];
  sections?: any[];
  manualPurchaseItems?: any[];
}

export class ItemStockReservationService {
  /**
   * Auto-sync function to fix any existing items where current_stock > 0 but warehouse stocks sum to 0
   */
  static async syncMissingWarehouseStocks(): Promise<void> {
    try {
      const activeWHs = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1));
      if (activeWHs.length === 0) {
        return;
      }
      const defaultWhCode = activeWHs[0].code;

      const itemsToFix = await orm.execute(sql`
        SELECT id, current_stock, stocks
        FROM ${items}
        WHERE is_deleted = 0 AND current_stock > 0
      `);

      for (const row of itemsToFix.rows) {
        const id = Number(row.id);
        const currentStock = Number(row.current_stock || 0);
        const stocksObj = (row.stocks as Record<string, number>) || {};

        const totalWhStock = Object.values(stocksObj).reduce((sum, v) => sum + (Number(v) || 0), 0);
        if (totalWhStock === 0 && currentStock > 0) {
          stocksObj[defaultWhCode] = currentStock;
          await orm.update(items)
            .set({ stocks: stocksObj })
            .where(eq(items.id, id));
        }
      }
    } catch (err) {
      logger.error({ message: 'Error syncing missing warehouse stocks', error: err });
    }
  }

  /**
   * Derive reserved items for a project's inventory control bounded by warehouse stock.
   */
  static deriveProjectReservedItems(
    invControl: InventoryControlData | null | undefined,
    itemsByCodeMap: Map<string, any>,
    itemsByNameMap: Map<string, any>,
    itemsByIdMap: Map<number, any>
  ): any[] {
    if (!invControl) return [];

    if (Array.isArray(invControl.reservedItems) && invControl.reservedItems.length > 0) {
      return invControl.reservedItems;
    }
    if (Array.isArray(invControl.purchaseList) && invControl.purchaseList.length > 0) {
      return invControl.purchaseList;
    }
    if (!invControl.isFinalized && !invControl.isReserved && (!invControl.sections || invControl.sections.length === 0)) {
      return [];
    }

    const itemsList: any[] = [];
    if (Array.isArray(invControl.sections) && invControl.sections.length > 0) {
      const allocMap = new Map<string, {
        itemCode: string;
        name: string;
        category?: string;
        unit?: string;
        totalRequiredQty: number;
      }>();

      for (const sec of invControl.sections) {
        if (sec.checkType === 'per_item' && sec.perItemResults) {
          for (const prodId of Object.keys(sec.perItemResults)) {
            const prodRes = sec.perItemResults[prodId] || {};
            for (const itemId of Object.keys(prodRes)) {
              const it = prodRes[itemId];
              if (!it) continue;
              const code = (it.itemCode || it.code || '').trim();
              const name = (it.name || it.itemName || '').trim();
              const reqQty = Number(it.requiredQty !== undefined ? it.requiredQty : 1);
              if (reqQty <= 0) continue;
              const key = code ? `C_${code.toUpperCase()}` : `N_${name.toLowerCase()}`;
              const cur = allocMap.get(key) || {
                itemCode: code,
                name,
                category: it.category,
                unit: it.unit,
                totalRequiredQty: 0
              };
              cur.totalRequiredQty += reqQty;
              allocMap.set(key, cur);
            }
          }
        } else if (sec.checkType === 'global' && Array.isArray(sec.globalItems)) {
          for (const gIt of sec.globalItems) {
            if (!gIt) continue;
            const code = (gIt.itemCode || gIt.code || '').trim();
            const name = (gIt.name || gIt.itemName || '').trim();
            const reqQty = Number(gIt.requiredQty || 0);
            if (reqQty <= 0) continue;
            const key = code ? `C_${code.toUpperCase()}` : `N_${name.toLowerCase()}`;
            const cur = allocMap.get(key) || {
              itemCode: code,
              name,
              category: gIt.category,
              unit: gIt.unit,
              totalRequiredQty: 0
            };
            cur.totalRequiredQty += reqQty;
            allocMap.set(key, cur);
          }
        }
      }

      if (Array.isArray(invControl.manualPurchaseItems)) {
        for (const mIt of invControl.manualPurchaseItems) {
          if (!mIt) continue;
          if (mIt.procurementStatus === 'reserved' || invControl.isFinalized) {
            const code = (mIt.itemCode || mIt.code || '').trim();
            const name = (mIt.itemName || mIt.name || '').trim();
            const reqQty = Number(mIt.totalRequiredQty || mIt.requiredQty || 0);
            if (reqQty <= 0) continue;
            const key = code ? `C_${code.toUpperCase()}` : `N_${name.toLowerCase()}`;
            const cur = allocMap.get(key) || {
              itemCode: code,
              name,
              category: mIt.category,
              unit: mIt.unit,
              totalRequiredQty: 0
            };
            cur.totalRequiredQty += reqQty;
            allocMap.set(key, cur);
          }
        }
      }

      // Convert project material allocations into reservations bounded by warehouse current stock
      for (const alloc of allocMap.values()) {
        const matchedDbItem = (alloc.itemCode ? itemsByCodeMap.get(alloc.itemCode.toUpperCase()) : null)
          || (alloc.name ? itemsByNameMap.get(alloc.name.toLowerCase()) : null);
        if (matchedDbItem) {
          const stock = Number(matchedDbItem.currentStock || 0);
          if (stock > 0) {
            const reservedQty = Math.min(stock, alloc.totalRequiredQty);
            if (reservedQty > 0) {
              itemsList.push({
                itemId: matchedDbItem.id,
                itemCode: matchedDbItem.code || alloc.itemCode,
                itemName: matchedDbItem.name || alloc.name,
                category: matchedDbItem.category || alloc.category,
                unit: matchedDbItem.unit || alloc.unit,
                reservedQty,
                unitPrice: Number(matchedDbItem.weightedAverageCost || 0)
              });
            }
          }
        }
      }
    }

    return itemsList;
  }

  /**
   * Fetch active project's reserved items directly from DB.
   */
  static async getProjectReservedItems(targetProj: { id: number; inventoryControl: any }): Promise<any[]> {
    const invControl = targetProj.inventoryControl as InventoryControlData | null;
    if (!invControl) return [];
    if (Array.isArray(invControl.reservedItems) && invControl.reservedItems.length > 0) {
      return invControl.reservedItems;
    }

    const allItems = await orm
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        category: items.category,
        unit: items.unit,
        currentStock: items.currentStock,
        weightedAverageCost: items.weightedAverageCost,
      })
      .from(items)
      .where(eq(items.isDeleted, 0));

    const itemsByCodeMap = new Map<string, typeof allItems[0]>();
    const itemsByIdMap = new Map<number, typeof allItems[0]>();
    const itemsByNameMap = new Map<string, typeof allItems[0]>();
    for (const it of allItems) {
      if (it.code) itemsByCodeMap.set(it.code.trim().toUpperCase(), it);
      if (it.name) itemsByNameMap.set(it.name.trim().toLowerCase(), it);
      itemsByIdMap.set(it.id, it);
    }

    return ItemStockReservationService.deriveProjectReservedItems(invControl, itemsByCodeMap, itemsByNameMap, itemsByIdMap);
  }

  /**
   * Comprehensive calculation of reserved items across active Proforma Invoices AND Project Control.
   */
  static async getReservedStockDetails(): Promise<ReservedItemsFullReport> {
    try {
      const allReservationEntries: ReservedItemDetail[] = [];

      // 1. Fetch active proforma documents
      const activeProformas = await orm
        .select({
          id: documents.id,
          refNumber: documents.refNumber,
          buyerName: documents.buyerName,
          date: documents.date,
          status: documents.status,
          type: documents.type,
        })
        .from(documents)
        .where(and(
          eq(documents.isDeleted, 0),
          or(
            eq(documents.status, 'proforma'),
            eq(documents.type, 'proforma')
          ),
          sql`${documents.status} NOT IN ('cancelled', 'final')`
        ));

      if (activeProformas.length > 0) {
        const proformaIds = activeProformas.map(p => p.id);
        const proformaLines = await orm
          .select({
            documentId: documentItems.documentId,
            itemId: documentItems.itemId,
            quantity: documentItems.quantity,
            unitPrice: documentItems.unitPrice,
            code: items.code,
            name: items.name,
            unit: items.unit,
            category: items.category,
          })
          .from(documentItems)
          .innerJoin(items, eq(documentItems.itemId, items.id))
          .where(inArray(documentItems.documentId, proformaIds));

        const proformaMap = new Map(activeProformas.map(p => [p.id, p]));

        for (const line of proformaLines) {
          const doc = proformaMap.get(line.documentId);
          if (!doc) continue;
          const qty = Number(line.quantity || 0);
          if (qty <= 0) continue;

          const price = Number(line.unitPrice || 0);
          allReservationEntries.push({
            id: `proforma-${doc.id}-${line.itemId}`,
            sourceType: 'proforma',
            sourceLabel: 'پیش‌فاکتور فروش',
            sourceId: doc.id,
            sourceRef: doc.refNumber || `PRO-${doc.id}`,
            sourceTitle: doc.buyerName ? `پیش‌فاکتور ${doc.refNumber} (${doc.buyerName})` : `پیش‌فاکتور ${doc.refNumber}`,
            buyerOrCustomer: doc.buyerName || 'مشتری',
            itemId: line.itemId,
            itemCode: (line.code || '').trim(),
            itemName: line.name || '',
            category: line.category || 'عمومی',
            unit: line.unit || 'عدد',
            reservedQty: qty,
            unitPrice: price,
            totalValue: qty * price,
            date: doc.date || new Date().toISOString()
          });
        }
      }

      // 2. Fetch active production projects
      const activeProjs = await orm
        .select({
          id: productionProjects.id,
          projectCode: productionProjects.projectCode,
          title: productionProjects.title,
          inventoryControl: productionProjects.inventoryControl,
          createdAt: productionProjects.createdAt,
        })
        .from(productionProjects)
        .where(and(
          eq(productionProjects.isDeleted, 0),
          sql`${productionProjects.status} NOT IN ('completed', 'cancelled')`
        ));

      const allItems = await orm
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          category: items.category,
          unit: items.unit,
          currentStock: items.currentStock,
          weightedAverageCost: items.weightedAverageCost,
        })
        .from(items)
        .where(eq(items.isDeleted, 0));

      const itemsByCodeMap = new Map<string, typeof allItems[0]>();
      const itemsByIdMap = new Map<number, typeof allItems[0]>();
      const itemsByNameMap = new Map<string, typeof allItems[0]>();
      for (const it of allItems) {
        if (it.code) itemsByCodeMap.set(it.code.trim().toUpperCase(), it);
        if (it.name) itemsByNameMap.set(it.name.trim().toLowerCase(), it);
        itemsByIdMap.set(it.id, it);
      }

      for (const proj of activeProjs) {
        const invControl = proj.inventoryControl as InventoryControlData | null;
        if (!invControl) continue;

        const itemsList = ItemStockReservationService.deriveProjectReservedItems(invControl, itemsByCodeMap, itemsByNameMap, itemsByIdMap);

        for (let idx = 0; idx < itemsList.length; idx++) {
          const item = itemsList[idx];
          const code = (item.itemCode || item.code || '').trim();
          const reservedQty = Number(item.convertedReservedQty || item.convertedQty || item.reservedQty || item.warehouseStockQty || item.stockQty || 0);
          if (reservedQty <= 0) continue;

          const matchedDbItem = (code ? itemsByCodeMap.get(code.toUpperCase()) : null) 
            || (item.itemId ? itemsByIdMap.get(Number(item.itemId)) : null)
            || ((item.itemName || item.name) ? itemsByNameMap.get((item.itemName || item.name).trim().toLowerCase()) : null);
          const price = matchedDbItem ? Number(matchedDbItem.weightedAverageCost || 0) : Number(item.unitPrice || 0);

          allReservationEntries.push({
            id: `project-${proj.id}-${matchedDbItem?.id || idx}-${code || idx}`,
            sourceType: 'project',
            sourceLabel: 'کنترل پروژه',
            sourceId: proj.id,
            sourceRef: proj.projectCode || `PRJ-${proj.id}`,
            sourceTitle: proj.title || `پروژه ${proj.id}`,
            buyerOrCustomer: proj.title || 'پروژه تولید',
            itemId: matchedDbItem?.id || (item.itemId ? Number(item.itemId) : undefined),
            itemCode: code || matchedDbItem?.code || '',
            itemName: item.itemName || item.name || matchedDbItem?.name || 'کالای سفارشی',
            category: item.category || matchedDbItem?.category || 'عمومی',
            unit: item.convertedUnit || item.warehouseUnit || item.unit || matchedDbItem?.unit || 'عدد',
            reservedQty,
            unitPrice: price,
            totalValue: reservedQty * price,
            date: proj.createdAt || new Date().toISOString()
          });
        }
      }

      // 3. Group by Item
      const itemSummariesMap = new Map<string, ItemReservedReportSummary>();

      for (const it of allItems) {
        const normCode = (it.code || '').trim().toUpperCase();
        itemSummariesMap.set(normCode, {
          itemId: it.id,
          itemCode: it.code,
          itemName: it.name,
          category: it.category || 'عمومی',
          unit: it.unit || 'عدد',
          currentStock: Number(it.currentStock || 0),
          buyPrice: Number(it.weightedAverageCost || 0),
          sellPrice: Number(it.weightedAverageCost || 0),
          proformaReservedQty: 0,
          projectReservedQty: 0,
          totalReservedQty: 0,
          availableStock: Number(it.currentStock || 0),
          totalReservedValue: 0,
          reservations: []
        });
      }

      let proformaCount = 0;
      let projectCount = 0;

      for (const entry of allReservationEntries) {
        if (entry.sourceType === 'proforma') proformaCount++;
        if (entry.sourceType === 'project') projectCount++;

        const normCode = (entry.itemCode || '').trim().toUpperCase();
        let summary = itemSummariesMap.get(normCode);

        if (!summary) {
          summary = {
            itemId: entry.itemId,
            itemCode: entry.itemCode,
            itemName: entry.itemName,
            category: entry.category,
            unit: entry.unit,
            currentStock: 0,
            buyPrice: 0,
            sellPrice: entry.unitPrice,
            proformaReservedQty: 0,
            projectReservedQty: 0,
            totalReservedQty: 0,
            availableStock: 0,
            totalReservedValue: 0,
            reservations: []
          };
          itemSummariesMap.set(normCode, summary);
        }

        if (entry.sourceType === 'proforma') {
          summary.proformaReservedQty += entry.reservedQty;
        } else {
          summary.projectReservedQty += entry.reservedQty;
        }

        summary.totalReservedQty += entry.reservedQty;
        summary.availableStock = Math.max(0, summary.currentStock - summary.totalReservedQty);
        const val = entry.totalValue || (entry.reservedQty * summary.sellPrice);
        summary.totalReservedValue += val;
        summary.reservations.push(entry);
      }

      const itemSummaries = Array.from(itemSummariesMap.values()).filter(s => s.totalReservedQty > 0 || s.reservations.length > 0);

      const totalReservedItemsCount = itemSummaries.filter(s => s.totalReservedQty > 0).length;
      const totalReservedQty = allReservationEntries.reduce((sum, e) => sum + e.reservedQty, 0);
      const totalReservedValue = allReservationEntries.reduce((sum, e) => sum + (e.totalValue || 0), 0);

      return {
        summaryMetrics: {
          totalReservedItemsCount,
          totalReservedQty,
          totalReservedValue,
          proformaReservationsCount: proformaCount,
          projectReservationsCount: projectCount
        },
        itemSummaries,
        allReservationEntries
      };
    } catch (err) {
      logger.error({ message: 'Error generating reserved stock details', error: err });
      return {
        summaryMetrics: {
          totalReservedItemsCount: 0,
          totalReservedQty: 0,
          totalReservedValue: 0,
          proformaReservationsCount: 0,
          projectReservationsCount: 0
        },
        itemSummaries: [],
        allReservationEntries: []
      };
    }
  }

  /**
   * Calculates reserved stock quantities by item code across all non-completed/non-cancelled active production projects and active proformas.
   */
  static async getReservedStocksMap(): Promise<Record<string, ReservedStockInfo>> {
    try {
      const report = await ItemStockReservationService.getReservedStockDetails();
      const map: Record<string, ReservedStockInfo> = {};

      for (const summary of report.itemSummaries) {
        const code = (summary.itemCode || '').trim().toUpperCase();
        if (!code) continue;
        map[code] = {
          totalReserved: summary.totalReservedQty,
          reservations: summary.reservations.map(r => ({
            projectId: r.sourceId,
            projectCode: r.sourceRef,
            projectTitle: r.sourceTitle,
            reservedQty: r.reservedQty,
            unit: r.unit
          }))
        };
      }

      return map;
    } catch (e) {
      logger.error({ message: 'Error computing reserved stocks map', error: e });
      return {};
    }
  }
}
