import { sql, eq, and, or, asc, inArray, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, productionProjects, documents, documentItems } from '../../db/schema.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';

import { fin } from '../../lib/financialDecimal.js';
import { RESERVING_DOCUMENT_STATUS, RESERVING_DOCUMENT_TYPES } from '../../lib/documents/reservingDocuments.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { reservingProjectRows, storedReservationRows } from '../../lib/projects/projectReservationState.js';
import { findProjectItemMatch, itemCodeKey, itemNameKey } from '../../lib/projects/projectItemMatch.js';
import { proformaSourceTitle, type ItemReservedReportSummary, type ReservedItemDetail, type ReservedItemsFullReport } from '../../lib/inventory/reservedItemsReport.js';

export type { ItemReservedReportSummary, ReservedItemDetail, ReservedItemsFullReport };

export interface SellableStockContext {
  location: string;            // کد انبار (پس از resolveWarehouseCode)
  excludeDocumentId?: number;  // سندی که در حال نهایی‌شدن است (رزرو خودش حساب نشود)
  projectId?: number | null;   // رزرو همین پروژه آزاد است
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

/** کنترل موجودی پروژه (JSONB فرم پروژه): فقط رزرو ذخیره‌شده خوانده می‌شود (v9.0.371، TD-817) */
interface InventoryControlData {
  isFinalized?: boolean;
  isReserved?: boolean;
  reservedItems?: InventoryControlItem[];
}

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

/** v9.0.374 (TD-822): کلید خلاصه رزرو؛ شناسه کالا، وگرنه (ردیف بی کالای شناخته‌شده) کد بزرگ‌شده */
function reservationSummaryKey(itemId: unknown, code: unknown): string {
  const id = Number(itemId);
  return Number.isInteger(id) && id > 0 ? `id:${id}` : `code:${String(code ?? '').trim().toUpperCase()}`;
}

/** ستون‌های کالا که گزارش رزرو می‌خواند */
const RESERVATION_ITEM_COLUMNS = {
  id: items.id,
  code: items.code,
  name: items.name,
  category: items.category,
  unit: items.unit,
  currentStock: items.currentStock,
  weightedAverageCost: items.weightedAverageCost,
};
type ReservationItemRow = Pick<typeof items.$inferSelect, 'id' | 'code' | 'name' | 'category' | 'unit' | 'currentStock' | 'weightedAverageCost'>;

/** v9.0.394 (TD-821): متن یک مقدار ذخیره‌شده در JSONB؛ عدد متن می‌شود و هر چیز دیگر (شیء، آرایه، null) خالی است */
const rowText = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** شناسه کالای ردیف ذخیره‌شده: عدد صحیح مثبت یا متن رقمی، وگرنه هیچ */
const refItemId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** یک ردیف رزرو ذخیره‌شده پروژه ثبت نهایی‌شده با مقدار مثبت */
interface ProjectReservationRowRef {
  projectId: number;
  projectCode: string | null;
  projectTitle: string | null;
  createdAt: string | null;
  index: number;
  itemId: number | null;
  code: string;
  name: string;
  qty: number;
  raw: InventoryControlItem;
}

/** v9.0.394 (TD-821): ردیف رزرو پروژه‌ای که به هیچ کالای فعالی نمی‌رسد */
export interface UnmatchedProjectReservationRow {
  projectId: number;
  projectCode: string | null;
  projectTitle: string | null;
  index: number;
  code: string;
  name: string;
  qty: number;
}

/**
 * v9.0.395 (TD-831): فقط پروژه‌های فعال ثبت نهایی‌شده با آرایه رزرو ناخالی خوانده می‌شوند؛ قاعده خود رزرو همان
 * `reservingProjectRows` است (TD-817).
 */
async function readReservingProjectRows(client: DbExecutor): Promise<ProjectReservationRowRef[]> {
  const projects = await client
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
      sql`${productionProjects.status} NOT IN ('completed', 'cancelled')`,
      sql`${productionProjects.inventoryControl} -> 'isFinalized' = 'true'::jsonb`,
      sql`jsonb_typeof(${productionProjects.inventoryControl} -> 'reservedItems') = 'array'`,
      sql`jsonb_array_length(${productionProjects.inventoryControl} -> 'reservedItems') > 0`
    ))
    .orderBy(asc(productionProjects.id));

  const rows: ProjectReservationRowRef[] = [];
  for (const proj of projects) {
    // v9.0.371 (TD-817، تصمیم ت۲): فقط رزرو ذخیره‌شده پروژه ثبت نهایی‌شده؛ پیش‌نویس، خارج‌شده از ثبت نهایی و رزرو مصرف‌شده هیچ
    reservingProjectRows<InventoryControlItem>(proj.inventoryControl).forEach((raw, index) => {
      const qtyField = reservationQtyField(raw);
      const qty = qtyField ? Number(raw[qtyField]) : 0;
      if (!(qty > 0) || !Number.isFinite(qty)) return;
      rows.push({
        projectId: proj.id,
        projectCode: proj.projectCode ?? null,
        projectTitle: proj.title ?? null,
        createdAt: proj.createdAt ?? null,
        index,
        itemId: refItemId(raw.itemId),
        code: rowText(raw.itemCode) || rowText(raw.code),
        name: rowText(raw.itemName) || rowText(raw.name),
        qty,
        raw,
      });
    });
  }
  return rows;
}

