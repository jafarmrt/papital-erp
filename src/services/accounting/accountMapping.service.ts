import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings, accounts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { logger } from '../../middleware/logger.js';
import type { Account } from '../../types.js';

export interface ConceptualAccountMappingConfig {
  directProductionWagesAccountCode: string; // Default: '6002' (حقوق مستقیم تولید)
  wagesPayableAccountCode: string;          // Default: '3201' (حقوق و دستمزد پرداختنی)
  salesRevenueAccountCode: string;          // Default: '5001' (فروش)
  tradeReceivablesAccountCode: string;      // Default: '1201' (حساب‌های دریافتنی تجاری)
  tradePayablesAccountCode: string;         // Default: '3001' (حساب‌های پرداختنی تجاری)
  salesDiscountAccountCode: string;         // Default: '5102' (تخفیف فروش)
  salesVatPayableAccountCode: string;       // Default: '3203' (مالیات بر ارزش افزوده)
  inventoryRawMaterialsCode: string;        // Default: '1401' (موجودی مواد اولیه)
  inventoryFinishedGoodsCode: string;       // Default: '1403' (موجودی کالای تولیدشده)
  costOfGoodsSoldCode: string;              // Default: '6001' (بهای تمام‌شده کالای فروش‌رفته)
  summaryProfitLossCode: string;            // Default: '4301' (خلاصه سود و زیان)
  retainedEarningsCode: string;             // Default: '4201' (سود انباشته)
  closingBalanceAccountCode: string;        // Default: '4401' (اموال/بدهی ترازنامه)
  // V1.7.0: مفاهیم چرخه چک صیادی (قبلاً هاردکد بودند)
  chequeReceivableAccountCode: string;      // Default: '1101' (اسناد دریافتنی نزد صندوق)
  chequeInCollectionAccountCode: string;    // Default: '1102' (اسناد در جریان وصول)
  chequeProtestAccountCode: string;         // Default: '1103' (اسناد واخواستی/برگشتی)
  chequePayableAccountCode: string;         // Default: '3101' (اسناد پرداختنی تجاری)
  // V1.8.0: مساعده و وام پرسنل (مطالبات از کارکنان — دارایی تا کسر از حقوق)
  employeeAdvanceAccountCode: string;       // Default: '1301' (مساعده و وام پرسنل)
  // V1.9.0: تفکیک هزینه حقوق ثابت و سایر کسورات
  fixedSalaryExpenseAccountCode: string;    // Default: '6003' (هزینه حقوق و دستمزد ثابت)
  employeeDeductionsPayableAccountCode: string; // Default: '3202' (سایر کسورات پرداختنی — بیمه/مالیات سهم کارمند)
  // V2.0.0: طرف حساب اسناد افتتاحیه (موجودی اولیه خزانه/انبار)
  openingCapitalAccountCode: string;        // Default: '4001' (سرمایه اولیه سهامداران/موسسین)
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
  chequeReceivableAccountCode: '1101',
  chequeInCollectionAccountCode: '1102',
  chequeProtestAccountCode: '1103',
  chequePayableAccountCode: '3101',
  employeeAdvanceAccountCode: '1301',
  fixedSalaryExpenseAccountCode: '6003',
  employeeDeductionsPayableAccountCode: '3202',
  openingCapitalAccountCode: '4001',
};

const SETTINGS_KEY = 'accounting_account_mappings';
const DISABLED_KEY = 'accounting_mappings_disabled';

