import { ValidationError } from '../../errors/customErrors.js';
import { isRetiredRuleActionType, isRuleActionType, retiredRuleActionMessage } from '../../lib/events/ruleActionTypes.js';
import { isSubscribableEventPattern } from '../../lib/events/eventTypeCatalog.js';

/**
 * v9.0.377 (TD-712، B15-10، تصمیم ت۴ الف): قانون خودکار فقط با اقدام زنده ساخته یا فعال می‌شود. قانون پیشینی با اقدام
 * حذف‌شده («تحریک گردش کار» یا «پیامک») غیرفعال می‌ماند تا نوع اقدامش عوض شود؛ ویرایش دیگر آن تا وقتی غیرفعال است آزاد است.
 */
export function assertRuleActionTypeAllowed(actionType: unknown, options: { active: boolean; changingType: boolean }): void {
  if (isRuleActionType(actionType)) return;
  if (isRetiredRuleActionType(actionType)) {
    if (!options.changingType && !options.active) return;
    throw new ValidationError(retiredRuleActionMessage(actionType), { actionType }, 'RULE_ACTION_TYPE_RETIRED');
  }
  throw new ValidationError(`نوع اقدام «${String(actionType ?? '')}» تعریف نشده است؛ اعلان درون‌برنامه، ارسال وب‌هوک یا ثبت ممیزی ویژه را برگزینید.`, { actionType }, 'RULE_ACTION_TYPE_INVALID');
}

export const RULE_EVENT_TYPE_UNKNOWN = 'RULE_EVENT_TYPE_UNKNOWN';

/**
 * v9.0.406 (TD-726، B15-24، تصمیم ت۳ الف): رویداد فعال‌کننده قانون «همه رویدادها» یا یکی از نوع‌هایی است که سامانه منتشر
 * می‌کند (`PUBLISHED_EVENT_TYPES`). پیش‌تر ویرایشگر `InvoiceCancelled`، `ChequeStatusChanged`، `ProjectStageCompleted` و
 * `CustomerCreated` را پیشنهاد می‌کرد که هیچ‌جا منتشر نمی‌شوند و قانون آن‌ها هرگز اجرا نمی‌شد. قانون پیشینی با چنین رویدادی تا
 * وقتی غیرفعال است ویرایش می‌شود، ولی فعال نمی‌ماند و فعال نمی‌شود تا رویدادش عوض شود.
 */
export function assertRuleEventTypeAllowed(eventType: unknown, options: { active: boolean; changingType: boolean }): void {
  if (isSubscribableEventPattern(eventType)) return;
  if (!options.changingType && !options.active) return;
  throw new ValidationError(
    `رویداد «${String(eventType ?? '')}» در سامانه منتشر نمی‌شود و قانون آن هرگز اجرا نمی‌شود؛ رویداد فعال‌کننده را از فهرست ویرایشگر یا «همه رویدادها» برگزینید.`,
    { eventType }, RULE_EVENT_TYPE_UNKNOWN,
  );
}
