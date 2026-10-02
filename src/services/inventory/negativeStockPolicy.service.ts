import { orm, DbExecutor } from '../../db/drizzle.js';
import { appSettings, items } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';

/**
 * v7.0.22 (TD-180 / audit P0-3): سیاست موجودی منفی به تصمیم مالک محصول فقط «ممنوع» است.
 * قید دیتابیسی chk_iws_current_stock_non_negative (مهاجرت 0014) آخرین خط دفاع است و
 * گزینه‌های قدیمی «هشدار» و «مجاز» با آن در تضاد بودند (خطای ۵۰۰ هنگام خروج کالا).
 */
export const NEGATIVE_STOCK_POLICY = 'forbidden' as const;
export type NegativeStockPolicyType = typeof NEGATIVE_STOCK_POLICY;

/** مقادیر قدیمی که ممکن است هنوز در app_settings ذخیره شده باشند و نادیده گرفته می‌شوند */
const LEGACY_POLICY_VALUES = new Set(['warning', 'allowed']);
let legacyPolicyWarningLogged = false;

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
   * Returns the effective negative stock policy — always 'forbidden' (TD-180).
   * A legacy stored value ('warning' / 'allowed') is ignored and reported once per process.
   */
  static async getPolicy(externalTx?: DbExecutor): Promise<NegativeStockPolicyType> {
    if (!legacyPolicyWarningLogged) {
      const db = externalTx || orm;
      try {
        const [setting] = await db
          .select()
          .from(appSettings)
          .where(eq(appSettings.key, this.SETTING_KEY));
        if (setting?.value && LEGACY_POLICY_VALUES.has(setting.value)) {
          legacyPolicyWarningLogged = true;
          logger.warn(
            `[NegativeStockPolicy] Legacy stored value '${setting.value}' ignored — negative stock is always forbidden (TD-180, DB constraint chk_iws_current_stock_non_negative).`
          );
        }
      } catch {
        // خواندن تنظیم فقط برای گزارش مقدار قدیمی است؛ سیاست مؤثر در هر حال «ممنوع» است
      }
    }
    return NEGATIVE_STOCK_POLICY;
  }

  /**
   * Persists the negative stock policy. Only 'forbidden' is accepted (TD-180).
   */
  static async setPolicy(policy: string, externalTx?: DbExecutor): Promise<void> {
    if (policy !== NEGATIVE_STOCK_POLICY) {
      throw new ValidationError(
        'منفی شدن موجودی انبار در این سامانه مجاز نیست و تنها سیاست قابل انتخاب «ممنوعیت کامل» است.'
      );
    }
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
    legacyPolicyWarningLogged = false;
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
    externalTx?: DbExecutor
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

    // v7.0.45 (audit P2-1): موجودی از جدول موجودی انبارها (منبع حقیقت)، نه کش JSONB
    const snapshot = await ItemWarehouseStockService.getStockSnapshot(db, item.id);
    const totalStock = snapshot.total;
    const loc = params.location ? String(params.location).trim() : '';
    const locStock = loc ? fin(snapshot.byCode[loc] ?? 0).toNumber() : totalStock;

    const projectedTotal = FinancialMath.subtract(totalStock, qty);
    const projectedLoc = loc ? FinancialMath.subtract(locStock, qty) : projectedTotal;
    const wouldBeNegative = projectedTotal < 0 || (loc ? projectedLoc < 0 : false);

    if (wouldBeNegative) {
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
