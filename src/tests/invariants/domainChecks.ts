import { ACCOUNTING_COST_CHECKS } from './accountingCostScenarios.js';
import { CONCURRENCY_CHECKS } from './concurrencyChecks.js';
import { DECISION_CHECKS } from './decisionScenarios.js';
import { FRONTEND_SERVER_CHECKS } from './frontendServerChecks.js';
import { INVARIANT_CATALOG_CHECKS } from './invariantCatalogScenarios.js';
import { SIMULATOR_COVERAGE_CHECKS } from './simulatorCoverageChecks.js';
import { PAYROLL_INTEGRITY_CHECKS } from './payrollIntegrityChecks.js';
import { TREASURY_BANK_CHECKS } from './treasuryBankChecks.js';
import { WOO_DELETED_ORDER_CHECKS } from './wooDeletedOrderChecks.js';

/**
 * جدول یک‌جای آزمون‌های سخت‌گیرانه حوزه‌ها برای سوئیت business_invariants (فایل سوئیت در سقف max-lines است):
 * حوزه J، همزمانی (v8.0.67 به بعد)؛ حوزه L، فرانت و سرور (v8.0.103 به بعد)؛ حسابداری و بهای تمام‌شده (v8.0.114 به بعد)؛
 * تصمیم‌های مالک محصول بر مشاهده‌های ممیزی (v8.0.118 به بعد)؛ ووکامرس، سفارش حذف‌شده (v8.0.126).
 */
export const DOMAIN_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ...CONCURRENCY_CHECKS,
  ...FRONTEND_SERVER_CHECKS,
  ...ACCOUNTING_COST_CHECKS,
  ...DECISION_CHECKS,
  ...WOO_DELETED_ORDER_CHECKS,
  ...TREASURY_BANK_CHECKS, // package 4, series 9 (v9.0.67 on)
  ...PAYROLL_INTEGRITY_CHECKS, // package 12 payroll, series 9 (v9.0.266 on)
  ...INVARIANT_CATALOG_CHECKS, // I-01, series 10 (v10.0.1 on): each new invariant catches a broken row
  ...SIMULATOR_COVERAGE_CHECKS, // I-01 (v10.0.2): the simulator's treasury, payroll, purchasing, allocation and approval operations
];
