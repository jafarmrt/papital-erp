import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';

/**
 * v9.0.409 (TD-727، B15-25): مقدار عددی شرط قانون (قانون خودکار رویداد و شرط گذار گردش کار) با ارقام فارسی یا عربی و
 * جداکننده هزارگان خوانده می‌شود. پیش‌تر موتور با `Number(value)` مقایسه می‌کرد، پس برای مبلغ ۵۰٬۰۰۰٬۰۰۰ شرط‌های
 * `gt "۱۰۰۰۰۰۰"`، `gt "1,000,000"` و `gt "۱٬۰۰۰٬۰۰۰"` (و `lt` آن‌ها) همه نادرست بودند و قانون بی‌صدا اجرا نمی‌شد.
 * مشترک موتور (`RuleEngineService`) و ویرایشگر قانون (`RuleEditorModal`).
 */
export const NUMERIC_RULE_OPERATORS: readonly string[] = ['>', 'gt', '>=', 'gte', '<', 'lt', '<=', 'lte'];

export function isNumericRuleOperator(operator: unknown): boolean {
  return NUMERIC_RULE_OPERATORS.includes(String(operator ?? '').toLowerCase().trim());
}

/** عدد یک رشته عددی با ارقام فارسی، عربی یا لاتین و جداکننده هزارگان؛ رشته‌ای که عدد نیست null است */
export function parseRuleNumber(value: string): number | null {
  const normalized = normalizeDecimalString(value);
  return DECIMAL_PATTERN.test(normalized) ? Number(normalized) : null;
}

/**
 * عدد یک سوی مقایسه عددی شرط: عدد همان است، رشته عددی با ارقام فارسی و جداکننده خوانده می‌شود، و بقیه همان رفتار پیشین
 * را دارند (تهی ۰، و رشته غیرعددی `Number(value)` که معمولاً NaN است و هیچ مقایسه‌ای را درست نمی‌کند).
 */
export function ruleComparableNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') {
    const parsed = parseRuleNumber(value);
    if (parsed !== null) return parsed;
  }
  return Number(value);
}

/**
 * برابری عددی: وقتی مقدار واقعی عدد است و مقدار شرط عدد (با ارقام فارسی یا جداکننده) خوانده می‌شود، دو عدد مقایسه
 * می‌شوند؛ در غیر این صورت null و برابری متنی پیشین به کار می‌رود (کد، شماره سند و متن دست نمی‌خورند).
 */
export function numericRuleEquality(actualValue: unknown, targetValue: unknown): boolean | null {
  if (typeof actualValue !== 'number' || !Number.isFinite(actualValue)) return null;
  const target = typeof targetValue === 'number' ? targetValue : typeof targetValue === 'string' ? parseRuleNumber(targetValue) : null;
  if (target === null || !Number.isFinite(target)) return null;
  return actualValue === target;
}

export interface RuleConditionValueCheck {
  value: unknown;
  error: string | null;
}

/**
 * مقدار شرطی که ویرایشگر ذخیره می‌کند: در مقایسه عددی، عدد با ارقام لاتین؛ متنی که عدد نیست خطای فارسی دارد و ذخیره
 * نمی‌شود. عملگرهای دیگر مقدار را همان‌طور که نوشته شده نگه می‌دارند.
 */
export function checkRuleConditionValue(operator: unknown, value: unknown, fieldLabel: string): RuleConditionValueCheck {
  if (!isNumericRuleOperator(operator) || typeof value !== 'string') return { value, error: null };
  const parsed = parseRuleNumber(value);
  if (parsed !== null) return { value: parsed, error: null };
  return { value, error: `مقدار شرط «${fieldLabel}» برای مقایسه بزرگ‌تر و کوچک‌تر باید عدد باشد؛ رقم فارسی و جداکننده هزارگان پذیرفته است.` };
}
