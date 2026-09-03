import { orm } from '../../db/drizzle.js';
import { appSettings, items, transactions } from '../../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import { fin, FinancialMath } from '../../utils/financialMath.js';

export type NegativeStockPolicyType = 'forbidden' | 'warning' | 'allowed';

export interface NegativeStockCheckResult {
  allowed: boolean;
  wouldBeNegative: boolean;
  currentStock: number;
  deductionQty: number;
  projectedStock: number;
  policy: NegativeStockPolicyType;
  message?: string;
}

export interface NegativeStockViolationItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  currentStock: number;
  stocksBreakdown: Record<string, number>;
  negativeLocations: string[];
  kardexBalance: number;
  firstNegativeDate?: string;
  severity: 'critical' | 'warning';
}

export class NegativeStockPolicyService {
  private static readonly SETTING_KEY = 'negative_stock_policy';

  /**
   * Retrieves the configured negative stock policy.
   * Default is 'forbidden' to protect ERP data integrity.
   */
  static async getPolicy(externalTx?: any): Promise<NegativeStockPolicyType> {
    const db = externalTx || orm;
    try {
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, this.SETTING_KEY));

      if (setting?.value && ['forbidden', 'warning', 'allowed'].includes(setting.value)) {
        return setting.value as NegativeStockPolicyType;
      }
      return 'forbidden';
    } catch {
      return 'forbidden';
    }
  }

  /**
   * Updates the negative stock policy in app settings.
   */
  static async setPolicy(policy: NegativeStockPolicyType, externalTx?: any): Promise<void> {
    const db = externalTx || orm;
    const [existing] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, this.SETTING_KEY));

    if (existing) {
      await db
        .update(appSettings)
        .set({ value: policy })
        .where(eq(appSettings.key, this.SETTING_KEY));
    } else {
      await db
        .insert(appSettings)
        .values({ key: this.SETTING_KEY, value: policy });
    }
  }

  /**
   * Evaluates if a stock deduction is permissible under current policy.
   */
  static async checkStockDeduction(
    params: {
      itemId: number;
      location?: string;
      requestedQty: number;
    },
    externalTx?: any
  ): Promise<NegativeStockCheckResult> {
    const db = externalTx || orm;
    const policy = await this.getPolicy(externalTx);
    const qty = fin(params.requestedQty).toNumber();

    const [item] = await db
      .select({
        id: items.id,
        name: items.name,
        code: items.code,
        currentStock: items.currentStock,
        stocks: items.stocks,
      })
      .from(items)
      .where(and(eq(items.id, params.itemId), eq(items.isDeleted, 0)))
      .for('update');

    if (!item) {
      return {
        allowed: false,
        wouldBeNegative: true,
        currentStock: 0,
        deductionQty: qty,
        projectedStock: -qty,
        policy,
        message: `کالا با شناسه ${params.itemId} یافت نشد.`,
      };
    }

    const totalStock = fin(item.currentStock).toNumber();
    const loc = params.location ? String(params.location).trim() : '';
    const locStocks = (item.stocks as Record<string, number>) || {};
    const locStock = loc ? fin(locStocks[loc]).toNumber() : totalStock;

    const projectedTotal = FinancialMath.subtract(totalStock, qty);
    const projectedLoc = loc ? FinancialMath.subtract(locStock, qty) : projectedTotal;
    const wouldBeNegative = projectedTotal < 0 || (loc ? projectedLoc < 0 : false);

    if (wouldBeNegative && policy === 'forbidden') {
      return {
        allowed: false,
        wouldBeNegative: true,
        currentStock: totalStock,
        deductionQty: qty,
        projectedStock: projectedTotal,
        policy,
        message: loc
          ? `سیاست انبار اجازه موجودی منفی را نمی‌دهد. موجودی انبار '${loc}' (${locStock}) برای کسر ${qty} واحد کافی نیست.`
          : `سیاست انبار اجازه موجودی منفی را نمی‌دهد. موجودی کل کالا (${totalStock}) برای کسر ${qty} واحد کافی نیست.`,
      };
    }

    return {
      allowed: true,
      wouldBeNegative,
      currentStock: totalStock,
      deductionQty: qty,
      projectedStock: projectedTotal,
      policy,
      message: wouldBeNegative
        ? `هشدار: این تراکنش موجودی کالا در انبار '${loc}' را منفی می‌کند (${projectedLoc}).`
        : undefined,
    };
  }

  /**
   * Scans the catalog for items currently violating negative stock invariants.
   */
  static async getNegativeStockViolations(): Promise<NegativeStockViolationItem[]> {
    const activeItems = await orm
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        unit: items.unit,
        currentStock: items.currentStock,
        stocks: items.stocks,
      })
      .from(items)
      .where(eq(items.isDeleted, 0));

    const violations: NegativeStockViolationItem[] = [];

    for (const item of activeItems) {
      const currentStock = fin(item.currentStock).toNumber();
      const stocksObj = (item.stocks as Record<string, number>) || {};
      const negativeLocs: string[] = [];

      for (const [loc, qty] of Object.entries(stocksObj)) {
        if (fin(qty).toNumber() < 0) {
          negativeLocs.push(loc);
        }
      }

      if (currentStock < 0 || negativeLocs.length > 0) {
        violations.push({
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          unit: item.unit || 'عدد',
          currentStock,
          stocksBreakdown: stocksObj,
          negativeLocations: negativeLocs,
          kardexBalance: currentStock,
          severity: currentStock < 0 ? 'critical' : 'warning',
        });
      }
    }

    return violations;
  }
}