/** کلیدهای تطبیق کالاها: شناسه، کلید کد و کلید نام (همان کلیدهای findProjectItemMatch) */
function reservationItemKeys(list: ReadonlyArray<{ id: number; code?: unknown; name?: unknown }>): { ids: Set<number>; codes: Set<string>; names: Set<string> } {
  const keys = { ids: new Set<number>(), codes: new Set<string>(), names: new Set<string>() };
  for (const it of list) {
    keys.ids.add(it.id);
    if (itemCodeKey(it.code)) keys.codes.add(itemCodeKey(it.code));
    if (itemNameKey(it.name)) keys.names.add(itemNameKey(it.name));
  }
  return keys;
}

/** ردیفی که شناسه، کلید کد یا کلید نامش با یکی از کالاهای scope برابر است */
function refMayMatch(row: ProjectReservationRowRef, keys: { ids: Set<number>; codes: Set<string>; names: Set<string> }): boolean {
  return (row.itemId !== null && keys.ids.has(row.itemId)) || keys.codes.has(itemCodeKey(row.code)) || keys.names.has(itemNameKey(row.name));
}

/** v9.0.395 (TD-831): فقط کالاهای فعالی که ردیف‌ها به آن‌ها اشاره می‌کنند، با نمایه‌های کلید کد و نام (TD-653) */
async function readItemsForProjectRows(client: DbExecutor, rows: ProjectReservationRowRef[]): Promise<ReservationItemRow[]> {
  const ids = [...new Set(rows.map(r => r.itemId).filter((id): id is number => id !== null))];
  const codes = [...new Set(rows.map(r => itemCodeKey(r.code)).filter(Boolean))];
  const names = [...new Set(rows.map(r => itemNameKey(r.name)).filter(Boolean))];
  const conditions = [
    ids.length > 0 ? inArray(items.id, ids) : undefined,
    codes.length > 0 ? inArray(sql`upper(btrim(${items.code}))`, codes) : undefined,
    names.length > 0 ? inArray(sql`lower(btrim(${items.name}))`, names) : undefined,
  ].filter((c): c is SQL => c !== undefined);
  if (conditions.length === 0) return [];
  return client.select(RESERVATION_ITEM_COLUMNS).from(items).where(and(eq(items.isDeleted, 0), or(...conditions))).orderBy(asc(items.id));
}

/**
 * v9.0.452 (TD-918): منبع کسر یا بازگرداندن رزرو در شرح ممیزی؛ تخصیص مواد با شماره تخصیص، وگرنه حواله خروج با شماره سند.
 * `allocationText` شرح منبع تخصیص است (کسر: «بابت تخصیص مواد»، بازگرداندن: «بابت آزادسازی تخصیص مواد»).
 */
function reservationSourceText(
  params: { docId?: number | null; bomAllocationId?: number | null },
  documentText: string,
  allocationText = 'بابت تخصیص مواد'
): string {
  if (params.bomAllocationId) return `${allocationText} شماره ${params.bomAllocationId}`;
  return `${documentText}${params.docId ? ` سند #${params.docId}` : ''}`;
}

function emptyReservationReport(): ReservedItemsFullReport {
  return {
    summaryMetrics: { totalReservedItemsCount: 0, totalReservedQty: 0, totalReservedCost: 0, proformaReservationsCount: 0, projectReservationsCount: 0 },
    itemSummaries: [],
    allReservationEntries: [],
  };
}

