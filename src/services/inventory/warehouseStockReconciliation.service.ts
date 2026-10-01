import { randomUUID } from 'crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, itemWarehouseStocks, inventoryReconciliationAnomalies, warehouses } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { logActivity } from '../../lib/auditLogger.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { logger } from '../../middleware/logger.js';

/**
 * v7.0.33 (TD-200 / audit P1-9): گزارش و ترمیم موجودی تفکیکی انبارها از روی دفتر کاردکس.
 *
 * مهاجرت 0014 موجودی JSONB را با صفر کردن مانده‌های منفی و بازنویسی (به‌جای جمع) کلیدهای هم‌انبار به
 * item_warehouse_stocks منتقل کرد. این سرویس جدول را با دفتر کاردکس (منبع حقیقت) مقایسه می‌کند و با تصمیم
 * مالک محصول:
 *  - فقط با اقدام دستی مدیر و پیش‌فرض «اجرای آزمایشی» اصلاح می‌کند؛
 *  - فقط مقدار موجودی را اصلاح می‌کند، نه بهای میانگین موزون؛
 *  - جایی که مانده کاردکس منفی است چیزی را تغییر نمی‌دهد و «نیازمند سند انبارگردانی» گزارش می‌کند؛
 *  - کالایی که گردش کاردکس آن به انبار شناخته‌شده‌ای نگاشت نمی‌شود را دست نمی‌زند و گزارش می‌کند؛
 *  - هر اصلاح و هر امتناع را در inventory_reconciliation_anomalies و لاگ ممیزی ثبت می‌کند.
 *
 * معنای دفتر همان بازسازی رسمی کاردکس است (KardexWacRecalculatorService): ردیف‌های فعال، بدون ردیف‌های معکوسی
 * که ردیف مبدأشان حذف نرم شده است (حذف سند هر دو را خنثی می‌کند).
 */

const EPSILON = 0.0001;

export type ReconRowStatus = 'ok' | 'mismatch' | 'negative_ledger' | 'blocked_unresolved';

export interface WarehouseStockReconRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  ledgerQty: number;
  tableQty: number | null;
  jsonQty: number | null;
  storedCode: string | null;
  status: ReconRowStatus;
  codeMismatch: boolean;
}

export interface UnresolvedLedgerLocation {
  itemId: number;
  itemCode: string;
  location: string;
  qty: number;
}

export interface ItemCacheMismatch {
  itemId: number;
  itemCode: string;
  currentStock: number;
  tableSum: number;
}

export interface WarehouseStockReconReport {
  generatedAt: string;
  summary: {
    itemsChecked: number;
    rowsChecked: number;
    mismatchRows: number;
    negativeLedgerRows: number;
    blockedItems: number;
    codeMismatchRows: number;
    cacheMismatchItems: number;
    repairableItems: number;
  };
  rows: WarehouseStockReconRow[];
  unresolvedLocations: UnresolvedLedgerLocation[];
  cacheMismatches: ItemCacheMismatch[];
}

export interface PlannedChange {
  itemId: number;
  itemCode: string;
  warehouseId: number;
  warehouseCode: string;
  ledgerQty: number;
  beforeQty: number;
  afterQty: number;
}

export interface WarehouseStockRepairResult {
  runId: string;
  dryRun: boolean;
  locked: boolean;
  itemsRepaired: number;
  rowsChanged: number;
  negativeLedgerRows: number;
  blockedItems: number;
  changes: PlannedChange[];
}

interface WarehouseRef { id: number; code: string; name: string; isActive: number | null }

type ItemSnapshot = { id: number; code: string | null; name: string; currentStock: number | null; stocks: unknown };

interface ItemAnalysis {
  item: ItemSnapshot;
  rows: WarehouseStockReconRow[];
  unresolved: UnresolvedLedgerLocation[];
  tableSum: number;
  cacheMismatch: boolean;
}

function createLocationResolver(all: WarehouseRef[]) {
  const sorted = [...all].sort((a, b) => a.id - b.id);
  const defaultWh = sorted.find(w => w.isActive === 1) ?? sorted[0] ?? null;
  const byCode = new Map(sorted.map(w => [w.code.trim().toLowerCase(), w]));
  const byName = new Map<string, WarehouseRef>();
  for (const w of sorted) {
    const key = (w.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, w);
  }
  return (raw: unknown): WarehouseRef | null => {
    const key = String(raw ?? '').trim().toLowerCase();
    // ردیف‌های قدیمی بدون انبار و ردیف‌های معکوس با برچسب 'default' به انبار پیش‌فرض تعلق دارند
    if (!key || key === 'default') return defaultWh;
    return byCode.get(key) ?? byName.get(key) ?? null;
  };
}

