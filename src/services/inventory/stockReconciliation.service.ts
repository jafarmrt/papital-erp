import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import { fin, FinancialMath } from '../../utils/financialMath.js';
import { NegativeStockPolicyService, type NegativeStockPolicyType } from './negativeStockPolicy.service.js';

export type DiscrepancyType =
  | 'scalar_vs_wh_sum'
  | 'scalar_vs_kardex'
  | 'wh_sum_vs_kardex'
  | 'location_vs_kardex_mismatch'
  | 'kardex_negative'
  | 'kardex_wac_mismatch'
  | 'none';

export interface ItemIntegrityAuditResult {
  itemId: number;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  scalarCurrentStock: number;
  whStocksSum: number;
  kardexNetBalance: number;
  recordedWac: number;
  computedWac: number;
  discrepancies: DiscrepancyType[];
  whBreakdown: Record<string, number>;
  kardexLocBreakdown: Record<string, number>;
  kardexTotalIn: number;
  kardexTotalOut: number;
  hasKardexAnomalies: boolean;
  anomalyDetails: string[];
}

export interface WarehouseReconciliationSummary {
  code: string;
  name: string;
  totalStockJsonb: number;
  totalStockLedger: number;
  variance: number;
  isBalanced: boolean;
}

export interface InventoryIntegrityReport {
  summary: {
    totalItems: number;
    totalItemsChecked: number;
    synchronizedItems: number;
    healthyItemsCount: number;
    discrepancyItems: number;
    discrepantItemsCount: number;
    negativeStockItems: number;
    healthScorePercentage: number;
    totalScalarStock: number;
    totalKardexStock: number;
    totalScalarStockValue: number;
    totalKardexStockValue: number;
    totalInventoryValuationStored: number;
    policy: NegativeStockPolicyType;
  };
  audits: ItemIntegrityAuditResult[];
  warehouses: WarehouseReconciliationSummary[];
}

export interface RunningKardexEntry {
  transactionId: number;
  date: string;
  type: 'in' | 'out' | 'transfer';
  documentType: string;
  documentRef: string;
  location: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  runningBalance: number;
  runningLocationStock: number;
  runningGlobalStock: number;
  runningWac: number;
  runningTotalValue: number;
  notes: string;
  createdBy: string;
  reversalOfId?: number | null;
  isReversal?: boolean;
}

/**
 * V10-0.2: Full kardex envelope. Previously this endpoint returned a bare
 * array while the frontend modal expected { item, summary, entries } —
 * dereferencing data.item.name on an array crashed React (white screen).
 */
export interface RunningKardexResponse {
  item: {
    id: number;
    code: string;
    name: string;
    unit: string;
    category: string | null;
    type: string | null;
    currentStock: number;
    weightedAverageCost: number;
  };
  summary: {
    totalIn: number;
    totalOut: number;
    netBalance: number;
    transactionCount: number;
    valuation: number;
  };
  entries: RunningKardexEntry[];
}

