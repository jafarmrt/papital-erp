import { ValidationError } from '../../errors/customErrors.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { isRetiredRuleActionType, isRuleActionType, retiredRuleActionMessage } from '../../lib/events/ruleActionTypes.js';
import { RuleEngineService, type RuleExpression } from '../ruleEngine.service.js';
import { assertNotificationPermission, permissionHolderUserIds, roleMemberUserIds } from '../notifications/notificationRecipients.js';
import { DomainEventType } from './domainEvents.js';
import { EventActionEngineService } from './eventActionEngineService.js';
import { ruleSampleEvent } from './ruleSampleEvent.js';

/**
 * v9.0.377 (TD-712، B15-10، تصمیم ت۴ الف): «ارزیابی پیش‌نویس» قانون (`POST /events/action-rules/test-draft`) واقعاً ارزیابی
 * می‌کند و هیچ اثری ندارد: نوع رویداد، نوع اقدام، شرط‌ها و تنظیم اقدام بررسی می‌شوند (نادرست → ۴۲۲ `RULE_DRAFT_INVALID` با
 * فهرست خطاها)، شرط‌ها روی رویداد نمونه همان نوع ارزیابی می‌شوند، و آنچه اقدام *انجام می‌داد* (نشانی و روش وب‌هوک، متن و
 * شمار گیرندگان اعلان، متن ممیزی) فقط نشان داده می‌شود؛ هیچ درخواست، اعلان یا ممیزی‌ای ساخته نمی‌شود. پیش‌تر پاسخ همیشه
 * «ارزیابی آزمایشی شروط و فیلدها با موفقیت انجام شد» بود، با عملگر نامعتبر و رویداد ناموجود هم.
 */
export interface RuleDraftEvaluation {
  status: 'success';
  conditionMatches: boolean;
  message: string;
  eventType: string;
  preview: Record<string, unknown>;
  sampleRuleName: string;
}

const KNOWN_EVENT_TYPES = new Set<string>([...Object.values(DomainEventType), '*']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function evaluateRuleDraft(draft: unknown): Promise<RuleDraftEvaluation> {
  const rule = asRecord(draft);
  const errors: string[] = [];

  const eventType = text(rule.eventType);
  if (!eventType) errors.push('نوع رویداد قانون تعیین نشده است.');
  else if (!KNOWN_EVENT_TYPES.has(eventType)) errors.push(`نوع رویداد «${eventType}» در سامانه تعریف نشده است.`);

  const actionType = rule.actionType;
  if (isRetiredRuleActionType(actionType)) errors.push(retiredRuleActionMessage(actionType));
  else if (!isRuleActionType(actionType)) errors.push(`نوع اقدام «${String(actionType ?? '')}» تعریف نشده است.`);

  const conditions = rule.conditionsJson ?? rule.conditions ?? [];
  const conditionCheck = RuleEngineService.validateExpression(conditions as RuleExpression);
  if (!conditionCheck.valid) errors.push(`شرط‌های قانون نامعتبر است: ${conditionCheck.error}`);

  const config = asRecord(rule.actionConfigJson);
  const sample = ruleSampleEvent(eventType && KNOWN_EVENT_TYPES.has(eventType) ? eventType : '*');
  const preview: Record<string, unknown> = { actionType };

  if (actionType === 'webhook') {
    const rawUrl = text(config.url);
    const method = config.method === undefined ? 'POST' : config.method;
    if (method !== 'POST' && method !== 'PUT') errors.push('روش ارسال وب‌هوک باید POST یا PUT باشد.');
    if (!rawUrl) {
      errors.push('نشانی وب‌هوک تعیین نشده است.');
    } else {
      let url = EventActionEngineService.interpolateTemplate(rawUrl, sample);
      if (url.startsWith('/')) url = `http://127.0.0.1:${process.env.PORT || 3000}${url}`;
      try {
        await assertSafeExternalUrl(url, { allowLocalEcho: true });
        preview.method = method;
        preview.url = url;
      } catch (err) {
        errors.push(`نشانی وب‌هوک «${url}» پذیرفته نیست (نشانی نامعتبر، داخلی یا بی DNS): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (actionType === 'in_app_notification') {
    const title = text(config.titleTemplate);
    const messageTemplate = text(config.messageTemplate);
    if (!title && !messageTemplate) errors.push('عنوان یا متن اعلان تعیین نشده است.');
    try {
      assertNotificationPermission(config.targetPermission);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    const targetUserId = config.targetUserId;
    if (targetUserId !== undefined && targetUserId !== null && targetUserId !== '' && !(Number.isInteger(Number(targetUserId)) && Number(targetUserId) > 0)) {
      errors.push('شناسه کاربر گیرنده اعلان باید عدد صحیح مثبت باشد.');
    }
    if (errors.length === 0) {
      const recipients = targetUserId
        ? [Number(targetUserId)]
        : config.targetPermission
          ? await permissionHolderUserIds(String(config.targetPermission))
          : await roleMemberUserIds(text(config.targetRole) || SYSTEM_ADMIN_ROLE);
      preview.title = EventActionEngineService.interpolateTemplate(title || 'اعلان رویداد سازمانی', sample);
      preview.message = EventActionEngineService.interpolateTemplate(messageTemplate, sample);
      preview.recipientCount = recipients.length;
    }
  } else if (actionType === 'audit_log') {
    const description = text(config.descriptionTemplate);
    if (!description) errors.push('متن ثبت ممیزی تعیین نشده است.');
    else preview.description = EventActionEngineService.interpolateTemplate(description, sample);
  }

  if (errors.length > 0) {
    throw new ValidationError(`پیش‌نویس قانون پذیرفته نیست: ${errors.join(' ')}`, { errors }, 'RULE_DRAFT_INVALID');
  }

  // the same reading of the conditions as processEvent: a flat list, anything else counts as no condition
  const conditionMatches = EventActionEngineService.evaluateConditions(Array.isArray(conditions) ? conditions : [], sample);
  const sampleType = sample.eventType;
  return {
    status: 'success',
    conditionMatches,
    eventType: sampleType,
    preview,
    sampleRuleName: text(rule.name) || 'قانون پیش‌نویس',
    message: conditionMatches
      ? `پیش‌نویس قانون معتبر است و شرط‌هایش با رویداد نمونه «${sampleType}» برقرار است. اقدام اجرا نشد و چیزی فرستاده نشد.`
      : `پیش‌نویس قانون معتبر است، ولی شرط‌هایش با رویداد نمونه «${sampleType}» برقرار نیست. اقدام اجرا نشد.`,
  };
}
