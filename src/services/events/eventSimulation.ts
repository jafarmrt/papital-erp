import { and, asc, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules, webhookSubscriptions } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { eventTypeLabel, isPublishedEventType } from '../../lib/events/eventTypeCatalog.js';
import type { EventSimulationResult, SimulatedRuleOutcome } from '../../lib/events/eventSimulationContract.js';
import type { AggregateType, BaseDomainEvent } from './domainEvents.js';
import { EventActionEngineService } from './eventActionEngineService.js';
import { previewRuleAction } from './ruleDraftEvaluation.js';
import { ruleSampleEvent } from './ruleSampleEvent.js';
import { WebhookSubscriptionService } from './webhookSubscriptionService.js';

/**
 * v9.0.430 (TD-708، B15-06، تصمیم ت۵ الف): «شبیه‌سازی رویداد» (`POST /events/domain-events/simulate`) بی‌اثر است: رویداد
 * منتشر نمی‌شود، هیچ قانون یا وب‌هوکی اجرا نمی‌شود و هیچ اعلان یا ممیزی دامنه‌ای نوشته نمی‌شود؛ فقط نشان داده می‌شود کدام
 * قانون فعال با شرط‌هایش جور می‌شد و چه می‌کرد، و کدام اشتراک وب‌هوک فعال آن را دریافت می‌کرد. پیش‌تر هر نوع و payload
 * دلخواهی به handlerهای زنده منتشر می‌شد و به شریک بیرونی وب‌هوک با امضای معتبر و داده ساختگی می‌رسید. ارسال واقعی فقط
 * «آزمایش اتصال» اشتراک است، با بدنه `system.ping`.
 */
export const EVENT_SIMULATION_TYPE_UNKNOWN = 'EVENT_SIMULATION_TYPE_UNKNOWN';

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function simulateDomainEvent(input: {
  eventType?: unknown;
  aggregateType?: unknown;
  aggregateId?: unknown;
  payload?: unknown;
}, user?: { id?: number; username?: string }): Promise<EventSimulationResult & { event: BaseDomainEvent }> {
  const eventType = typeof input.eventType === 'string' ? input.eventType.trim() : '';
  if (!isPublishedEventType(eventType)) {
    throw new ValidationError(
      `رویداد «${eventType}» در سامانه منتشر نمی‌شود؛ برای شبیه‌سازی یکی از رویدادهای فهرست را برگزینید.`,
      { eventType }, EVENT_SIMULATION_TYPE_UNKNOWN,
    );
  }
  const sample = ruleSampleEvent(eventType);
  const event: BaseDomainEvent = {
    ...sample,
    eventId: `simulated_${Date.now()}`,
    aggregateType: (typeof input.aggregateType === 'string' && input.aggregateType.trim() ? input.aggregateType.trim() : sample.aggregateType) as AggregateType,
    aggregateId: input.aggregateId !== undefined && input.aggregateId !== null && String(input.aggregateId).trim() ? String(input.aggregateId).trim() : sample.aggregateId,
    payload: plainObject(input.payload) ?? sample.payload,
    metadata: { ...sample.metadata, userId: user?.id ?? 0, userName: user?.username ?? '', isSimulation: true },
  };

  const rules = await orm.select().from(eventActionRules)
    .where(and(eq(eventActionRules.isActive, 1), sql`(${eventActionRules.eventType} = ${eventType} OR ${eventActionRules.eventType} = '*')`))
    .orderBy(asc(eventActionRules.id));
  const ruleOutcomes: SimulatedRuleOutcome[] = [];
  for (const rule of rules) {
    const conditions = Array.isArray(rule.conditionsJson) ? rule.conditionsJson : [];
    const matched = EventActionEngineService.evaluateConditions(conditions, event);
    let preview: Record<string, unknown> | null = null;
    let problem: string | null = null;
    if (matched) {
      const action = await previewRuleAction(rule.actionType, rule.actionConfigJson, event);
      preview = action.preview;
      problem = action.errors.length > 0 ? action.errors.join(' ') : null;
    }
    ruleOutcomes.push({ ruleId: rule.id, ruleName: rule.name, actionType: rule.actionType, matched, preview, problem });
  }

  const subscriptions = await orm.select({ id: webhookSubscriptions.id, name: webhookSubscriptions.name, targetUrl: webhookSubscriptions.targetUrl, eventPatterns: webhookSubscriptions.eventPatterns })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.isActive, 1))
    .orderBy(asc(webhookSubscriptions.id));
  const webhooks = subscriptions
    .filter(sub => WebhookSubscriptionService.matchesPattern(eventType, Array.isArray(sub.eventPatterns) ? sub.eventPatterns as string[] : ['*']))
    .map(sub => ({ subscriptionId: sub.id, name: sub.name, targetUrl: sub.targetUrl }));

  const matchedCount = ruleOutcomes.filter(r => r.matched).length;
  return {
    simulated: true,
    event,
    rules: ruleOutcomes,
    webhooks,
    message: `شبیه‌سازی «${eventTypeLabel(eventType)}» بی‌اثر انجام شد: ${matchedCount.toLocaleString('fa-IR')} قانون جور می‌شد و ${webhooks.length.toLocaleString('fa-IR')} وب‌هوک آن را دریافت می‌کرد؛ رویداد منتشر نشد و چیزی فرستاده یا ثبت نشد.`,
  };
}
