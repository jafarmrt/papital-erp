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

/**
 * v10.1.16 (N-02 بخش ۲، تصمیم ت۶ طرح ارتباط با مشتری): دلیل از دست رفتن پرونده فروش، الزامی هنگام رفتن به «از دست رفته»؛
 * «سایر» شرح می‌خواهد. همان فهرست قید `chk_crm_leads_lost_reason` (migration 0113).
 */
export const CRM_LOST_REASONS = ['price', 'quality', 'delivery', 'competitor', 'no_response', 'other'] as const;
export type CrmLostReason = typeof CRM_LOST_REASONS[number];

export const CRM_LOST_REASON_LABELS: Record<CrmLostReason, string> = {
  price: 'قیمت',
  quality: 'کیفیت یا طرح',
  delivery: 'زمان تحویل',
  competitor: 'خرید از رقیب',
  no_response: 'بی‌پاسخ ماندن مشتری',
  other: 'سایر',
};

/** بیشینه طول شرح دلیل «سایر» */
export const CRM_LOST_REASON_NOTE_MAX = 500;

export function isLostReason(value: unknown): value is CrmLostReason {
  return typeof value === 'string' && (CRM_LOST_REASONS as readonly string[]).includes(value);
}

/** پیام خطای دلیل از دست رفتن، یا null وقتی درست است */
export function lostReasonError(reason: unknown, note: unknown): string | null {
  if (!isLostReason(reason)) return 'دلیل از دست رفتن پرونده را از فهرست انتخاب کنید.';
  const text = String(note ?? '').trim();
  if (reason === 'other' && !text) return 'برای دلیل «سایر» شرح کوتاهی بنویسید.';
  if (text.length > CRM_LOST_REASON_NOTE_MAX) return 'شرح دلیل از دست رفتن بیش از اندازه بلند است.';
  return null;
}