export class ItemStockReservationService {
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
      /** v9.0.452 (TD-918): کسر بابت تخصیص مواد این شماره، نه حواله خروج */
      bomAllocationId?: number | null;
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
    // v9.0.371 (TD-817): فقط رزرو ذخیره‌شده کم می‌شود؛ رزرو خالی (مصرف‌شده یا هرگز ساخته‌نشده) از بخش‌ها دوباره ساخته نمی‌شود
    const reservedList: InventoryControlItem[] = [...storedReservationRows<InventoryControlItem>(invControl)];

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
        description: `آزادسازی رزرو ${releasedItemIds.length} قلم کالای پروژه «${proj.title || proj.projectCode || proj.id}» ${reservationSourceText(params, 'بابت حواله خروج')}`,
        details: {
          before: { reservedItems: invControl.reservedItems || [], version: proj.version },
          after: { reservedItems: reservedList, version: nextVersion(proj.version) },
          releasedItemIds,
          documentId: params.docId ?? null,
          bomAllocationId: params.bomAllocationId ?? null
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
    params: {
      projectId: number; deductions: ProjectReservationDeduction[]; docId?: number | null; bomAllocationId?: number | null;
      userId?: number; username?: string;
    }
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
      description: `بازگرداندن رزرو ${params.deductions.length} ردیف کالای پروژه «${proj.title || proj.projectCode || proj.id}» ${reservationSourceText(params, 'بابت ابطال حواله خروج', 'بابت آزادسازی تخصیص مواد')}`,
      details: {
        before: { reservedItems: invControl.reservedItems || [], version: proj.version },
        after: { reservedItems: reservedList, version: nextVersion(proj.version) },
        restoredItemIds,
        documentId: params.docId ?? null,
        bomAllocationId: params.bomAllocationId ?? null
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
   * v9.0.206 (TD-663، B05-17): با `scope.itemIds` فقط رزرو همان کالاها ساخته می‌شود (فهرست کالا یک صفحه را می‌خواهد).
   *
   * v9.0.394 (TD-821، یافته B07-05): این گزارش همیشه fail-closed است (`throwOnError` فقط `true` می‌پذیرد): خطای ساختن آن به
   * فراخواننده می‌رسد و هیچ‌جا «بی رزرو» خوانده نمی‌شود. پیش‌تر فهرست کالا، فروشگاه اینترنتی و گزارش رزروها خطا را می‌بلعیدند و
   * رزرو صفر می‌دیدند، در حالی که یک ردیف ذخیره‌شده با کد یا نام عددی (`.trim` روی عدد) هر حواله و فاکتور خروجی را با ۵۰۰ رد
   * می‌کرد. ردیف پروژه با متن امن خوانده می‌شود (`rowText`) و ردیفی که به هیچ کالای فعالی نمی‌رسد کنار گذاشته و در بررسی سلامت
   * مالی فهرست می‌شود (`unmatchedProjectReservationRows`)؛ دیگر به نام «کالای سفارشی» با کد خودش رزرو نمی‌سازد.
   *
   * v9.0.395 (TD-831، یافته B07-15): خواندن‌ها به اندازه پرسش است: ردیف‌های پیش‌فاکتور با یک پرس‌وجوی پیوندی (و با scope فقط
   * کالاهای آن)، پروژه‌ها فقط آن‌ها که ثبت نهایی شده‌اند و رزرو ذخیره‌شده دارند، و کالاها فقط آن‌ها که ردیف‌ها به آن‌ها اشاره
   * می‌کنند (شناسه، کلید کد، کلید نام) — هرگز همه کالاها؛ با scope فقط ردیف‌هایی که می‌توانند به کالاهای scope برسند. بی scope
   * خلاصه فقط برای کالاهای رزروشده ساخته می‌شود. پیش‌تر هر حواله خروجی همه پیش‌فاکتورها، همه پروژه‌ها و (با هر پروژه رزروی)
   * همه کالاها را می‌خواند.
   */
  static async getReservedStockDetails(executor?: DbExecutor, throwOnError: true = true, scope?: ReservationScope): Promise<ReservedItemsFullReport> {
    const client = executor || orm;
    const allReservationEntries: ReservedItemDetail[] = [];
    const scopeIds = scope ? new Set(scope.itemIds.filter(id => Number.isInteger(id) && id > 0)) : null;
    if (scopeIds && scopeIds.size === 0) return emptyReservationReport();

    const scopeItems = scopeIds
      ? await client.select(RESERVATION_ITEM_COLUMNS).from(items).where(and(eq(items.isDeleted, 0), inArray(items.id, [...scopeIds])))
      : null;
    const summaryItems = new Map<number, ReservationItemRow>((scopeItems ?? []).map(it => [it.id, it]));

    // 1. ردیف‌های پیش‌فاکتور فروش با سند و کالا در یک پرس‌وجو
    const proformaLines = await client
      .select({
        documentId: documents.id,
        refNumber: documents.refNumber,
        buyerName: documents.buyerName,
        date: documents.date,
        quantity: documentItems.quantity,
        item: RESERVATION_ITEM_COLUMNS,
      })
      .from(documentItems)
      .innerJoin(documents, eq(documentItems.documentId, documents.id))
      .innerJoin(items, eq(documentItems.itemId, items.id))
      .where(and(
        eq(documents.isDeleted, 0),
        // v9.0.370 (TD-818، تصمیم ت۱): فقط پیش‌فاکتور فروش؛ پیش‌فاکتور خرید و پیش‌نویس رزرو نمی‌کنند
        inArray(documents.type, [...RESERVING_DOCUMENT_TYPES]),
        eq(documents.status, RESERVING_DOCUMENT_STATUS),
        eq(documentItems.isDeleted, 0),
        eq(items.isDeleted, 0),
        scopeIds ? inArray(documentItems.itemId, [...scopeIds]) : undefined
      ));

    for (const line of proformaLines) {
      const qty = Number(line.quantity || 0);
      if (qty <= 0) continue;
      if (!summaryItems.has(line.item.id)) summaryItems.set(line.item.id, line.item);
      // v9.0.399 (TD-823): the reservation is valued at the item's cost in IRR, never at the proforma's sale price and currency
      const cost = fin(line.item.weightedAverageCost);
      allReservationEntries.push({
        id: `proforma-${line.documentId}-${line.item.id}`,
        sourceType: 'proforma',
        sourceLabel: 'پیش‌فاکتور فروش',
        sourceId: line.documentId,
        sourceRef: line.refNumber || `PRO-${line.documentId}`,
        sourceTitle: proformaSourceTitle(line.refNumber || `PRO-${line.documentId}`, line.buyerName),
        buyerOrCustomer: line.buyerName || 'مشتری',
        itemId: line.item.id,
        itemCode: (line.item.code || '').trim(),
        itemName: line.item.name || '',
        category: line.item.category || 'عمومی',
        unit: line.item.unit || 'عدد',
        reservedQty: qty,
        unitCost: cost.toNumber(),
        totalCost: cost.multiply(qty).toNumber(),
        date: line.date || new Date().toISOString()
      });
    }

    // 2. ردیف‌های رزرو پروژه‌های ثبت نهایی‌شده؛ با scope فقط ردیف‌هایی که می‌توانند به کالاهای scope برسند
    const projectRows = await readReservingProjectRows(client);
    const scopeKeys = scopeItems ? reservationItemKeys(scopeItems) : null;
    const candidates = scopeKeys ? projectRows.filter(r => refMayMatch(r, scopeKeys)) : projectRows;
    const rowItems = await readItemsForProjectRows(client, candidates);

    for (const row of candidates) {
      // v9.0.374 (TD-822): شناسه کالا بر کد و نام مقدم است (ردیف رزرو سرور همیشه شناسه دارد)
      const matched = findProjectItemMatch({ itemId: row.itemId, code: row.code, name: row.name }, rowItems);
      // v9.0.394 (TD-821): ردیفی که به کالای فعالی نمی‌رسد رزرو نمی‌کند و در بررسی سلامت فهرست می‌شود
      if (!matched || (scopeIds && !scopeIds.has(matched.id))) continue;
      if (!summaryItems.has(matched.id)) summaryItems.set(matched.id, matched);
      const cost = fin(matched.weightedAverageCost);
      allReservationEntries.push({
        id: `project-${row.projectId}-${matched.id}-${row.index}`,
        sourceType: 'project',
        sourceLabel: 'کنترل پروژه',
        sourceId: row.projectId,
        sourceRef: row.projectCode || `PRJ-${row.projectId}`,
        sourceTitle: row.projectTitle || `پروژه ${row.projectId}`,
        buyerOrCustomer: row.projectTitle || 'پروژه تولید',
        itemId: matched.id,
        itemCode: (matched.code || '').trim(),
        itemName: matched.name || '',
        category: rowText(row.raw.category) || matched.category || 'عمومی',
        unit: rowText(row.raw.convertedUnit) || rowText(row.raw.warehouseUnit) || rowText(row.raw.unit) || matched.unit || 'عدد',
        reservedQty: row.qty,
        unitCost: cost.toNumber(),
        totalCost: cost.multiply(row.qty).toNumber(),
        date: row.createdAt || new Date().toISOString()
      });
    }

    // 3. Group by Item
    // v9.0.374 (TD-822): خلاصه با شناسه کالا کلید می‌خورد؛ پیش‌تر کد بزرگ‌شده کلید بود و دو کالا با کدهای هم‌حرف
    // (یا «ß» و «SS») یک خلاصه داشتند و رزرو یکی به دیگری می‌رسید
    // v7.0.48 (TD-214): موجودی هر انبار از جدول نرمال (ستون JSONB حذف شد)
    const tableStockMap = await ItemWarehouseStockService.getStocksForItems(client, [...summaryItems.keys()]);
    const itemSummariesMap = new Map<string, ItemReservedReportSummary>();

    for (const it of summaryItems.values()) {
      itemSummariesMap.set(reservationSummaryKey(it.id, it.code), {
        itemId: it.id,
        itemCode: it.code,
        itemName: it.name,
        category: it.category || 'عمومی',
        unit: it.unit || 'عدد',
        currentStock: Number(it.currentStock || 0),
        stocks: tableStockMap.get(it.id)?.byCode ?? {},
        weightedAverageCost: fin(it.weightedAverageCost).toNumber(),
        proformaReservedQty: 0,
        projectReservedQty: 0,
        totalReservedQty: 0,
        availableStock: Number(it.currentStock || 0),
        totalReservedCost: 0,
        reservations: []
      });
    }

    let proformaCount = 0;
    let projectCount = 0;

    for (const entry of allReservationEntries) {
      if (entry.sourceType === 'proforma') proformaCount++;
      if (entry.sourceType === 'project') projectCount++;

      const summary = itemSummariesMap.get(reservationSummaryKey(entry.itemId, entry.itemCode));
      if (!summary) continue;

      if (entry.sourceType === 'proforma') {
        summary.proformaReservedQty += entry.reservedQty;
      } else {
        summary.projectReservedQty += entry.reservedQty;
      }

      summary.totalReservedQty += entry.reservedQty;
      summary.availableStock = Math.max(0, summary.currentStock - summary.totalReservedQty);
      summary.totalReservedCost = fin(summary.totalReservedCost).add(entry.totalCost ?? 0).toNumber();
      summary.reservations.push(entry);
    }

    const itemSummaries = Array.from(itemSummariesMap.values()).filter(s => s.totalReservedQty > 0 || s.reservations.length > 0);

    const totalReservedItemsCount = itemSummaries.filter(s => s.totalReservedQty > 0).length;
    const totalReservedQty = allReservationEntries.reduce((sum, e) => sum + e.reservedQty, 0);
    const totalReservedCost = allReservationEntries.reduce((sum, e) => sum.add(e.totalCost ?? 0), fin(0)).toNumber();

    return {
      summaryMetrics: {
        totalReservedItemsCount,
        totalReservedQty,
        totalReservedCost,
        proformaReservationsCount: proformaCount,
        projectReservationsCount: projectCount
      },
      itemSummaries,
      allReservationEntries
    };
  }

  /**
   * v9.0.394 (TD-821): ردیف‌های رزرو پروژه‌های ثبت نهایی‌شده که مقدار مثبت دارند ولی به هیچ کالای فعالی (شناسه، کلید کد،
   * کلید نام) نمی‌رسند. گزارش رزروها آن‌ها را کنار می‌گذارد؛ بررسی سلامت مالی فهرستشان می‌کند و هیچ‌کدام خودکار تغییر نمی‌کند.
   */
  static async unmatchedProjectReservationRows(executor?: DbExecutor): Promise<UnmatchedProjectReservationRow[]> {
    const client = executor || orm;
    const rows = await readReservingProjectRows(client);
    const rowItems = await readItemsForProjectRows(client, rows);
    return rows
      .filter(r => !findProjectItemMatch({ itemId: r.itemId, code: r.code, name: r.name }, rowItems))
      .map(r => ({ projectId: r.projectId, projectCode: r.projectCode, projectTitle: r.projectTitle, index: r.index, code: r.code, name: r.name, qty: r.qty }));
  }

  /**
   * رزرو هر کالا (پیش‌فاکتور فروش و پروژه ثبت نهایی‌شده)، با شناسه کالا کلید خورده (v9.0.374، TD-822؛ پیش‌تر کد بزرگ‌شده).
   * v9.0.394 (TD-821): خطای خواندن رزرو به فراخواننده می‌رسد (فهرست کالا خطا می‌دهد، نه رزرو صفر).
   */
  static async getReservedStocksMap(scope?: ReservationScope): Promise<Record<string, ReservedStockInfo>> {
    const report = await ItemStockReservationService.getReservedStockDetails(undefined, true, scope);
    const map: Record<string, ReservedStockInfo> = {};

    for (const summary of report.itemSummaries) {
      const itemId = Number(summary.itemId);
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      map[String(itemId)] = {
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

