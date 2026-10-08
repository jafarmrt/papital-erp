/**
 * v9.0.364 (TD-712، B15-10، تصمیم ت۴ الف): نوع‌های اقدام قانون‌های خودکار، مشترک سرور و رابط. فقط اعلان درون‌برنامه، وب‌هوک
 * و ممیزی ویژه کاری واقعی می‌کنند. «تحریک گردش کار» کاری نمی‌کرد و «در صف قرار گرفت» گزارش می‌داد و «پیامک» فقط یک خط
 * لاگ می‌نوشت؛ این دو حذف شدند: قانون تازه‌ای با آن‌ها ساخته یا فعال نمی‌شود، و قانون‌های پیشین با آن‌ها را مهاجرت
 * `*_retired_rule_actions` غیرفعال و در `event_action_rule_retirements` ثبت کرد (بررسی سلامت آن‌ها را فهرست می‌کند).
 */
export const RULE_ACTION_TYPES = ['in_app_notification', 'webhook', 'audit_log'] as const;
export type RuleActionType = typeof RULE_ACTION_TYPES[number];

export const RETIRED_RULE_ACTION_TYPES = ['workflow_trigger', 'sms_simulation'] as const;
export type RetiredRuleActionType = typeof RETIRED_RULE_ACTION_TYPES[number];

/** نوع اقدامی که روی قانون ذخیره‌شده دیده می‌شود: نوع زنده یا نوع حذف‌شده قانون‌های پیشین */
export type StoredRuleActionType = RuleActionType | RetiredRuleActionType;

export function isRuleActionType(value: unknown): value is RuleActionType {
  return typeof value === 'string' && (RULE_ACTION_TYPES as readonly string[]).includes(value);
}

export function isRetiredRuleActionType(value: unknown): value is RetiredRuleActionType {
  return typeof value === 'string' && (RETIRED_RULE_ACTION_TYPES as readonly string[]).includes(value);
}

const RULE_ACTION_TYPE_NAMES: Record<StoredRuleActionType, string> = {
  in_app_notification: 'اعلان درون‌برنامه',
  webhook: 'ارسال وب‌هوک',
  audit_log: 'ثبت ممیزی ویژه',
  workflow_trigger: 'تحریک گردش کار',
  sms_simulation: 'پیامک',
};

function ruleActionTypeName(value: string): string {
  return (RULE_ACTION_TYPE_NAMES as Record<string, string>)[value] ?? value;
}

/** برچسب نوع اقدام؛ نوع حذف‌شده با «(حذف‌شده)» */
export function ruleActionTypeLabel(value: string): string {
  return isRetiredRuleActionType(value) ? `${ruleActionTypeName(value)} (حذف‌شده)` : ruleActionTypeName(value);
}

/** پیام خطای ساخت، ویرایش یا فعال کردن قانونی با نوع اقدام حذف‌شده */
export function retiredRuleActionMessage(value: string): string {
  return `اقدام «${ruleActionTypeName(value)}» از سامانه حذف شده است و قانونی با آن ساخته یا فعال نمی‌شود؛ اعلان درون‌برنامه، ارسال وب‌هوک یا ثبت ممیزی ویژه را برگزینید.`;
}
