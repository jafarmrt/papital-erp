import { sql, eq, and, or, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, productionProjects, documents, documentItems } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';

import { fin } from '../../lib/financialDecimal.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';

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

export interface SellableStockContext {
  location: string;            // کد انبار (پس از resolveWarehouseCode)
  excludeDocumentId?: number;  // سندی که در حال نهایی‌شدن است (رزرو خودش حساب نشود)
  projectId?: number | null;   // رزرو همین پروژه آزاد است
}

export interface ItemReservedReportSummary {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  stocks?: Record<string, number>;
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

export interface InventoryControlItem {
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

/** فیلدهای مقدار رزرو به ترتیب اولویت گزارش رزروها؛ اولین فیلد با مقدار مثبت، مقدار رزرو ردیف است */
const RESERVATION_QTY_FIELDS = ['convertedReservedQty', 'convertedQty', 'reservedQty', 'warehouseStockQty', 'stockQty'] as const;
export type ReservationQtyField = typeof RESERVATION_QTY_FIELDS[number];

/** v7.0.102 (TD-233): یک قاعده برای مقدار رزرو ردیف — هم در گزارش رزروها و هم در کسر رزرو هنگام حواله خروج */
export function reservationQtyField(row: Partial<Record<ReservationQtyField, unknown>>): ReservationQtyField | null {
  return RESERVATION_QTY_FIELDS.find(f => Number(row[f] || 0) > 0) ?? null;
}

/** ردیف مواد بخش‌های کنترل موجودی پروژه (JSONB فرم پروژه؛ نام‌های قدیمی code/itemName هم خوانده می‌شوند) */
interface InventoryControlMaterialRow {
  itemCode?: string;
  code?: string;
  name?: string;
  itemName?: string;
  category?: string;
  unit?: string;
  requiredQty?: number | string;
  totalRequiredQty?: number | string;
  procurementStatus?: string;
}

/** بخش کنترل موجودی پروژه: per_item (نتایج به ازای هر محصول) یا global (فهرست مشترک) */
interface InventoryControlSection {
  checkType?: string;
  perItemResults?: Record<string, Record<string, InventoryControlMaterialRow | null | undefined> | null | undefined>;
  globalItems?: Array<InventoryControlMaterialRow | null | undefined>;
}

interface InventoryControlData {
  isFinalized?: boolean;
  isReserved?: boolean;
  reservedItems?: InventoryControlItem[];
  purchaseList?: InventoryControlItem[];
  sections?: InventoryControlSection[];
  manualPurchaseItems?: Array<InventoryControlMaterialRow | null | undefined>;
}

/** ستون‌های کالا که برای تبدیل تخصیص مواد پروژه به رزرو خوانده می‌شوند */
type ReservationLookupItem = Pick<typeof items.$inferSelect, 'id' | 'code' | 'name' | 'category' | 'unit' | 'currentStock' | 'weightedAverageCost'>;

type ReservationRowRef = { itemId?: unknown; itemCode?: unknown; itemName?: unknown };

/** یک ردیف رزرو پروژه به همان کالا اشاره می‌کند اگر شناسه، کد یا نام کالا (بدون حساسیت به حروف) برابر باشد. */
function reservationRowMatches(row: ReservationRowRef, item: { id?: unknown; code?: unknown; name?: unknown }): boolean {
  const same = (a: unknown, b: unknown) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  return (!!row.itemId && !!item.id && Number(row.itemId) === Number(item.id)) || same(row.itemCode, item.code) || same(row.itemName, item.name);
}

/** یک کسر رزرو پروژه: ردیف رزرو پیش از کسر، فیلد مقدار آن و مقدار کسرشده (v7.0.105، TD-237) */
export interface ProjectReservationDeduction {
  itemId: number | null;
  qtyField: ReservationQtyField;
  quantity: number;
  row: InventoryControlItem;
}

/** v9.0.206 (TD-663): رزرو فقط برای این کالاها (صفحه فهرست کالا) */
export interface ReservationScope {
  itemIds: number[];
}

function emptyReservationReport(): ReservedItemsFullReport {
  return {
    summaryMetrics: { totalReservedItemsCount: 0, totalReservedQty: 0, totalReservedValue: 0, proformaReservationsCount: 0, projectReservationsCount: 0 },
    itemSummaries: [],
    allReservationEntries: [],
  };
}

export class ItemStockReservationService {
  /**
   * Derive reserved items for a project's inventory control bounded by warehouse stock.
   */
  static deriveProjectReservedItems(
    invControl: InventoryControlData | null | undefined,
    itemsByCodeMap: Map<string, ReservationLookupItem>,
    itemsByNameMap: Map<string, ReservationLookupItem>,
    itemsByIdMap: Map<number, ReservationLookupItem>
  ): InventoryControlItem[] {
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

    const itemsList: InventoryControlItem[] = [];
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
                unitPrice: fin(matchedDbItem.weightedAverageCost).toNumber()
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
  static async getProjectReservedItems(targetProj: { id: number; inventoryControl: unknown }, executor: DbExecutor = orm): Promise<InventoryControlItem[]> {
    const invControl = targetProj.inventoryControl as InventoryControlData | null;
    if (!invControl) return [];
    if (Array.isArray(invControl.reservedItems) && invControl.reservedItems.length > 0) {
      return invControl.reservedItems;
    }

    const allItems = await executor
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
   * TD-081 (v4.0.31): مسیر رسمی و یگانه آزادسازی رزروهای پروژه هنگام حواله خروج.
   * - jsonb `inventory_control.reservedItems` فقط از همین سرویس نوشته می‌شود (read-model نه write-path موازی)
   * - OCC: قفل سطری + کنترل نسخه (expectedVersion) + بامپ اتمیک version
   * - Audit: logActivity با snapshot قبل/بعد داخل همان executor (tx)
   */
  static async releaseProjectReservations(
    tx: DbExecutor,
    params: {
      projectId: number;
      docItems: Array<{ itemId?: unknown; itemCode?: unknown; itemName?: unknown; quantity: number }>;
      expectedVersion?: number;
      docId?: number | null;
      userId?: number;
      username?: string;
    }
  ): Promise<{
    changed: boolean;
    releasedItemIds: number[];
    releasedQuantity: number;
    remainingReservedCount: number;
    projectVersion: number;
    deductions: ProjectReservationDeduction[];
  }> {
    const projId = Number(params.projectId);
    if (!projId || Number.isNaN(projId)) {
      throw new OptimisticLockError({
        entityType: 'production_project',
        entityId: projId,
        expectedVersion: 0,
        message: 'شناسه پروژه برای آزادسازی رزرو معتبر نیست'
      });
    }

    // 1. قفل سطری پروژه (ترتیب قفل: production_projects سطح پروژه، مطابق سلسله‌مراتب)
    const [proj] = await tx.select()
      .from(productionProjects)
      .where(and(eq(productionProjects.id, projId), eq(productionProjects.isDeleted, 0)))
      .for('update');

    if (!proj) {
      throw new OptimisticLockError({
        entityType: 'production_project',
        entityId: projId,
        expectedVersion: params.expectedVersion ?? 1,
        message: `پروژه #${projId} برای آزادسازی رزرو یافت نشد`
      });
    }

    // 2. OCC — نسخه خوانده‌شده توسط فراخواننده باید با نسخه تحت قفل برابر باشد
    checkOccVersion(proj, {
      entityType: 'production_project',
      entityId: proj.id,
      expectedVersion: params.expectedVersion ?? proj.version
    });

    const invControl = (proj.inventoryControl as InventoryControlData) || {};
    let reservedList: InventoryControlItem[] = Array.isArray(invControl.reservedItems) && invControl.reservedItems.length > 0
      ? [...invControl.reservedItems]
      : await ItemStockReservationService.getProjectReservedItems(proj, tx);

    // 3. مپینگ اقلام سند
    const rawItemIds = Array.from(new Set(
      params.docItems
        .map(l => Number(l.itemId))
        .filter((id: number) => !isNaN(id) && id > 0)
    )) as number[];

    let itemDataMap = new Map<number, typeof items.$inferSelect>();
    if (rawItemIds.length > 0) {
      const fetchedItems = await tx.select().from(items).where(inArray(items.id, rawItemIds));
      itemDataMap = new Map(fetchedItems.map((it): [number, typeof items.$inferSelect] => [it.id, it]));
    }

    // 4. کسر رزرو هر ردیف سند (تطبیق id/code/name). v7.0.102 (TD-233): مقدار هر ردیف سند از همه ردیف‌های رزرو
    // هم‌کالا به ترتیب کم می‌شود (پیش‌تر فقط از اولین ردیف) و مقدار هر ردیف رزرو همان فیلدی است که گزارش رزروها می‌خواند.
    const releasedItemIds: number[] = [];
    const deductions: ProjectReservationDeduction[] = [];
    let releasedQuantity = fin(0);
    for (const docLine of params.docItems) {
      let remaining = fin(docLine.quantity || 0);
      if (!remaining.isPositive()) continue;
      const itemData = itemDataMap.get(Number(docLine.itemId));
      if (!itemData) continue;

      let lineReleased = false;
      for (let resIdx = 0; resIdx < reservedList.length && remaining.isPositive();) {
        const r = reservedList[resIdx];
        const qtyField = reservationRowMatches(r, itemData) ? reservationQtyField(r) : null;
        if (!qtyField) {
          resIdx++;
          continue;
        }

        const currentResQty = fin(r[qtyField]);
        const deducted = currentResQty.lessThan(remaining) ? currentResQty : remaining;
        const newResQty = currentResQty.subtract(deducted);
        remaining = remaining.subtract(deducted);
        releasedQuantity = releasedQuantity.add(deducted);
        deductions.push({ itemId: itemData.id, qtyField, quantity: deducted.toNumber(), row: r });
        lineReleased = true;
        if (newResQty.isPositive()) {
          reservedList[resIdx] = { ...r, [qtyField]: newResQty.toNumber() };
          resIdx++;
        } else {
          reservedList.splice(resIdx, 1);
        }
      }
      if (lineReleased && !releasedItemIds.includes(itemData.id)) releasedItemIds.push(itemData.id);
    }

    const changed = releasedItemIds.length > 0;
    if (changed) {
      const updatedInvControl = {
        ...invControl,
        reservedItems: reservedList,
        isReserved: reservedList.length > 0,
        lastUpdated: systemNowUtcIso()
      };

      // 5. بامپ اتمیک version در شرط UPDATE (دفاع دوم OCC در سطح SQL)
      const [updatedRow] = await tx.update(productionProjects)
        .set({
          inventoryControl: updatedInvControl,
          version: nextVersion(proj.version)
        })
        .where(and(eq(productionProjects.id, proj.id), eq(productionProjects.version, proj.version)))
        .returning({ id: productionProjects.id });

      if (!updatedRow) {
        throw new OptimisticLockError({
          entityType: 'production_project',
          entityId: proj.id,
          expectedVersion: proj.version,
          message: `به‌روزرسانی رزروهای پروژه #${proj.id} به دلیل تغییر همزمان نسخه انجام نشد`
        });
      }

      await logActivity({
        userId: params.userId,
        username: params.username || 'سیستم',
        action: 'UPDATE',
        entity: 'کنترل موجودی پروژه',
        entityId: String(proj.id),
        description: `آزادسازی رزرو ${releasedItemIds.length} قلم کالای پروژه «${proj.title || proj.projectCode || proj.id}» بابت حواله خروج${params.docId ? ` سند #${params.docId}` : ''}`,
        details: {
          before: { reservedItems: invControl.reservedItems || [], version: proj.version },
          after: { reservedItems: reservedList, version: nextVersion(proj.version) },
          releasedItemIds,
          documentId: params.docId ?? null
        },
        tx
      });
    }

    return {
      changed,
      releasedItemIds,
      releasedQuantity: releasedQuantity.toNumber(),
      remainingReservedCount: reservedList.length,
      projectVersion: nextVersion(proj.version),
      deductions
    };
  }

  /**
   * v7.0.105 (TD-237، تصمیم مالک محصول «برگردد»): ابطال حواله خروج پروژه، رزرو کسرشده همان حواله را به همان پروژه
   * برمی‌گرداند. مقدار هر کسر به ردیف هم‌کالای با همان فیلد مقدار اضافه می‌شود، و اگر آن ردیف کامل مصرف و حذف شده
   * بود، ردیف ثبت‌شده پیش از کسر با همان مقدار دوباره افزوده می‌شود. قفل سطری پروژه، بامپ نسخه و لاگ ممیزی
   * مانند آزادسازی. پروژه حذف‌شده چیزی برنمی‌گرداند.
   */
  static async restoreProjectReservations(
    tx: DbExecutor,
    params: { projectId: number; deductions: ProjectReservationDeduction[]; docId?: number | null; userId?: number; username?: string }
  ): Promise<{ restored: boolean; restoredQuantity: number; restoredItemIds: number[] }> {
    const [proj] = await tx.select()
      .from(productionProjects)
      .where(and(eq(productionProjects.id, Number(params.projectId)), eq(productionProjects.isDeleted, 0)))
      .for('update');
    if (!proj || params.deductions.length === 0) return { restored: false, restoredQuantity: 0, restoredItemIds: [] };

    const invControl = (proj.inventoryControl as InventoryControlData) || {};
    const reservedList: InventoryControlItem[] = Array.isArray(invControl.reservedItems) ? [...invControl.reservedItems] : [];
    const restoredItemIds: number[] = [];
    let restoredQuantity = fin(0);
    for (const d of params.deductions) {
      const qty = fin(d.quantity);
      if (!qty.isPositive()) continue;
      const target = { id: d.itemId ?? d.row.itemId, code: d.row.itemCode, name: d.row.itemName };
      const idx = reservedList.findIndex(r => reservationRowMatches(r, target) && reservationQtyField(r) === d.qtyField);
      if (idx >= 0) {
        reservedList[idx] = { ...reservedList[idx], [d.qtyField]: fin(reservedList[idx][d.qtyField]).add(qty).toNumber() };
      } else {
        reservedList.push({ ...d.row, [d.qtyField]: qty.toNumber() });
      }
      restoredQuantity = restoredQuantity.add(qty);
      if (d.itemId && !restoredItemIds.includes(d.itemId)) restoredItemIds.push(d.itemId);
    }

    await tx.update(productionProjects)
      .set({
        inventoryControl: { ...invControl, reservedItems: reservedList, isReserved: reservedList.length > 0, lastUpdated: systemNowUtcIso() },
        version: nextVersion(proj.version)
      })
      .where(eq(productionProjects.id, proj.id));

    await logActivity({
      userId: params.userId,
      username: params.username || 'سیستم',
      action: 'UPDATE',
      entity: 'کنترل موجودی پروژه',
      entityId: String(proj.id),
      description: `بازگرداندن رزرو ${params.deductions.length} ردیف کالای پروژه «${proj.title || proj.projectCode || proj.id}» بابت ابطال حواله خروج${params.docId ? ` سند #${params.docId}` : ''}`,
      details: {
        before: { reservedItems: invControl.reservedItems || [], version: proj.version },
        after: { reservedItems: reservedList, version: nextVersion(proj.version) },
        restoredItemIds,
        documentId: params.docId ?? null
      },
      tx
    });

    return { restored: true, restoredQuantity: restoredQuantity.toNumber(), restoredItemIds };
  }

  /**
   * P1-05 (H-02): گیت رزرویشن در ثبت اسناد (Fail-Closed) — در صورت خطا استثنا صادر می‌شود تا موجودی رزرو صفر تلقی نشود
   */
  static async getReservedStockDetailsOrThrow(executor?: DbExecutor): Promise<ReservedItemsFullReport> {
    return this.getReservedStockDetails(executor, true);
  }

  /**
   * Comprehensive calculation of reserved items across active Proforma Invoices AND Project Control.
   *
   * v9.0.206 (TD-663، B05-17): با `scope.itemIds` فقط رزرو همان کالاها ساخته می‌شود (فهرست کالا یک صفحه را می‌خواهد):
   * ردیف‌های پیش‌فاکتور همان کالاها، موجودی انبار و خلاصه همان کالاها، و ردیف‌های پروژه‌ای که به همان کالاها می‌رسند.
   * همه کالاها فقط وقتی (و فقط با ستون‌های تطبیق) خوانده می‌شوند که پروژه فعالی کنترل موجودی دارد. پیش‌تر هر صفحه ۵۰ کالایی
   * گزارش همه کالاها را با موجودی همه انبارها می‌ساخت (۷۵ از ۹۳ میلی‌ثانیه با ۵٬۰۰۰ کالا).
   */
  static async getReservedStockDetails(executor?: DbExecutor, throwOnError: boolean = false, scope?: ReservationScope): Promise<ReservedItemsFullReport> {
    try {
      const client = executor || orm;
      const allReservationEntries: ReservedItemDetail[] = [];
      const scopeIds = scope ? new Set(scope.itemIds.filter(id => Number.isInteger(id) && id > 0)) : null;
      if (scopeIds && scopeIds.size === 0) return emptyReservationReport();

      // 1. Fetch active proforma documents
      const activeProformas = await client
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
        const proformaLines = await client
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
          .where(and(
            inArray(documentItems.documentId, proformaIds),
            eq(documentItems.isDeleted, 0),
            eq(items.isDeleted, 0),
            scopeIds ? inArray(documentItems.itemId, [...scopeIds]) : undefined
          ));

        const proformaMap = new Map(activeProformas.map(p => [p.id, p]));

        for (const line of proformaLines) {
          const doc = proformaMap.get(line.documentId);
          if (!doc) continue;
          const qty = Number(line.quantity || 0);
          if (qty <= 0) continue;

          // v7.0.113 (TD-239): ارزش رزرو با FinancialDecimal (AGENTS §1.8)
          const price = fin(line.unitPrice);
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
            unitPrice: price.toNumber(),
            totalValue: price.multiply(qty).toNumber(),
            date: doc.date || new Date().toISOString()
          });
        }
      }

      // 2. Fetch active production projects
      const activeProjs = await client
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

      // v9.0.206 (TD-663): با scope، همه کالاها فقط برای تطبیق ردیف‌های پروژه لازم‌اند؛ بی پروژه فعال فقط کالاهای scope
      const needsAllItems = !scopeIds || activeProjs.some(p => p.inventoryControl);
      const allItems = await client
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
        .where(and(eq(items.isDeleted, 0), needsAllItems ? undefined : inArray(items.id, [...(scopeIds ?? [])])));
      const summaryItems = scopeIds ? allItems.filter(i => scopeIds.has(i.id)) : allItems;
      // v7.0.48 (TD-214): موجودی هر انبار از جدول نرمال (ستون JSONB حذف شد)
      const tableStockMap = await ItemWarehouseStockService.getStocksForItems(client, summaryItems.map(i => i.id));

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
          const qtyField = reservationQtyField(item);
          const reservedQty = qtyField ? Number(item[qtyField]) : 0;
          if (reservedQty <= 0) continue;

          const rowName = item.itemName || item.name;
          const matchedDbItem = (code ? itemsByCodeMap.get(code.toUpperCase()) : null) 
            || (item.itemId ? itemsByIdMap.get(Number(item.itemId)) : null)
            || (rowName ? itemsByNameMap.get(rowName.trim().toLowerCase()) : null);
          if (scopeIds && !(matchedDbItem && scopeIds.has(matchedDbItem.id))) continue;
          const price = fin(matchedDbItem ? matchedDbItem.weightedAverageCost : item.unitPrice);

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
            unitPrice: price.toNumber(),
            totalValue: price.multiply(reservedQty).toNumber(),
            date: proj.createdAt || new Date().toISOString()
          });
        }
      }

      // 3. Group by Item
      const itemSummariesMap = new Map<string, ItemReservedReportSummary>();

      for (const it of summaryItems) {
        const normCode = (it.code || '').trim().toUpperCase();
        itemSummariesMap.set(normCode, {
          itemId: it.id,
          itemCode: it.code,
          itemName: it.name,
          category: it.category || 'عمومی',
          unit: it.unit || 'عدد',
          currentStock: Number(it.currentStock || 0),
          stocks: tableStockMap.get(it.id)?.byCode ?? {},
          buyPrice: fin(it.weightedAverageCost).toNumber(),
          sellPrice: fin(it.weightedAverageCost).toNumber(),
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
        const val = entry.totalValue || fin(summary.sellPrice).multiply(entry.reservedQty).toNumber();
        summary.totalReservedValue = fin(summary.totalReservedValue).add(val).toNumber();
        summary.reservations.push(entry);
      }

      const itemSummaries = Array.from(itemSummariesMap.values()).filter(s => s.totalReservedQty > 0 || s.reservations.length > 0);

      const totalReservedItemsCount = itemSummaries.filter(s => s.totalReservedQty > 0).length;
      const totalReservedQty = allReservationEntries.reduce((sum, e) => sum + e.reservedQty, 0);
      const totalReservedValue = allReservationEntries.reduce((sum, e) => sum.add(e.totalValue), fin(0)).toNumber();

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
      if (throwOnError) {
        throw err;
      }
      return emptyReservationReport();
    }
  }

  /**
   * Calculates reserved stock quantities by item code across all non-completed/non-cancelled active production projects and active proformas.
   */
  static async getReservedStocksMap(scope?: ReservationScope): Promise<Record<string, ReservedStockInfo>> {
    try {
      const report = await ItemStockReservationService.getReservedStockDetails(undefined, false, scope);
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

  /**
   * قابل‌فروش = min(موجودی انبار مقصد، موجودی کل − رزرو دیگران)
   * V5 Phase 2 (TD-118): Calculates sellable quantity for a specific warehouse location
   * taking other active reservations into account while excluding self-reservations.
   */
  static computeSellable(
    summary: ItemReservedReportSummary | undefined,
    stocks: Record<string, number> | null | undefined,
    ctx: SellableStockContext
  ): { locationStock: number; reservedForOthers: number; sellable: number } {
    const rawStocks = (stocks || summary?.stocks || {}) as Record<string, number>;
    const locKey = ctx.location ? ctx.location.trim() : 'main';
    const locationStock = fin(rawStocks[locKey] || 0).toNumber();
    const total = Object.values(rawStocks).reduce((s, v) => fin(s).add(Number(v) || 0).toNumber(), 0);
    const reservedForOthers = (summary?.reservations || [])
      .filter(r => !(r.sourceType === 'proforma' && ctx.excludeDocumentId && Number(r.sourceId) === ctx.excludeDocumentId))
      .filter(r => !(r.sourceType === 'project' && ctx.projectId && Number(r.sourceId) === ctx.projectId))
      .reduce((s, r) => fin(s).add(Number(r.reservedQty) || 0).toNumber(), 0);
    const availableFromTotal = Math.max(0, fin(total).subtract(reservedForOthers).toNumber());
    const sellable = Math.max(0, Math.min(locationStock, availableFromTotal));
    return { locationStock, reservedForOthers, sellable };
  }
}

