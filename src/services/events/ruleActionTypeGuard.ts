import { ValidationError } from '../../errors/customErrors.js';
import { isRetiredRuleActionType, isRuleActionType, retiredRuleActionMessage } from '../../lib/events/ruleActionTypes.js';

/**
 * v9.0.364 (TD-712، B15-10، تصمیم ت۴ الف): قانون خودکار فقط با اقدام زنده ساخته یا فعال می‌شود. قانون پیشینی با اقدام
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
