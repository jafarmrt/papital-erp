import { maskHeaderValues, maskSecretValue } from '../secrets/maskedSecret.js';

/**
 * v10.1.5 (TD-1251، بازبینی خروجی ۲۰ مهر ۱۴۰۵): خروجی داده‌ها می‌گفت «کلیدهای محرمانه در آن نیست»، ولی جدول
 * `event_action_rules` توکن قانون وب‌هوک (`actionConfigJson.secretToken`) و مقدار سرآیندها را آشکار داشت. حالا هر ردیف
 * پیش از نوشتن از این پالایه می‌گذرد: هر کلید هم‌شکل رمز، توکن یا کلید (در هر عمق JSON) با متن ناخالی «********» می‌شود،
 * و مقدار هر سرآیند زیر `headers` / `customHeaders` پوشیده می‌شود (نام سرآیند می‌ماند). عدد و درستی/نادرستی (مثل
 * `tokenVersion`) دست نمی‌خورد. همان قاعده `actionRuleView` پاسخ‌های API، برای همه جدول‌ها.
 */

/** Keys whose text value is a secret (camelCase, snake_case and kebab-case alike) */
export const EXPORT_SECRET_KEY_PATTERN = /password|secret|token|api[_-]?key|authorization|cookie|jwt|consumer[_-]?key/i;

/** Keys whose object value maps header names to header values */
const HEADER_MAP_KEY_PATTERN = /^(custom[_-]?)?headers$/i;

type Json = unknown;

function scrubValue(key: string | null, value: Json): Json {
  if (key !== null && HEADER_MAP_KEY_PATTERN.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
    return maskHeaderValues(value);
  }
  if (key !== null && EXPORT_SECRET_KEY_PATTERN.test(key) && typeof value === 'string') return maskSecretValue(value);
  if (Array.isArray(value)) return value.map(v => scrubValue(null, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, Json>).map(([k, v]) => [k, scrubValue(k, v)]));
  }
  return value;
}

/** A row of the export with every secret-like text value masked, at any depth */
export function scrubExportRow<T extends Record<string, unknown>>(row: T): T {
  return scrubValue(null, row) as T;
}
