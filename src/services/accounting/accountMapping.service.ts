import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { logger } from '../../middleware/logger.js';
import type { Account } from '../../types.js';
import { ValidationError } from '../../errors/customErrors.js';
import { toLatinDigits } from '../../lib/numericInput.js';
import { POSTING_ACCOUNT_LEVELS, postingAccountsOf, postingRefusal, postingRefusalText } from '../../lib/accounting/postingAccount.js';
import {
  ACCOUNT_MAPPING_CONCEPTS, accountMappingConcept, accountTypeFitsConcept, conceptAccountTypesText, type AccountMappingKey,
} from '../../lib/accounting/accountMappingConcepts.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.199 (TD-550، B03-08): فهرست مفهوم‌ها، برچسب، کد پیش‌فرض و نوع‌های پذیرفته هر مفهوم در
 * `src/lib/accounting/accountMappingConcepts.ts` است (مشترک سرور و صفحه نگاشت)؛ این نوع و پیش‌فرض‌ها از همان ساخته می‌شوند.
 */
export type ConceptualAccountMappingConfig = Record<AccountMappingKey, string>;

export const DEFAULT_ACCOUNT_MAPPINGS: ConceptualAccountMappingConfig = Object.fromEntries(
  ACCOUNT_MAPPING_CONCEPTS.map(c => [c.key, c.defaultCode]),
) as ConceptualAccountMappingConfig;

export interface AccountMappingIssue {
  key: AccountMappingKey;
  label: string;
  code: string;
  reason: string;
}

/**
 * v9.0.199 (TD-550): کد نگاشت فقط به حساب قابل ثبت (فعال، معین یا تفصیلی، بی زیرحساب فعال) از نوع‌های همان مفهوم
 * می‌رسد؛ برای هر کد ناپذیرفته دلیل فارسی برمی‌گردد.
 */
export function accountMappingIssues(entries: Array<[AccountMappingKey, string]>, chart: Account[]): AccountMappingIssue[] {
  const posting = new Set(postingAccountsOf(chart).map(a => a.id));
  const issues: AccountMappingIssue[] = [];
  for (const [key, code] of entries) {
    const concept = accountMappingConcept(key);
    if (!concept) continue;
    const account = chart.find(a => a.code === code);
    let reason = '';
    if (!account) reason = 'حسابی با این کد در سرفصل نیست';
    else if (!posting.has(account.id)) {
      const hasChild = chart.some(c => c.parentId === account.id && Number(c.isActive ?? 1) === 1);
      reason = postingRefusalText(postingRefusal(account, hasChild) ?? 'summary_level');
    } else if (!accountTypeFitsConcept(concept, account.accountType)) {
      reason = `نوع حساب باید ${conceptAccountTypesText(concept)} باشد`;
    }
    if (reason) issues.push({ key, label: concept.label, code, reason });
  }
  return issues;
}

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
   * Save or update conceptual account mapping configurations.
   * v9.0.199 (TD-550، B03-08): کدها لاتین می‌شوند و هر کد ناخالیِ مفهومی که خاموش نیست باید حساب قابل ثبت با نوع
   * سازگار باشد، وگرنه ۴۲۲ `ACCOUNT_MAPPING_INVALID` با فهرست همه مفهوم‌های نادرست و هیچ چیز ذخیره نمی‌شود. پیش‌تر کد
   * ناموجود یا حساب درآمد به جای موجودی بی‌صدا ذخیره می‌شد. با `disabled` فهرست مفهوم‌های خاموش در همان تراکنش نوشته می‌شود.
   */
  static async saveMappings(mappings: Partial<ConceptualAccountMappingConfig>, disabled?: string[]): Promise<ConceptualAccountMappingConfig> {
    return orm.transaction(async (tx) => {
      const current = await this.getMappings(tx);
      const disabledNow = disabled ?? await this.getDisabledMappings(tx);
      const incoming = Object.fromEntries(Object.entries(mappings)
        .filter(([key]) => accountMappingConcept(key))
        .map(([key, value]) => [key, toLatinDigits(String(value ?? '')).trim()])) as Partial<ConceptualAccountMappingConfig>;
      const toCheck = (Object.entries(incoming) as Array<[AccountMappingKey, string]>)
        .filter(([key, code]) => code !== '' && !disabledNow.includes(key));
      if (toCheck.length > 0) {
        const issues = accountMappingIssues(toCheck, await ChartOfAccountsService.getAllAccounts(tx));
        if (issues.length > 0) {
          const lines = issues.map(i => `«${i.label}» (کد ${toPersianDigits(i.code)}): ${i.reason}`);
          throw new ValidationError(`نگاشت حساب ذخیره نشد؛ ${lines.join('؛ ')}.`, { issues }, 'ACCOUNT_MAPPING_INVALID');
        }
      }
      const updated = { ...current, ...incoming };
      await tx.insert(appSettings).values({
        key: SETTINGS_KEY,
        value: JSON.stringify(updated)
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(updated) }
      });
      if (disabled !== undefined) await this.setDisabledMappings(disabled, tx);
      return updated;
    });
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

    // v9.0.199 (TD-550، B03-08): فقط حساب معین یا تفصیلی؛ کد نگاشت‌شده‌ای که نیست یا گروه و کل است به کد پیش‌فرض
    // مفهوم می‌رود و هرگز به حساب کل (دو رقم اول کد) نمی‌افتد. پیش‌تر کد ناموجود «۱۴۹۹» سند رسید را روی حساب کل ۱۴ می‌برد
    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    const usable = (code: string) => allAccs.find(a => a.code === code && (POSTING_ACCOUNT_LEVELS as readonly string[]).includes(a.level));
    return usable(targetCode) ?? (targetCode !== DEFAULT_ACCOUNT_MAPPINGS[concept] ? usable(DEFAULT_ACCOUNT_MAPPINGS[concept]) : undefined) ?? null;
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
   * Resolve Shipping & Service Revenue Account (درآمد حمل و خدمات — v7.0.103، TD-191)
   */
  static async getServiceRevenueAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('serviceRevenueAccountCode', tx);
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
   * V1.9.0: کسورات حقوق پرداختنی (بیمه/مالیات سهم کارکنان)؛ v9.0.286 (TD-554): پیش‌فرض ۳۲۰۵
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

  /**
   * V5.0.17 (TD-120): بهای تمام‌شده کالای فروش‌رفته (6001)
   */
  static async getCostOfGoodsSoldAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('costOfGoodsSoldCode', tx);
  }

  /**
   * v8.0.3 (TD-255): کسری و اضافات انبار (7012) — طرف حساب اصلاح موجودی در انبارگردانی و درون‌ریزی اکسل
   */
  static async getInventoryCountDifferenceAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('inventoryCountDifferenceAccountCode', tx);
  }

  /**
   * v8.0.17 (TD-268): درآمد کالای اهدایی (5204) — بستانکار کالای رایگان رسید و خرید که به میانگین موزون وارد انبار می‌شود
   */
  static async getDonatedGoodsIncomeAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('donatedGoodsIncomeAccountCode', tx);
  }

  /**
   * v8.0.114 (TD-413): ضایعات و افت کیفی (6004) — بدهکار سند ضایعات؛ پیش‌تر کد ثابت ۶۰۰۳ (سربار ساخت)
   */
  static async getWasteExpenseAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('wasteExpenseAccountCode', tx);
  }

  /**
   * V5.0.17 (TD-121): کالای در جریان ساخت (1402)
   */
  static async getWorkInProgressAccount(tx?: DbExecutor): Promise<Account | null> {
    return this.resolveAccount('workInProgressCode', tx);
  }
}
