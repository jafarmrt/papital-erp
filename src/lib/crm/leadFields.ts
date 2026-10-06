/**
 * v9.0.18 (TD-427): مقدارهای مجاز فیلدهای پرونده فروش، مشترک سرور (اعتبارسنجی Zod) و مرورگر.
 */

/** مرحله‌های قیف فروش (ترتیب ستون‌های کانبان) */
export const CRM_LEAD_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;
export type CrmLeadStage = typeof CRM_LEAD_STAGES[number];

export const CRM_LEAD_STATUSES = ['active', 'won', 'lost', 'archived'] as const;
export type CrmLeadStatus = typeof CRM_LEAD_STATUSES[number];

/** ارزهای پشتیبانی‌شده سامانه (AGENTS §6) */
export const CRM_LEAD_CURRENCIES = ['IRR', 'USD', 'EUR', 'AED', 'GBP'] as const;
export type CrmLeadCurrency = typeof CRM_LEAD_CURRENCIES[number];

/** ارز خالی یا «ریال» همان IRR است؛ کد ارز بی‌حساسیت به بزرگی حروف */
export function normalizeLeadCurrency(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const code = value.trim().toUpperCase();
  return code === '' || code === 'ریال' ? 'IRR' : code;
}

/** احتمال موفقیت: عدد صحیح ۰ تا ۱۰۰ (رشته لاتینِ خروجی `decimalInput`) */
export function isLeadProbability(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) <= 100;
}
