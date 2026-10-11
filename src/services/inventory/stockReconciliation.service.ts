import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { NEGATIVE_STOCK_POLICY } from './negativeStockPolicy.service.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { replayKardexWac, wacDiffersFromReplay, type KardexReplayRow } from './kardexReplay.js';

// v9.0.89 (TD-485): شکل پاسخ گزارش در `src/types/inventory.types.ts` مشترک سرور و صفحه است
export type {
  DiscrepancyType, ItemIntegrityAuditResult, WarehouseReconciliationSummary, InventoryIntegrityReport,
} from '../../types/inventory.types.js';
import type {
  DiscrepancyType, ItemIntegrityAuditResult, WarehouseReconciliationSummary, InventoryIntegrityReport,
} from '../../types/inventory.types.js';

// v8.0.7 (TD-266): کاردکس تفصیلی کالا به runningKardex.service.ts منتقل شد؛ نوع‌ها برای سازگاری بازصادر می‌شوند
export type { RunningKardexEntry, RunningKardexResponse } from './runningKardex.service.js';
import { buildItemRunningKardex, type RunningKardexResponse } from './runningKardex.service.js';

export class StockReconciliationService {
  /**
   * Performs 3-way stock reconciliation across:
   * 1. Scalar `current_stock` column
   * 2. Per-warehouse breakdown from `item_warehouse_stocks` (v7.0.48: the JSONB `stocks` column was dropped)
   * 3. Kardex ledger (`transactions` table sum)
   * With per-warehouse and per-location verification.
   */
  static async getIntegrityReport(params?: {
    discrepancyOnly?: boolean;
    type?: string;
    search?: string;
  }): Promise<InventoryIntegrityReport> {
    const conditions = [eq(items.isDeleted, 0)];

    if (params?.type && (params.type === 'product' || params.type === 'raw_material')) {
      conditions.push(eq(items.type, params.type));
    }

    const activeItems = await orm
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
      .where(and(...conditions))
      .orderBy(asc(items.code));

    const activeWarehouses = await orm
      .select({ code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, 1));
    // v7.0.48 (TD-214): موجودی تفکیکی انبارها از جدول نرمال (منبع حقیقت؛ ستون JSONB حذف شد)
    const tableStockMap = await ItemWarehouseStockService.getStocksForItems(orm, activeItems.map(i => i.id));

    // v7.0.37 (TD-201): معنای دفتر هم‌راستا با بازسازی رسمی کاردکس (KardexWacRecalculatorService) — حذف سند
    // ردیف مبدأ را حذف نرم و ردیف معکوس فعال درج می‌کند؛ ردیف معکوسِ ردیف حذف‌شده نباید دوباره شمرده شود،
    // وگرنه هر سند قطعی حذف‌شده مغایرت کاذب می‌سازد. transfer_in/transfer_out مانند in/out شمرده می‌شوند.
    // Global Kardex per item
    const kardexAggregates = await orm.execute(sql`
      SELECT 
        t.item_id,
        COALESCE(SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.quantity ELSE 0 END), 0) as total_in,
        COALESCE(SUM(CASE WHEN t.type IN ('out', 'transfer_out') THEN t.quantity ELSE 0 END), 0) as total_out,
        COALESCE(SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.quantity WHEN t.type IN ('out', 'transfer_out') THEN -t.quantity ELSE 0 END), 0) as kardex_balance,
        COALESCE(SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.total_price ELSE 0 END), 0) as total_in_value
      FROM ${transactions} t
      LEFT JOIN ${transactions} o ON o.id = t.reversal_of_id
      WHERE t.is_deleted = 0
        AND NOT (t.reversal_of_id IS NOT NULL AND COALESCE(o.is_deleted, 0) = 1)
      GROUP BY t.item_id
    `);

    const kardexMap = new Map<number, { totalIn: number; totalOut: number; kardexBalance: number; totalInValue: number }>();
    for (const r of kardexAggregates.rows as Record<string, unknown>[]) {
      kardexMap.set(Number(r.item_id), {
        totalIn: fin(Number(r.total_in) || 0).toNumber(),
        totalOut: fin(Number(r.total_out) || 0).toNumber(),
        kardexBalance: fin(Number(r.kardex_balance) || 0).toNumber(),
        totalInValue: fin(Number(r.total_in_value) || 0).toNumber(),
      });
    }

    // v9.0.88 (TD-486): همه ردیف‌های کاردکس کالاها (حذف‌شده‌ها هم) به ترتیب ثبت، برای بازپخش WAC با قاعده موتور زنده
    const replayRowsByItem = new Map<number, KardexReplayRow[]>();
    if (activeItems.length > 0) {
      const replayRows = await orm
        .select({
          id: transactions.id, itemId: transactions.itemId, type: transactions.type, quantity: transactions.quantity,
          unitPrice: transactions.unitPrice, documentType: transactions.documentType, documentRef: transactions.documentRef,
          reversalOfId: transactions.reversalOfId, isDeleted: transactions.isDeleted,
        })
        .from(transactions)
        .where(inArray(transactions.itemId, activeItems.map(i => i.id)))
        .orderBy(asc(transactions.id));
      for (const row of replayRows) {
        const list = replayRowsByItem.get(row.itemId) ?? [];
        list.push(row);
        replayRowsByItem.set(row.itemId, list);
      }
    }

    // Per-location Kardex breakdown per item
    const kardexLocAggregates = await orm.execute(sql`
      SELECT 
        t.item_id,
        COALESCE(t.location, '') as loc,
        COALESCE(SUM(CASE WHEN t.type IN ('in', 'transfer_in') THEN t.quantity WHEN t.type IN ('out', 'transfer_out') THEN -t.quantity ELSE 0 END), 0) as loc_balance
      FROM ${transactions} t
      LEFT JOIN ${transactions} o ON o.id = t.reversal_of_id
      WHERE t.is_deleted = 0
        AND NOT (t.reversal_of_id IS NOT NULL AND COALESCE(o.is_deleted, 0) = 1)
      GROUP BY t.item_id, COALESCE(t.location, '')
    `);

    const kardexLocMap = new Map<string, number>(); // key: `${itemId}_${loc}` -> balance
    for (const r of kardexLocAggregates.rows as Record<string, unknown>[]) {
      kardexLocMap.set(`${Number(r.item_id)}_${String(r.loc || '')}`, fin(Number(r.loc_balance) || 0).toNumber());
    }

    // Warehouse totals trackers
    const whJsonbTotals: Record<string, number> = {};
    const whLedgerTotals: Record<string, number> = {};
    for (const w of activeWarehouses) {
      whJsonbTotals[w.code] = 0;
      whLedgerTotals[w.code] = 0;
    }

    let audits: ItemIntegrityAuditResult[] = [];
    let totalScalarStock = 0;
    let totalKardexStock = 0;
    let totalScalarStockValue = 0;
    let totalKardexStockValue = 0;
    let healthyCount = 0;
    let discrepantCount = 0;
    let negativeStockItemsCount = 0;

    const searchTerm = (params?.search || '').trim().toLowerCase();

    for (const item of activeItems) {
      if (searchTerm) {
        const matchesCode = (item.code || '').toLowerCase().includes(searchTerm);
        const matchesName = (item.name || '').toLowerCase().includes(searchTerm);
        if (!matchesCode && !matchesName) continue;
      }

      const scalarStock = fin(item.currentStock).toNumber();
      const recordedWac = fin(item.weightedAverageCost).toNumber();
      const whBreakdown = tableStockMap.get(item.id)?.byCode ?? {};

      let whSum = 0;
      for (const [wCode, val] of Object.entries(whBreakdown)) {
        const parsedVal = fin(val).toNumber();
        whSum = FinancialMath.add(whSum, parsedVal);
        if (whJsonbTotals[wCode] !== undefined) {
          whJsonbTotals[wCode] = FinancialMath.add(whJsonbTotals[wCode], parsedVal);
        }
      }

      const kardexData = kardexMap.get(item.id) || { totalIn: 0, totalOut: 0, kardexBalance: 0, totalInValue: 0 };
      const kardexBalance = kardexData.kardexBalance;

      const itemKardexLocs: Record<string, number> = {};
      for (const w of activeWarehouses) {
        const locBal = kardexLocMap.get(`${item.id}_${w.code}`) || 0;
        itemKardexLocs[w.code] = locBal;
        whLedgerTotals[w.code] = FinancialMath.add(whLedgerTotals[w.code] || 0, locBal);
      }

      const discrepancies: DiscrepancyType[] = [];
      const anomalyDetails: string[] = [];

      if (Math.abs(scalarStock - whSum) > 0.0001) {
        discrepancies.push('scalar_vs_wh_sum');
        anomalyDetails.push(`موجودی کل (${scalarStock}) با مجموع انبارها (${whSum}) مغایرت دارد.`);
      }

      if (Math.abs(scalarStock - kardexBalance) > 0.0001) {
        discrepancies.push('scalar_vs_kardex');
        anomalyDetails.push(`موجودی کل (${scalarStock}) با مانده کاردکس (${kardexBalance}) مغایرت دارد.`);
      }

      if (Math.abs(whSum - kardexBalance) > 0.0001) {
        discrepancies.push('wh_sum_vs_kardex');
        anomalyDetails.push(`مجموع انبارها (${whSum}) با مانده کاردکس (${kardexBalance}) مغایرت دارد.`);
      }

      // Per-location check
      let hasLocMismatch = false;
      for (const w of activeWarehouses) {
        const storedLoc = fin(whBreakdown[w.code] || 0).toNumber();
        const ledgerLoc = fin(itemKardexLocs[w.code]).toNumber();
        if (Math.abs(storedLoc - ledgerLoc) > 0.0001) {
          hasLocMismatch = true;
          anomalyDetails.push(`انبار ${w.name} (${w.code}): موجودی ثبتی ${storedLoc} با کاردکس ${ledgerLoc} مغایرت دارد.`);
        }
      }
      if (hasLocMismatch) {
        discrepancies.push('location_vs_kardex_mismatch');
      }

      if (kardexBalance < 0 || scalarStock < 0) {
        discrepancies.push('kardex_negative');
        anomalyDetails.push(`مانده کالا منفی می‌باشد (موجودی دفتری: ${scalarStock}، کاردکس: ${kardexBalance}).`);
        negativeStockItemsCount++;
      }

      // v9.0.88 (TD-486): WAC محاسباتی همان بازپخش کاردکس بازسازی و ناوردایی I13 است (replayKardexWac، به ترتیب ثبت و با
      // قاعده «موجودی ≤ ۰ ← WAC = بهای ورود تازه»)؛ پیش‌تر میانگین همه ورودهای تاریخ بود و WAC درست کالایی که یک بار
      // به صفر رسیده و دوباره با قیمت دیگری خریده شده بود، همیشه «مغایر» شمرده می‌شد.
      const computedWac = replayKardexWac(replayRowsByItem.get(item.id) ?? [], recordedWac).wac.round(4).toNumber();

      if (wacDiffersFromReplay(recordedWac, computedWac, scalarStock)) {
        discrepancies.push('kardex_wac_mismatch');
        anomalyDetails.push(`نرخ میانگین موزون ثبتی (${recordedWac}) با بهای بازپخش کاردکس (${computedWac}) مغایرت دارد.`);
      }

      totalScalarStock = FinancialMath.add(totalScalarStock, scalarStock);
      totalKardexStock = FinancialMath.add(totalKardexStock, kardexBalance);

      const scalarValue = FinancialMath.multiply(scalarStock, recordedWac);
      const kardexValue = FinancialMath.multiply(kardexBalance, recordedWac);

      totalScalarStockValue = FinancialMath.add(totalScalarStockValue, scalarValue);
      totalKardexStockValue = FinancialMath.add(totalKardexStockValue, kardexValue);

      const isHealthy = discrepancies.length === 0;
      if (isHealthy) {
        healthyCount++;
      } else {
        discrepantCount++;
      }

      if (params?.discrepancyOnly && isHealthy) {
        continue;
      }

      audits.push({
        itemId: item.id,
        itemCode: item.code || '',
        itemName: item.name || '',
        category: item.category || 'عمومی',
        unit: item.unit || 'عدد',
        scalarCurrentStock: scalarStock,
        whStocksSum: whSum,
        kardexNetBalance: kardexBalance,
        recordedWac,
        computedWac,
        discrepancies,
        whBreakdown,
        kardexLocBreakdown: itemKardexLocs,
        kardexTotalIn: kardexData.totalIn,
        kardexTotalOut: kardexData.totalOut,
        hasKardexAnomalies: !isHealthy,
        anomalyDetails,
      });
    }

    const warehouseSummaries: WarehouseReconciliationSummary[] = activeWarehouses.map((w) => {
      const stored = whJsonbTotals[w.code] || 0;
      const ledger = whLedgerTotals[w.code] || 0;
      const variance = FinancialMath.subtract(stored, ledger);
      return {
        code: w.code,
        name: w.name,
        totalStockJsonb: stored,
        totalStockLedger: ledger,
        variance,
        isBalanced: Math.abs(variance) < 0.0001,
      };
    });

    const totalCount = activeItems.length;
    const healthScore = totalCount > 0 ? Math.round((healthyCount / totalCount) * 100) : 100;

    return {
      summary: {
        totalItems: totalCount,
        totalItemsChecked: totalCount,
        synchronizedItems: healthyCount,
        healthyItemsCount: healthyCount,
        discrepancyItems: discrepantCount,
        discrepantItemsCount: discrepantCount,
        negativeStockItems: negativeStockItemsCount,
        healthScorePercentage: healthScore,
        totalScalarStock,
        totalKardexStock,
        totalScalarStockValue,
        totalKardexStockValue,
        totalInventoryValuationStored: totalScalarStockValue,
        policy: NEGATIVE_STOCK_POLICY,
      },
      audits,
      warehouses: warehouseSummaries,
    };
  }

  /** کاردکس تفصیلی یک کالا؛ v8.0.7 (TD-266) به runningKardex.service.ts منتقل شد */
  static async getItemRunningKardex(itemId: number): Promise<RunningKardexResponse> {
    return buildItemRunningKardex(itemId);
  }
}
