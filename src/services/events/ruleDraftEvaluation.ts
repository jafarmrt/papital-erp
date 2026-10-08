import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { isRetiredRuleActionType, isRuleActionType, retiredRuleActionMessage } from '../../lib/events/ruleActionTypes.js';
import { RuleEngineService, type RuleExpression } from '../ruleEngine.service.js';
import { assertNotificationPermission, permissionHolderUserIds, roleMemberUserIds } from '../notifications/notificationRecipients.js';
import { eventTypeLabel, isSubscribableEventPattern } from '../../lib/events/eventTypeCatalog.js';
import { EventActionEngineService } from './eventActionEngineService.js';
import { ruleSampleEvent } from './ruleSampleEvent.js';
import type { BaseDomainEvent } from './domainEvents.js';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * v9.0.430 (TD-708، B15-06، تصمیم ت۵ الف): آنچه اقدام یک قانون برای رویداد *انجام می‌داد* (نشانی و روش وب‌هوک، متن و شمار
 * گیرندگان اعلان، متن ممیزی)، بی هیچ ارسال، اعلان یا ممیزی. مشترک «ارزیابی پیش‌نویس»، «آزمایش» قانون ذخیره‌شده و
 * «شبیه‌سازی رویداد».
 */
export async function previewRuleAction(actionType: unknown, actionConfig: unknown, event: BaseDomainEvent): Promise<{ preview: Record<string, unknown>; errors: string[] }> {
  const config = asRecord(actionConfig);
  const errors: string[] = [];
  const preview: Record<string, unknown> = { actionType };

  if (actionType === 'webhook') {
    const rawUrl = text(config.url);
    const method = config.method === undefined ? 'POST' : config.method;
    if (method !== 'POST' && method !== 'PUT') errors.push('روش ارسال وب‌هوک باید POST یا PUT باشد.');
    if (!rawUrl) {
      errors.push('نشانی وب‌هوک تعیین نشده است.');
    } else {
      let url = EventActionEngineService.interpolateTemplate(rawUrl, event);
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
      preview.title = EventActionEngineService.interpolateTemplate(title || 'اعلان رویداد سازمانی', event);
      preview.message = EventActionEngineService.interpolateTemplate(messageTemplate, event);
      preview.recipientCount = recipients.length;
    }
  } else if (actionType === 'audit_log') {
    const description = text(config.descriptionTemplate);
    if (!description) errors.push('متن ثبت ممیزی تعیین نشده است.');
    else preview.description = EventActionEngineService.interpolateTemplate(description, event);
  }
  return { preview, errors };
}

/** the sample event of a type, with the payload a caller supplies (a plain object) in place of the sample payload */
function evaluationEvent(eventType: string, payload?: unknown): BaseDomainEvent {
  const sample = ruleSampleEvent(eventType);
  const custom = asRecord(payload);
  return Object.keys(custom).length > 0 ? { ...sample, payload: custom } : sample;
}

export async function evaluateRuleDraft(draft: unknown, options: { payload?: unknown; subject?: string } = {}): Promise<RuleDraftEvaluation> {
  const rule = asRecord(draft);
  const subject = options.subject ?? 'پیش‌نویس قانون';
  const errors: string[] = [];

  const eventType = text(rule.eventType);
  if (!eventType) errors.push('نوع رویداد قانون تعیین نشده است.');
  // v9.0.406 (TD-726): only «*» and the event types the server publishes; a declared but never published type never fires
  else if (!isSubscribableEventPattern(eventType)) errors.push(`رویداد «${eventType}» در سامانه منتشر نمی‌شود و قانون آن هرگز اجرا نمی‌شود.`);

  const actionType = rule.actionType;
  if (isRetiredRuleActionType(actionType)) errors.push(retiredRuleActionMessage(actionType));
  else if (!isRuleActionType(actionType)) errors.push(`نوع اقدام «${String(actionType ?? '')}» تعریف نشده است.`);

  const conditions = rule.conditionsJson ?? rule.conditions ?? [];
  const conditionCheck = RuleEngineService.validateExpression(conditions as RuleExpression);
  if (!conditionCheck.valid) errors.push(`شرط‌های قانون نامعتبر است: ${conditionCheck.error}`);

  const sample = evaluationEvent(isSubscribableEventPattern(eventType) ? eventType : '*', options.payload);
  const action = await previewRuleAction(actionType, rule.actionConfigJson, sample);
  errors.push(...action.errors);
  const preview = action.preview;

  if (errors.length > 0) {
    throw new ValidationError(`${subject} پذیرفته نیست: ${errors.join(' ')}`, { errors }, 'RULE_DRAFT_INVALID');
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
      ? `${subject} معتبر است و شرط‌هایش با رویداد نمونه «${eventTypeLabel(sampleType)}» برقرار است. اقدام اجرا نشد و چیزی فرستاده نشد.`
      : `${subject} معتبر است، ولی شرط‌هایش با رویداد نمونه «${eventTypeLabel(sampleType)}» برقرار نیست. اقدام اجرا نشد.`,
  };
}

export interface StoredRuleTest extends RuleDraftEvaluation {
  /** the action never runs in a test (decision t5 a) */
  executed: false;
  sampleEvent: BaseDomainEvent;
}

/**
 * v9.0.430 (TD-708، B15-06، تصمیم ت۵ الف): «آزمایش» قانون ذخیره‌شده (`POST /events/action-rules/:id/test`) همان ارزیابی
 * بی‌اثر پیش‌نویس است، روی قانون ذخیره‌شده: شرط‌ها روی رویداد نمونه (یا payload فرستاده‌شده) ارزیابی می‌شوند و آنچه اقدام
 * انجام می‌داد فقط نشان داده می‌شود. پیش‌تر اقدام واقعی اجرا می‌شد و اعلان، ممیزی یا وب‌هوک امضاشده با داده ساختگی می‌ساخت.
 */
export async function testStoredRule(ruleId: number, customEvent?: unknown): Promise<StoredRuleTest & { rule: NonNullable<Awaited<ReturnType<typeof EventActionEngineService.getRuleById>>> }> {
  const rule = await EventActionEngineService.getRuleById(ruleId);
  if (!rule) throw new NotFoundError('قانون مورد نظر یافت نشد.', { ruleId }, 'RULE_NOT_FOUND');
  const payload = asRecord(customEvent).payload;
  const evaluation = await evaluateRuleDraft(rule, { payload, subject: `قانون «${rule.name}»` });
  const sampleEvent = evaluationEvent(isSubscribableEventPattern(rule.eventType) ? rule.eventType : '*', payload);
  return { rule, ...evaluation, executed: false, sampleEvent };
}
