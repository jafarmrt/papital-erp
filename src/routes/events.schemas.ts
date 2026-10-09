import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';

/**
 * v10.0.21 (TD-979، OBS-R2-06): بدنه routeهای نویسنده رویدادها با Zod خوانده می‌شود. اسکیما فقط شکل و اندازه را می‌سنجد؛
 * قاعده‌های کسب‌وکار (نوع رویداد منتشرشده، نوع اقدام، بازه مهلت، نشانی امن) همان 422 سرویس می‌مانند. کلیدی که در اسکیما
 * نیست کنار گذاشته می‌شود.
 */

const text = (max: number) => z.string().max(max);
const jsonObject = z.record(z.string().max(200), z.unknown());
/** شرط قانون: آرایه شرط‌ها یا یک گروه (شیء)؛ ساختار درونی را `RuleEngineService.validateExpression` می‌سنجد */
const ruleConditions = z.union([z.array(z.unknown()).max(200), jsonObject, z.null()]);
const activeFlag = z.union([z.boolean(), z.literal(0), z.literal(1), z.literal('0'), z.literal('1')])
  .transform(v => (v === true || v === 1 || v === '1' ? 1 : 0));
/** مهلت و شمار تلاش؛ عدد بودن و بازه را سرویس می‌سنجد (422 WEBHOOK_TIMEOUT_INVALID) */
const looseNumber = z.union([z.number(), text(30), z.null()]);

const ruleFields = {
  name: text(200).trim(),
  description: text(2000).nullable().optional(),
  eventType: text(200).trim(),
  conditionsJson: ruleConditions.optional(),
  conditions: ruleConditions.optional(),
  actionType: text(100).optional(),
  actionConfigJson: jsonObject.optional(),
  actions: z.array(z.object({ type: text(100).optional(), config: jsonObject.optional() }).passthrough()).max(20).optional(),
  isActive: activeFlag.optional(),
};

export const createActionRuleSchema = z.object({
  body: z.object({
    ...ruleFields,
    name: ruleFields.name.min(1, 'نام قانون الزامی است'),
    eventType: ruleFields.eventType.min(1, 'نوع رویداد الزامی است'),
  }),
});

export const updateActionRuleSchema = z.object({
  params: z.object({ id: numericIdString }),
  body: z.object({
    name: ruleFields.name.min(1, 'نام قانون الزامی است').optional(),
    description: ruleFields.description,
    eventType: ruleFields.eventType.min(1, 'نوع رویداد الزامی است').optional(),
    conditionsJson: ruleFields.conditionsJson,
    actionType: ruleFields.actionType,
    actionConfigJson: ruleFields.actionConfigJson,
    isActive: ruleFields.isActive,
  }),
});

/** پیش‌نویس قانون را `evaluateRuleDraft` با 422 RULE_DRAFT_INVALID می‌سنجد؛ این‌جا فقط شیء بودنش */
export const ruleDraftSchema = z.object({
  body: z.object({ rule: jsonObject.optional() }),
});

export const simulateDomainEventSchema = z.object({
  body: z.object({
    eventType: text(200).optional(),
    aggregateType: text(100).optional(),
    aggregateId: z.union([text(100), z.number()]).nullable().optional(),
    payload: jsonObject.nullable().optional(),
  }),
});

export const dlqReplayBatchSchema = z.object({
  body: z.object({
    ids: z.array(z.coerce.number().int().positive('شناسه رویداد باید عدد صحیح مثبت باشد')).min(1, 'فهرست شناسه‌های بازپخش الزامی است').max(500),
  }),
});

export const simulateReplaySchema = z.object({
  body: z.object({
    event: z.object({
      eventId: text(200).optional(),
      eventType: text(200).optional(),
      aggregateType: text(100).optional(),
      aggregateId: z.union([text(100), z.number()]).nullable().optional(),
      payload: jsonObject.nullable().optional(),
    }).optional(),
    eventId: text(200).optional(),
    eventType: text(200).optional(),
    aggregateType: text(100).optional(),
    aggregateId: z.union([text(100), z.number()]).nullable().optional(),
    payload: jsonObject.nullable().optional(),
    dryRun: z.boolean().optional(),
  }),
});

const webhookFields = {
  name: text(200).trim(),
  targetUrl: text(2000).trim(),
  eventPatterns: z.array(text(200)).max(100),
  secretKey: text(500).optional(),
  customHeaders: z.record(text(200), z.coerce.string().max(4000)).optional(),
  isActive: activeFlag.optional(),
  retryLimit: z.coerce.number().int().min(0).max(20).optional(),
  timeoutMs: looseNumber.optional(),
  timeoutSeconds: looseNumber.optional(),
};

export const createWebhookSchema = z.object({
  body: z.object({
    ...webhookFields,
    name: webhookFields.name.min(1, 'نام وب‌هوک الزامی است'),
    targetUrl: webhookFields.targetUrl.min(1, 'نشانی مقصد الزامی است'),
  }),
});

export const updateWebhookSchema = z.object({
  params: z.object({ id: numericIdString }),
  body: z.object({
    name: webhookFields.name.min(1, 'نام وب‌هوک الزامی است').optional(),
    targetUrl: webhookFields.targetUrl.min(1, 'نشانی مقصد الزامی است').optional(),
    eventPatterns: webhookFields.eventPatterns.optional(),
    secretKey: webhookFields.secretKey,
    customHeaders: webhookFields.customHeaders,
    isActive: webhookFields.isActive,
    retryLimit: webhookFields.retryLimit,
    timeoutMs: webhookFields.timeoutMs,
    timeoutSeconds: webhookFields.timeoutSeconds,
  }),
});

const idParams = z.object({ id: numericIdString });

/** آزمایش قانون ذخیره‌شده با داده دلخواه رویداد (`customEvent.payload`) */
export const testStoredRuleSchema = z.object({
  params: idParams,
  body: z.object({ customEvent: z.object({ payload: jsonObject.nullable().optional() }).passthrough().nullable().optional() }),
});

/** بازپخش یک رویداد صف خطا، شاید با داده اصلاح‌شده؛ شیء بودن داده را سرویس می‌سنجد */
export const dlqReplaySchema = z.object({
  params: idParams,
  body: z.object({ payload: z.unknown().optional(), adjustedPayload: z.unknown().optional() }),
});

export const dlqDismissSchema = z.object({
  params: idParams,
  body: z.object({ notes: z.string().max(2000).nullable().optional() }),
});

/** اصلاح داده رویداد صف خطا؛ داده غیرشیء را سرویس با 422 DLQ_PAYLOAD_INVALID رد می‌کند */
export const dlqPayloadSchema = z.object({
  params: idParams,
  body: z.object({ payload: z.unknown() }),
});

export const outboxProcessSchema = z.object({
  body: z.object({ batchSize: z.coerce.number().int().min(1).max(500).optional() }),
});
