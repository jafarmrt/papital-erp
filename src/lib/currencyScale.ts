/**
 * کوچک‌ترین واحد مبلغ یک ارز: ریال بی‌اعشار، ارز خارجی دو رقم اعشار (سِنت). v8.0.41 (TD-297) برای جمع دقیق ردیف‌های
 * ووکامرس؛ از v8.0.105 (TD-382) گرد کردن مالیات درصدی سند هم با همین قاعده است (سرور و فرم فاکتور فروش).
 */
export function currencyScale(currency: string | null | undefined): number {
  return String(currency || 'IRR').trim().toUpperCase() === 'IRR' ? 0 : 2;
}
