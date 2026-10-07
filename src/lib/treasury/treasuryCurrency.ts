/**
 * v9.0.99 (TD-508، B04-12، تصمیم مالک محصول ت۵ الف): ارزهای حساب خزانه، مشترک سرور و فرم حساب بانکی (فهرست AGENTS §6).
 */
export const TREASURY_CURRENCIES = ['IRR', 'USD', 'EUR', 'AED', 'GBP'] as const;
export type TreasuryCurrency = typeof TREASURY_CURRENCIES[number];

/** خالی یا «ریال» ← IRR؛ کد ارز بی‌حساسیت به بزرگی حروف. مقدار غیرمتنی دست‌نخورده برمی‌گردد تا اعتبارسنج آن را رد کند. */
export function normalizeTreasuryCurrency(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') return value;
  const code = value.trim().toUpperCase();
  return code === '' || code === 'ریال' ? 'IRR' : code;
}

export function isTreasuryCurrency(value: unknown): value is TreasuryCurrency {
  return typeof value === 'string' && (TREASURY_CURRENCIES as readonly string[]).includes(value);
}