async function loadLedger(executor: DbExecutor, itemIds?: number[]): Promise<Array<{ itemId: number; location: string; qty: number }>> {
  const itemFilter = itemIds && itemIds.length > 0
    ? sql`AND t.item_id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})`
    : sql``;
  const res = await executor.execute(sql`
    SELECT t.item_id, COALESCE(t.location, '') AS location,
           SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.quantity
                    WHEN t.type IN ('out', 'transfer_out') THEN -t.quantity
                    ELSE 0 END) AS qty
    FROM transactions t
    LEFT JOIN transactions o ON o.id = t.reversal_of_id
    WHERE t.is_deleted = 0
      AND NOT (t.reversal_of_id IS NOT NULL AND COALESCE(o.is_deleted, 0) = 1)
      ${itemFilter}
    GROUP BY t.item_id, COALESCE(t.location, '')
  `);
  return ((res.rows || []) as Array<Record<string, unknown>>).map(r => ({
    itemId: Number(r.item_id),
    location: String(r.location ?? ''),
    qty: fin(Number(r.qty) || 0).round(4).toNumber(),
  }));
}

function analyzeItem(
  item: ItemSnapshot,
  ledger: Array<{ location: string; qty: number }>,
  tableRows: Array<{ warehouseId: number; warehouseCode: string; currentStock: number }>,
  resolve: (raw: unknown) => WarehouseRef | null,
  warehouseById: Map<number, WarehouseRef>
): ItemAnalysis {
  const ledgerByWh = new Map<number, number>();
  const unresolved: UnresolvedLedgerLocation[] = [];
  for (const l of ledger) {
    const wh = resolve(l.location);
    if (!wh) {
      if (Math.abs(l.qty) > EPSILON) {
        unresolved.push({ itemId: item.id, itemCode: item.code || '', location: l.location, qty: l.qty });
      }
      continue;
    }
    ledgerByWh.set(wh.id, fin(ledgerByWh.get(wh.id) ?? 0).add(l.qty).round(4).toNumber());
  }

  const jsonByWh = new Map<number, number>();
  const stocks = (item.stocks && typeof item.stocks === 'object' ? item.stocks : {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(stocks)) {
    const wh = resolve(key);
    const num = Number(val);
    if (wh && Number.isFinite(num)) {
      jsonByWh.set(wh.id, fin(jsonByWh.get(wh.id) ?? 0).add(num).round(4).toNumber());
    }
  }

  const tableByWh = new Map(tableRows.map(r => [r.warehouseId, r]));
  const warehouseIds = new Set<number>([...ledgerByWh.keys(), ...tableByWh.keys()]);
  const blocked = unresolved.length > 0;
  const rows: WarehouseStockReconRow[] = [];
  let tableSum = fin(0);
  for (const r of tableRows) tableSum = tableSum.add(r.currentStock);

  for (const whId of [...warehouseIds].sort((a, b) => a - b)) {
    const wh = warehouseById.get(whId);
    if (!wh) continue;
    const ledgerQty = ledgerByWh.get(whId) ?? 0;
    const table = tableByWh.get(whId);
    const tableQty = table ? table.currentStock : null;
    const codeMismatch = Boolean(table && table.warehouseCode !== wh.code);
    const qtyMismatch = Math.abs(ledgerQty - (tableQty ?? 0)) > EPSILON;
    let status: ReconRowStatus = 'ok';
    if (ledgerQty < -EPSILON) status = 'negative_ledger';
    else if (qtyMismatch) status = blocked ? 'blocked_unresolved' : 'mismatch';
    rows.push({
      itemId: item.id,
      itemCode: item.code || '',
      itemName: item.name,
      warehouseId: whId,
      warehouseCode: wh.code,
      warehouseName: wh.name,
      ledgerQty,
      tableQty,
      jsonQty: jsonByWh.has(whId) ? jsonByWh.get(whId)! : null,
      storedCode: table ? table.warehouseCode : null,
      status,
      codeMismatch,
    });
  }

  const tableSumNum = tableSum.round(4).toNumber();
  const jsonDiffers = rows.some(r => Math.abs((r.jsonQty ?? 0) - (r.tableQty ?? 0)) > EPSILON);
  const cacheMismatch = Math.abs(Number(item.currentStock || 0) - tableSumNum) > EPSILON || jsonDiffers;
  return { item, rows, unresolved, tableSum: tableSumNum, cacheMismatch };
}

function needsRepair(a: ItemAnalysis): boolean {
  if (a.unresolved.length > 0) return false;
  return a.cacheMismatch || a.rows.some(r => r.status === 'mismatch' || r.codeMismatch);
}

export class WarehouseStockReconciliationService {
  private static async analyze(executor: DbExecutor, itemIds?: number[]): Promise<ItemAnalysis[]> {
    const allWarehouses: WarehouseRef[] = await executor
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses);
    const resolve = createLocationResolver(allWarehouses);
    const warehouseById = new Map(allWarehouses.map(w => [w.id, w]));

    const itemConds = [eq(items.isDeleted, 0)];
    if (itemIds && itemIds.length > 0) itemConds.push(inArray(items.id, itemIds));
    const itemRows: ItemSnapshot[] = await executor
      .select({ id: items.id, code: items.code, name: items.name, currentStock: items.currentStock, stocks: items.stocks })
      .from(items)
      .where(and(...itemConds))
      .orderBy(asc(items.id));
    if (itemRows.length === 0) return [];
    const ids = itemRows.map(i => i.id);

    const ledger = await loadLedger(executor, itemIds && itemIds.length > 0 ? ids : undefined);
    const tableRows = await executor
      .select({ itemId: itemWarehouseStocks.itemId, warehouseId: itemWarehouseStocks.warehouseId, warehouseCode: itemWarehouseStocks.warehouseCode, currentStock: itemWarehouseStocks.currentStock })
      .from(itemWarehouseStocks)
      .where(itemIds && itemIds.length > 0 ? inArray(itemWarehouseStocks.itemId, ids) : sql`TRUE`);

    const ledgerByItem = new Map<number, Array<{ location: string; qty: number }>>();
    for (const l of ledger) {
      if (!ledgerByItem.has(l.itemId)) ledgerByItem.set(l.itemId, []);
      ledgerByItem.get(l.itemId)!.push(l);
    }
    const tableByItem = new Map<number, Array<{ warehouseId: number; warehouseCode: string; currentStock: number }>>();
    for (const t of tableRows) {
      if (!tableByItem.has(t.itemId)) tableByItem.set(t.itemId, []);
      tableByItem.get(t.itemId)!.push({ warehouseId: t.warehouseId, warehouseCode: t.warehouseCode, currentStock: Number(t.currentStock) || 0 });
    }

    return itemRows.map(item => analyzeItem(item, ledgerByItem.get(item.id) ?? [], tableByItem.get(item.id) ?? [], resolve, warehouseById));
  }

  /** گزارش فقط‌خواندنی مغایرت موجودی انبارها با کاردکس (به‌صورت پیش‌فرض فقط ردیف‌های غیرسالم) */
  static async getReport(options?: { includeHealthy?: boolean }): Promise<WarehouseStockReconReport> {
    const analyses = await this.analyze(orm);
    const allRows = analyses.flatMap(a => a.rows);
    const rows = options?.includeHealthy ? allRows : allRows.filter(r => r.status !== 'ok' || r.codeMismatch);
    const cacheMismatches = analyses
      .filter(a => a.cacheMismatch)
      .map(a => ({ itemId: a.item.id, itemCode: a.item.code || '', currentStock: Number(a.item.currentStock || 0), tableSum: a.tableSum }));
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        itemsChecked: analyses.length,
        rowsChecked: allRows.length,
        mismatchRows: allRows.filter(r => r.status === 'mismatch').length,
        negativeLedgerRows: allRows.filter(r => r.status === 'negative_ledger').length,
        blockedItems: analyses.filter(a => a.unresolved.length > 0).length,
        codeMismatchRows: allRows.filter(r => r.codeMismatch).length,
        cacheMismatchItems: cacheMismatches.length,
        repairableItems: analyses.filter(needsRepair).length,
      },
      rows,
      unresolvedLocations: analyses.flatMap(a => a.unresolved),
      cacheMismatches,
    };
  }

  /**
   * ترمیم دستی. پیش‌فرض اجرای آزمایشی است (dryRun=true) و فقط برنامه تغییرات را برمی‌گرداند.
   * در اجرای واقعی، هر کالا در تراکنش جدا تحت قفل سطری کالا و ردیف‌های موجودی آن دوباره تحلیل و اصلاح می‌شود.
   */
  static async repair(options: { dryRun?: boolean; itemIds?: number[]; userId?: number; username?: string }): Promise<WarehouseStockRepairResult> {
    const dryRun = options.dryRun !== false;
    const runId = `recon_${randomUUID()}`;
    const username = options.username || 'سیستم';
    const empty = (locked: boolean): WarehouseStockRepairResult => ({
      runId, dryRun, locked, itemsRepaired: 0, rowsChanged: 0, negativeLedgerRows: 0, blockedItems: 0, changes: [],
    });

    if (dryRun) {
      const analyses = await this.analyze(orm, options.itemIds);
      const result = empty(false);
      for (const a of analyses) {
        if (a.unresolved.length > 0) { result.blockedItems++; continue; }
        result.negativeLedgerRows += a.rows.filter(r => r.status === 'negative_ledger').length;
        if (!needsRepair(a)) continue;
        const changes = this.planChanges(a);
        if (changes.length > 0 || a.cacheMismatch) result.itemsRepaired++;
        result.rowsChanged += changes.length;
        result.changes.push(...changes);
      }
      return result;
    }

    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WAREHOUSE_STOCK_REPAIR, async () => {
      const result = empty(false);
      // فقط کالاهای نیازمند اصلاح یا ثبت امتناع (منفی / محل نامعلوم) قفل و بررسی دوباره می‌شوند
      const candidates = (await this.analyze(orm, options.itemIds))
        .filter(a => needsRepair(a) || a.unresolved.length > 0 || a.rows.some(r => r.status === 'negative_ledger'))
        .map(a => a.item.id);
      for (const itemId of candidates) {
        await orm.transaction(async (tx) => {
          // قفل سطری کالا (سطح ITEMS_STOCK) سپس ردیف‌های موجودی آن — همان ترتیب applyStockMovement
          const [locked] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('update');
          if (!locked) return;
          await tx.select({ id: itemWarehouseStocks.id }).from(itemWarehouseStocks).where(eq(itemWarehouseStocks.itemId, itemId)).for('update');

          const [analysis] = await this.analyze(tx, [itemId]);
          if (!analysis) return;
          const anomalies: Array<typeof inventoryReconciliationAnomalies.$inferInsert> = [];

          if (analysis.unresolved.length > 0) {
            result.blockedItems++;
            for (const u of analysis.unresolved) {
              anomalies.push({ runId, itemId, warehouseCode: u.location, kind: 'unresolved_location', ledgerQty: u.qty, details: `گردش کاردکس با محل «${u.location}» به هیچ انباری نگاشت نمی‌شود؛ کالا اصلاح نشد.`, createdBy: username });
            }
            await tx.insert(inventoryReconciliationAnomalies).values(anomalies);
            return;
          }

          for (const r of analysis.rows.filter(x => x.status === 'negative_ledger')) {
            result.negativeLedgerRows++;
            anomalies.push({ runId, itemId, warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, kind: 'negative_ledger', ledgerQty: r.ledgerQty, beforeQty: r.tableQty, afterQty: r.tableQty, details: 'مانده کاردکس منفی است؛ نیازمند سند انبارگردانی — مقدار تغییر داده نشد.', createdBy: username });
          }

          if (needsRepair(analysis)) {
            const changes = await this.applyRepair(tx, analysis);
            for (const c of changes) {
              anomalies.push({ runId, itemId, warehouseId: c.warehouseId, warehouseCode: c.warehouseCode, kind: 'repaired', ledgerQty: c.ledgerQty, beforeQty: c.beforeQty, afterQty: c.afterQty, details: 'مقدار موجودی انبار از روی کاردکس اصلاح شد.', createdBy: username });
            }
            result.itemsRepaired++;
            result.rowsChanged += changes.length;
            result.changes.push(...changes);

            const after = await tx.select({ currentStock: items.currentStock, stocks: items.stocks }).from(items).where(eq(items.id, itemId));
            await logActivity({
              tx,
              userId: options.userId,
              username,
              action: 'AUDIT_APPLY',
              entity: 'کالا',
              entityId: itemId,
              description: `ترمیم موجودی انبارهای کالا ${analysis.item.name} (${analysis.item.code || itemId}) از روی کاردکس`,
              details: {
                runId,
                before: { currentStock: analysis.item.currentStock, stocks: analysis.item.stocks },
                after: { currentStock: after[0]?.currentStock, stocks: after[0]?.stocks },
                changes,
              },
            });
            await OutboxService.saveToOutbox(tx, domainEventBus.createEvent(
              DomainEventType.STOCK_ADJUSTED,
              'Item',
              String(itemId),
              {
                itemId,
                itemCode: analysis.item.code,
                itemName: analysis.item.name,
                oldStock: Number(analysis.item.currentStock || 0),
                newStock: Number(after[0]?.currentStock || 0),
                reason: 'ترمیم موجودی انبارها از روی کاردکس (TD-200)',
              },
              { userId: options.userId, userName: username }
            ));
          }

          if (anomalies.length > 0) {
            await tx.insert(inventoryReconciliationAnomalies).values(anomalies);
          }
        });
      }
      return result;
    });

    if (!outcome.acquired) return empty(true);
    logger.info({ message: `[WarehouseStockReconciliation] run=${runId} items=${outcome.result.itemsRepaired} rows=${outcome.result.rowsChanged} negative=${outcome.result.negativeLedgerRows} blocked=${outcome.result.blockedItems}` });
    return outcome.result;
  }

  private static planChanges(a: ItemAnalysis): PlannedChange[] {
    return a.rows
      .filter(r => r.status === 'mismatch' || (r.codeMismatch && r.status !== 'negative_ledger'))
      .map(r => ({
        itemId: a.item.id,
        itemCode: a.item.code || '',
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        ledgerQty: r.ledgerQty,
        beforeQty: r.tableQty ?? 0,
        afterQty: r.status === 'mismatch' ? r.ledgerQty : (r.tableQty ?? 0),
      }));
  }

  /** Read-Calculate-Update: ردیف‌های موجودی را به مانده کاردکس می‌برد و کش JSONB و current_stock را از جدول بازمی‌سازد */
  private static async applyRepair(tx: DbExecutor, a: ItemAnalysis): Promise<PlannedChange[]> {
    const changes = this.planChanges(a);
    const nowIso = new Date().toISOString();
    for (const c of changes) {
      const [existing] = await tx.select().from(itemWarehouseStocks)
        .where(and(eq(itemWarehouseStocks.itemId, c.itemId), eq(itemWarehouseStocks.warehouseId, c.warehouseId)));
      if (existing) {
        await tx.update(itemWarehouseStocks).set({
          currentStock: c.afterQty,
          warehouseCode: c.warehouseCode,
          version: existing.version + 1,
          updatedAt: nowIso,
        }).where(eq(itemWarehouseStocks.id, existing.id));
      } else if (c.afterQty > EPSILON) {
        await tx.insert(itemWarehouseStocks).values({
          itemId: c.itemId,
          warehouseId: c.warehouseId,
          warehouseCode: c.warehouseCode,
          currentStock: c.afterQty,
          reservedStock: 0,
          version: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    // کش JSONB و موجودی کل از جدول نرمال (با کد استاندارد انبار) بازسازی می‌شوند؛ بهای میانگین موزون دست نمی‌خورد
    const rows = await tx.select({ warehouseCode: itemWarehouseStocks.warehouseCode, currentStock: itemWarehouseStocks.currentStock })
      .from(itemWarehouseStocks)
      .where(eq(itemWarehouseStocks.itemId, a.item.id));
    const stocksJson: Record<string, number> = {};
    let total = fin(0);
    for (const r of rows) {
      const val = fin(Number(r.currentStock) || 0).round(4).toNumber();
      stocksJson[r.warehouseCode] = fin(stocksJson[r.warehouseCode] ?? 0).add(val).round(4).toNumber();
      total = total.add(val);
    }
    const [itemRow] = await tx.select({ version: items.version }).from(items).where(eq(items.id, a.item.id));
    await tx.update(items).set({
      stocks: stocksJson,
      currentStock: total.round(4).toNumber(),
      version: nextVersion(itemRow?.version ?? 1),
    }).where(eq(items.id, a.item.id));
    return changes;
  }
}