export class AccountMappingService {
  /**
   * Get all conceptual account mapping configurations
   */
  static async getMappings(tx?: DbExecutor): Promise<ConceptualAccountMappingConfig> {
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
   * V1.7.0: مفاهیم «غیرفعال‌شده» همیشه به کدینگ پیش‌فرض برمی‌گردند (bypass سفارشی‌سازی)
   */
  static async resolveAccount(concept: keyof ConceptualAccountMappingConfig, tx?: DbExecutor): Promise<Account | null> {
    const mappings = await this.getMappings(tx);
    const disabled = await this.getDisabledMappings(tx);
    const targetCode = disabled.includes(String(concept))
      ? DEFAULT_ACCOUNT_MAPPINGS[concept]
      : (mappings[concept] || DEFAULT_ACCOUNT_MAPPINGS[concept]);

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
   * V1.7.0: لیست مفاهیم غیرفعال (سفارشی‌سازی خاموش → کدینگ پیش‌فرض)
   */
  static async getDisabledMappings(tx?: DbExecutor): Promise<string[]> {
    try {
      const executor = tx || orm;
      const [setting] = await executor.select().from(appSettings).where(eq(appSettings.key, DISABLED_KEY));
      if (setting?.value) {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      logger.warn({ message: 'Could not read disabled mappings, using empty list', error: e });
    }
    return [];
  }

  static async setDisabledMappings(list: string[], tx?: DbExecutor): Promise<string[]> {
    const executor = tx || orm;
    const clean = (Array.isArray(list) ? list : []).map(String);
    await executor.insert(appSettings).values({
      key: DISABLED_KEY,
      value: JSON.stringify(clean)
    }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(clean) }
    });
    return clean;
  }

  /**
   * V1.7.0: متادیتای کامل برای تب «تنظیمات حسابداری»
   */
  static async getMappingsWithMeta(tx?: DbExecutor): Promise<{
    mappings: ConceptualAccountMappingConfig;
    disabled: string[];
    accountsCount: number;
    chartHasAccounts: boolean;
  }> {
    const mappings = await this.getMappings(tx);
    const disabled = await this.getDisabledMappings(tx);
    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    return {
      mappings,
      disabled,
      accountsCount: allAccs.length,
      chartHasAccounts: allAccs.length > 0,
    };
  }

  /**
   * Resolve Direct Production Wages Account (هزینه دستمزد مستقیم تولید)
   */
  static async getDirectProductionWagesAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('directProductionWagesAccountCode', tx);
  }

  /**
   * Resolve Wages Payable Account (حقوق و دستمزد پرداختنی پرسنل)
   */
  static async getWagesPayableAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('wagesPayableAccountCode', tx);
  }

  /**
   * Resolve Trade Receivables Account (حساب‌های دریافتنی تجاری / بدهکاران)
   */
  static async getTradeReceivablesAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('tradeReceivablesAccountCode', tx);
  }

  /**
   * Resolve Trade Payables Account (حساب‌های پرداختنی تجاری / بستانکاران)
   */
  static async getTradePayablesAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('tradePayablesAccountCode', tx);
  }

  /**
   * Resolve Sales Revenue Account (درآمد فروش)
   */
  static async getSalesRevenueAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('salesRevenueAccountCode', tx);
  }

  /**
   * Resolve Sales Discount Account (تخفیفات اعطایی)
   */
  static async getSalesDiscountAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('salesDiscountAccountCode', tx);
  }

  /**
   * Resolve VAT Payable Account (مالیات بر ارزش افزوده)
   */
  static async getSalesVatPayableAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('salesVatPayableAccountCode', tx);
  }

  /**
   * Resolve Summary Profit & Loss Account (خلاصه سود و زیان سال جاری)
   */
  static async getSummaryProfitLossAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('summaryProfitLossCode', tx);
  }

  /**
   * Resolve Retained Earnings Account (سود و زیان انباشته)
   */
  static async getRetainedEarningsAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('retainedEarningsCode', tx);
  }

  /**
   * Resolve Closing/Opening Balance Sheet Clearing Account
   */
  static async getClosingBalanceAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('closingBalanceAccountCode', tx);
  }

  /**
   * V1.7.0: مفاهیم چرخه چک صیادی
   */
  static async getChequeReceivableAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('chequeReceivableAccountCode', tx);
  }

  static async getChequeInCollectionAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('chequeInCollectionAccountCode', tx);
  }

  static async getChequeProtestAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('chequeProtestAccountCode', tx);
  }

  static async getChequePayableAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('chequePayableAccountCode', tx);
  }

  /**
   * V1.8.0: مساعده و وام پرسنل (مطالبات از کارکنان)
   */
  static async getEmployeeAdvanceAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('employeeAdvanceAccountCode', tx);
  }

  /**
   * V1.9.0: هزینه حقوق و دستمزد ثابت (بخش غیرپرکیسی فیش)
   */
  static async getFixedSalaryExpenseAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('fixedSalaryExpenseAccountCode', tx);
  }

  /**
   * V1.9.0: سایر کسورات پرداختنی (بیمه/مالیات سهم کارمند)
   */
  static async getEmployeeDeductionsPayableAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('employeeDeductionsPayableAccountCode', tx);
  }

  /**
   * V2.0.0: حساب سرمایه اولیه — طرف حساب اسناد افتتاحیه (موجودی اولیه خزانه/انبار)
   */
  static async getOpeningCapitalAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('openingCapitalAccountCode', tx);
  }

  /**
   * V2.0.0: موجودی مواد اولیه (1401)
   */
  static async getInventoryRawMaterialsAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('inventoryRawMaterialsCode', tx);
  }

  /**
   * V2.0.0: موجودی کالای تولیدشده (1403)
   */
  static async getInventoryFinishedGoodsAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('inventoryFinishedGoodsCode', tx);
  }
}