export class StockReconciliationService {
  /**
   * Performs 3-way stock reconciliation across:
   * 1. Scalar `current_stock` column
   * 2. JSONB `stocks` warehouse breakdown sum
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
        stocks: items.stocks,
      })
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.code));

    const activeWarehouses = await orm
      .select({ code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, 1));

    // Helper to check if a warehouse code is default / primary warehouse
    const defaultWarehouseCode = activeWarehouses[0]?.code || 'WH-001';
    const isDefaultAlias = (code: string) => ['main', 'WH-MAIN', 'انبار مرکزی', defaultWarehouseCode].includes(code);

    // Global Kardex per item
    const kardexAggregates = await orm.execute(sql`
      SELECT 
        item_id,
        COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END), 0) as total_in,
        COALESCE(SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END), 0) as total_out,
        COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) as kardex_balance
      FROM ${transactions}
      WHERE is_deleted = 0
      GROUP BY item_id
    `);

    const kardexMap = new Map<number, { totalIn: number; totalOut: number; kardexBalance: number }>();
    for (const r of kardexAggregates.rows) {
      kardexMap.set(Number(r.item_id), {
        totalIn: fin(r.total_in as any).toNumber(),
        totalOut: fin(r.total_out as any).toNumber(),
        kardexBalance: fin(r.kardex_balance as any).toNumber(),
      });
    }

    // Per-location Kardex breakdown per item
    const kardexLocAggregates = await orm.execute(sql`
      SELECT 
        item_id,
        COALESCE(location, 'main') as loc,
        COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) as loc_balance
      FROM ${transactions}
      WHERE is_deleted = 0
      GROUP BY item_id, COALESCE(location, 'main')
    `);

    const kardexLocMap = new Map<string, number>(); // key: `${itemId}_${loc}` -> balance
    for (const r of kardexLocAggregates.rows) {
      kardexLocMap.set(`${Number(r.item_id)}_${r.loc}`, fin(r.loc_balance as any).toNumber());
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
      const whBreakdown = (item.stocks as Record<string, number>) || {};

      let whSum = 0;
      for (const [wCode, val] of Object.entries(whBreakdown)) {
        const parsedVal = fin(val).toNumber();
        whSum = FinancialMath.add(whSum, parsedVal);
        if (whJsonbTotals[wCode] !== undefined) {
          whJsonbTotals[wCode] = FinancialMath.add(whJsonbTotals[wCode], parsedVal);
        }
      }

      const kardexData = kardexMap.get(item.id) || { totalIn: 0, totalOut: 0, kardexBalance: 0 };
      const kardexBalance = kardexData.kardexBalance;

      const itemKardexLocs: Record<string, number> = {};
      for (const w of activeWarehouses) {
        let locBal = kardexLocMap.get(`${item.id}_${w.code}`);
        if (locBal === undefined && isDefaultAlias(w.code)) {
          locBal = kardexLocMap.get(`${item.id}_main`) ?? kardexLocMap.get(`${item.id}_WH-MAIN`) ?? kardexLocMap.get(`${item.id}_${defaultWarehouseCode}`) ?? 0;
        }
        locBal = locBal || 0;
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
        let storedLocVal = whBreakdown[w.code];
        if (storedLocVal === undefined && isDefaultAlias(w.code)) {
          storedLocVal = whBreakdown['main'] ?? whBreakdown['WH-MAIN'] ?? whBreakdown['انبار مرکزی'] ?? whBreakdown[defaultWarehouseCode];
        }
        const storedLoc = fin(storedLocVal).toNumber();
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
        anomalyDetails.push(`مانده کالا منفی می‌باشد (موجودی اسمی: ${scalarStock}، کاردکس: ${kardexBalance}).`);
        negativeStockItemsCount++;
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
        computedWac: recordedWac,
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
    const currentPolicy = await NegativeStockPolicyService.getPolicy();

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
        policy: currentPolicy,
      },
      audits,
      warehouses: warehouseSummaries,
    };
  }

  /**
   * Generates sequential running Kardex for a specific item (V10-0.2 full envelope).
   */
  static async getItemRunningKardex(itemId: number): Promise<RunningKardexResponse> {
    const [item] = await orm
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        unit: items.unit,
        category: items.category,
        type: items.type,
        currentStock: items.currentStock,
        weightedAverageCost: items.weightedAverageCost,
      })
      .from(items)
      .where(eq(items.id, itemId));
    const defaultWac = fin(item?.weightedAverageCost || 0).toNumber();

    const itemTxs = await orm
      .select()
      .from(transactions)
      .where(and(eq(transactions.itemId, itemId), eq(transactions.isDeleted, 0)))
      .orderBy(asc(transactions.date), asc(transactions.id));

    let runningBal = 0;
    let runningWac = defaultWac;
    const locationRunning: Record<string, number> = {};
    let totalIn = 0;
    let totalOut = 0;
    const entries: RunningKardexEntry[] = [];

    for (const tx of itemTxs) {
      const qty = fin(tx.quantity).toNumber();
      const unitPrice = defaultWac;

      if (tx.type === 'in') {
        runningBal = FinancialMath.add(runningBal, qty);
        totalIn = FinancialMath.add(totalIn, qty);
      } else if (tx.type === 'out') {
        runningBal = FinancialMath.subtract(runningBal, qty);
        totalOut = FinancialMath.add(totalOut, qty);
      }

      const loc = tx.location || 'main';
      if (!locationRunning[loc]) locationRunning[loc] = 0;
      if (tx.type === 'in') {
        locationRunning[loc] = FinancialMath.add(locationRunning[loc], qty);
      } else if (tx.type === 'out') {
        locationRunning[loc] = FinancialMath.subtract(locationRunning[loc], qty);
      }

      entries.push({
        transactionId: tx.id,
        date: tx.date || '',
        type: tx.type as 'in' | 'out' | 'transfer',
        documentType: tx.documentType || '',
        documentRef: tx.documentRef || '',
        location: loc,
        quantity: qty,
        unitPrice,
        totalAmount: FinancialMath.multiply(qty, unitPrice),
        runningBalance: runningBal,
        runningLocationStock: locationRunning[loc],
        runningGlobalStock: runningBal,
        runningWac,
        runningTotalValue: FinancialMath.multiply(runningBal, runningWac),
        notes: tx.notes || '',
        createdBy: tx.createdBy || 'سیستم',
        reversalOfId: tx.reversalOfId,
        isReversal: Boolean(tx.reversalOfId),
      });
    }

    return {
      item: {
        id: Number(item?.id || itemId),
        code: item?.code || '-',
        name: item?.name || `کالای ${itemId}`,
        unit: item?.unit || 'عدد',
        category: item?.category ?? null,
        type: item?.type ?? null,
        currentStock: fin(item?.currentStock || 0).toNumber(),
        weightedAverageCost: defaultWac,
      },
      summary: {
        totalIn,
        totalOut,
        netBalance: runningBal,
        transactionCount: entries.length,
        valuation: FinancialMath.multiply(runningBal, runningWac),
      },
      entries,
    };
  }
}
