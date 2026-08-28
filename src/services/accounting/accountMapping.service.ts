import { orm } from '../../db/drizzle.js';
import { appSettings, accounts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { logger } from '../../middleware/logger.js';
import type { Account } from '../../types.js';

export interface ConceptualAccountMappingConfig {
  directProductionWagesAccountCode: string; // Default: '6002' (دستمزد مستقیم تولید)
  wagesPayableAccountCode: string;          // Default: '3201' (حقوق و دستمزد پرداختنی)
  salesRevenueAccountCode: string;          // Default: '5001' (درآمد فروش محصولات کارگاهی)
  tradeReceivablesAccountCode: string;      // Default: '1201' (بدهکاران تجاری / مشتریان)
  tradePayablesAccountCode: string;         // Default: '3001' (بستانکاران تجاری / تامین‌کنندگان)
  salesDiscountAccountCode: string;         // Default: '5102' (تخفیفات اعطایی)
  salesVatPayableAccountCode: string;       // Default: '3203' (مالیات و عوارض ارزش افزوده)
  inventoryRawMaterialsCode: string;        // Default: '1401' (موجودی مواد اولیه)
  inventoryFinishedGoodsCode: string;       // Default: '1403' (موجودی کالای ساخته‌شده)
  costOfGoodsSoldCode: string;              // Default: '6001' (هزینه مواد اولیه مصرفی / بهای تمام‌شده)
  summaryProfitLossCode: string;            // Default: '4301' (خلاصه سود و زیان)
  retainedEarningsCode: string;             // Default: '4201' (سود و زیان انباشته)
  closingBalanceAccountCode: string;        // Default: '4401' (تراز اختتامیه / افتتاحیه)
}

export const DEFAULT_ACCOUNT_MAPPINGS: ConceptualAccountMappingConfig = {
  directProductionWagesAccountCode: '6002',
  wagesPayableAccountCode: '3201',
  salesRevenueAccountCode: '5001',
  tradeReceivablesAccountCode: '1201',
  tradePayablesAccountCode: '3001',
  salesDiscountAccountCode: '5102',
  salesVatPayableAccountCode: '3203',
  inventoryRawMaterialsCode: '1401',
  inventoryFinishedGoodsCode: '1403',
  costOfGoodsSoldCode: '6001',
  summaryProfitLossCode: '4301',
  retainedEarningsCode: '4201',
  closingBalanceAccountCode: '4401',
};

const SETTINGS_KEY = 'accounting_account_mappings';

export class AccountMappingService {
  /**
   * Get all conceptual account mapping configurations
   */
  static async getMappings(tx?: any): Promise<ConceptualAccountMappingConfig> {
    try {
      const executor = tx || orm;
      const [setting] = await executor.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
      if (setting && setting.value) {
        const parsed = JSON.parse(setting.value);
        return { ...DEFAULT_ACCOUNT_MAPPINGS, ...parsed };
      }
    } catch (e) {
      logger.warn({ message: 'Could not read custom account mappings, using defaults', error: e });
    }
    return { ...DEFAULT_ACCOUNT_MAPPINGS };
  }

  /**
   * Save or update conceptual account mapping configurations
   */
  static async saveMappings(mappings: Partial<ConceptualAccountMappingConfig>): Promise<ConceptualAccountMappingConfig> {
    const current = await this.getMappings();
    const updated = { ...current, ...mappings };
    
    await orm.insert(appSettings).values({
      key: SETTINGS_KEY,
      value: JSON.stringify(updated)
    }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(updated) }
    });

    return updated;
  }

  /**
   * Resolve a conceptual account to its concrete database Account entity
   */
  static async resolveAccount(concept: keyof ConceptualAccountMappingConfig, tx?: any): Promise<Account | null> {
    const mappings = await this.getMappings(tx);
    const targetCode = mappings[concept] || DEFAULT_ACCOUNT_MAPPINGS[concept];

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    let matched = allAccs.find(a => a.code === targetCode);

    // Fallback search by general code if subsidiary not found (e.g., '12' for '1201')
    if (!matched && targetCode.length > 2) {
      const generalCode = targetCode.slice(0, 2);
      matched = allAccs.find(a => a.code === generalCode);
    }

    return matched || null;
  }

  /**
   * Resolve Direct Production Wages Account (هزینه دستمزد مستقیم تولید)
   */
  static async getDirectProductionWagesAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('directProductionWagesAccountCode', tx);
  }

  /**
   * Resolve Wages Payable Account (حقوق و دستمزد پرداختنی پرسنل)
   */
  static async getWagesPayableAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('wagesPayableAccountCode', tx);
  }

  /**
   * Resolve Trade Receivables Account (حساب‌های دریافتنی تجاری / بدهکاران)
   */
  static async getTradeReceivablesAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('tradeReceivablesAccountCode', tx);
  }

  /**
   * Resolve Trade Payables Account (حساب‌های پرداختنی تجاری / بستانکاران)
   */
  static async getTradePayablesAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('tradePayablesAccountCode', tx);
  }

  /**
   * Resolve Sales Revenue Account (درآمد فروش)
   */
  static async getSalesRevenueAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('salesRevenueAccountCode', tx);
  }

  /**
   * Resolve Sales Discount Account (تخفیفات اعطایی)
   */
  static async getSalesDiscountAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('salesDiscountAccountCode', tx);
  }

  /**
   * Resolve VAT Payable Account (مالیات بر ارزش افزوده)
   */
  static async getSalesVatPayableAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('salesVatPayableAccountCode', tx);
  }

  /**
   * Resolve Summary Profit & Loss Account (خلاصه سود و زیان سال جاری)
   */
  static async getSummaryProfitLossAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('summaryProfitLossCode', tx);
  }

  /**
   * Resolve Retained Earnings Account (سود و زیان انباشته)
   */
  static async getRetainedEarningsAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('retainedEarningsCode', tx);
  }

  /**
   * Resolve Closing/Opening Balance Sheet Clearing Account (تراز افتتاحیه / اختتامیه)
   */
  static async getClosingBalanceAccount(tx?: any): Promise<Account | null> {
    return this.resolveAccount('closingBalanceAccountCode', tx);
  }
}
