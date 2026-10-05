import { ACCOUNTING_COST_CHECKS } from './accountingCostScenarios.js';
import { CONCURRENCY_CHECKS } from './concurrencyChecks.js';
import { FRONTEND_SERVER_CHECKS } from './frontendServerChecks.js';

/**
 * جدول یک‌جای آزمون‌های سخت‌گیرانه حوزه‌ها برای سوئیت business_invariants (فایل سوئیت در سقف max-lines است):
 * حوزه J، همزمانی (v8.0.67 به بعد)؛ حوزه L، فرانت و سرور (v8.0.103 به بعد)؛ حسابداری و بهای تمام‌شده (v8.0.114 به بعد).
 */
export const DOMAIN_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ...CONCURRENCY_CHECKS,
  ...FRONTEND_SERVER_CHECKS,
  ...ACCOUNTING_COST_CHECKS,
];
