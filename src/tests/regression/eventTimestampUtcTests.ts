import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  deadLetterEvents, eventActionLogs, eventActionRules, notifications, outboxEvents, webhookDeliveries, webhookSubscriptions,
  woocommerceOrderLogs,
} from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-725 / B15-23: server timestamps (zone-less `timestamp` columns holding UTC) go
 * to the browser with a Z from the events routes (outbox, dead letters, rules, action logs, timeline, webhooks and their
 * deliveries), the notification list and the WooCommerce order log; a stored event payload is sent exactly as stored, so
 * a dead-letter edit never rewrites it. On v9.0.435 every one of them went without a zone, so a Tehran browser showed
 * each time 3.5 hours early (and the previous day before 03:30) and a new notification said «3 ساعت پیش».
 */
const SERVER_TS = '2026-10-06 21:00:00';
const UTC_ISO = '2026-10-06T21:00:00Z';

export async function runEventTimestampUtcTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_event_timestamps_utc_td_725';
  if (!shouldRun(id, 'td725', 'b15-23', 'timestamps', 'notifications', 'package15')) return results;

  const name = 'v9.0.436: events, notification and WooCommerce order log answers send server timestamps with a Z and leave stored event payloads as stored (TD-725)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const tag = `td725_${h.tag}_${Date.now()}`;
  const aggregateId = `725${Date.now()}`;
  const cleanup = { eventId: tag, dlqId: 0, ruleId: 0, logId: 0, subId: 0, notifId: 0, wooId: 0 };
  try {
    const viewer = await h.sessionWith(['events.view', 'woocommerce.view']);
    const wrong: string[] = [];
    const expectUtc = (where: string, value: unknown) => { if (value !== UTC_ISO) wrong.push(`${where}: ${JSON.stringify(value)}`); };

    await orm.insert(outboxEvents).values({
      eventId: tag, eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId, status: 'failed',
      payload: { createdAt: SERVER_TS }, occurredAt: SERVER_TS, processedAt: SERVER_TS, nextRetryAt: SERVER_TS,
    });
    const [dlq] = await orm.insert(deadLetterEvents).values({
      originalEventId: tag, eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId, source: 'outbox',
      payload: { createdAt: SERVER_TS }, failureReason: 'td725', status: 'quarantined', quarantinedAt: SERVER_TS,
    }).returning({ id: deadLetterEvents.id });
    cleanup.dlqId = dlq.id;
    const [rule] = await orm.insert(eventActionRules).values({
      name: `TD725 rule ${tag}`, eventType: 'InvoiceApproved', actionType: 'audit_log', isActive: 0,
      lastExecutedAt: SERVER_TS, createdAt: SERVER_TS, updatedAt: SERVER_TS,
    }).returning({ id: eventActionRules.id });
    cleanup.ruleId = rule.id;
    const [log] = await orm.insert(eventActionLogs).values({
      ruleId: rule.id, ruleName: 'td725', eventId: tag, eventType: 'InvoiceApproved', actionType: 'audit_log', status: 'success',
      executedAt: SERVER_TS,
    }).returning({ id: eventActionLogs.id });
    cleanup.logId = log.id;
    const [sub] = await orm.insert(webhookSubscriptions).values({
      name: `TD725 hook ${tag}`, targetUrl: 'https://partner.example.org/hook', secretKey: '', isActive: 0,
      lastDeliveryAt: SERVER_TS, createdAt: SERVER_TS, updatedAt: SERVER_TS,
    }).returning({ id: webhookSubscriptions.id });
    cleanup.subId = sub.id;
    await orm.insert(webhookDeliveries).values({
      subscriptionId: sub.id, eventId: tag, eventType: 'InvoiceApproved', targetUrl: 'https://partner.example.org/hook', status: 'success',
      createdAt: SERVER_TS,
    });
    const [notif] = await orm.insert(notifications).values({
      userId: viewer.userId, type: 'mention', title: 'td725', message: 'td725', link: '', createdAt: SERVER_TS,
    }).returning({ id: notifications.id });
    cleanup.notifId = notif.id;
    const [woo] = await orm.insert(woocommerceOrderLogs).values({
      wcOrderId: tag, status: 'processed', buyerName: 'td725', createdAt: SERVER_TS, updatedAt: SERVER_TS,
    }).returning({ id: woocommerceOrderLogs.id });
    cleanup.wooId = woo.id;

    type Row = Record<string, unknown>;
    const list = (body: Row, key: string): Row[] => (Array.isArray(body?.[key]) ? body[key] as Row[] : []);

    const outbox = list((await h.get('/api/events/outbox?limit=500&status=ALL', viewer)).body, 'events').find(r => r.eventId === tag);
    expectUtc('outbox occurredAt', outbox?.occurredAt);
    expectUtc('outbox processedAt', outbox?.processedAt);
    expectUtc('outbox nextRetryAt', outbox?.nextRetryAt);
    if ((outbox?.payload as Row | undefined)?.createdAt !== SERVER_TS) wrong.push(`outbox payload changed: ${JSON.stringify(outbox?.payload)}`);

    const dead = list((await h.get('/api/events/dlq?limit=500', viewer)).body, 'data').find(r => r.id === dlq.id);
    expectUtc('dead letter quarantinedAt', dead?.quarantinedAt);
    if ((dead?.payload as Row | undefined)?.createdAt !== SERVER_TS) wrong.push(`dead letter payload changed: ${JSON.stringify(dead?.payload)}`);

    const ruleRow = list((await h.get('/api/events/action-rules', viewer)).body, 'data').find(r => r.id === rule.id);
    expectUtc('rule lastExecutedAt', ruleRow?.lastExecutedAt);
    expectUtc('rule createdAt', ruleRow?.createdAt);

    const logRow = list((await h.get('/api/events/action-logs?limit=500', viewer)).body, 'data').find(r => r.id === log.id);
    expectUtc('action log executedAt', logRow?.executedAt);

    const timeline = list((await h.get(`/api/events/event-sourcing/timeline?type=document&id=${aggregateId}`, viewer)).body, 'timeline');
    const outboxItem = timeline.find(r => r.eventId === tag);
    expectUtc('timeline occurredAt', outboxItem?.occurredAt);

    const subRow = list((await h.get('/api/events/webhooks', viewer)).body, 'data').find(r => r.id === sub.id);
    expectUtc('webhook createdAt', subRow?.createdAt);
    expectUtc('webhook lastDeliveryAt', subRow?.lastDeliveryAt);
    const delivery = list((await h.get(`/api/events/webhooks/deliveries/list?subscriptionId=${sub.id}`, viewer)).body, 'data')[0];
    expectUtc('webhook delivery createdAt', delivery?.createdAt);

    const notifRes = await h.get('/api/notifications', viewer);
    const notifRow = (Array.isArray(notifRes.body) ? notifRes.body as Row[] : []).find(r => r.id === notif.id);
    expectUtc('notification created_at', notifRow?.created_at);

    const wooRes = await h.get('/api/woocommerce/order-logs', viewer);
    const wooRow = (Array.isArray(wooRes.body) ? wooRes.body as Row[] : []).find(r => r.id === woo.id);
    expectUtc('woocommerce order log createdAt', wooRow?.createdAt);
    expectUtc('woocommerce order log updatedAt', wooRow?.updatedAt);

    // a business date under a timestamp key is not a server timestamp and stays as it is
    const timestamps = await import('../../lib/serverTimestamp.js');
    if (typeof timestamps.withUtcTimestampKeys !== 'function') wrong.push('withUtcTimestampKeys is missing');
    else {
      const sample = timestamps.withUtcTimestampKeys({ createdAt: '2026-10-06', other: SERVER_TS, payload: { createdAt: SERVER_TS } }, new Set(['createdAt']), new Set(['payload']));
      if (sample.createdAt !== '2026-10-06' || sample.other !== SERVER_TS || sample.payload.createdAt !== SERVER_TS) wrong.push(`converter touched another value: ${JSON.stringify(sample)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'outbox, dead letter, rule, action log, timeline, webhook, delivery, notification and WooCommerce order log times all end in Z; stored payloads unchanged',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, cleanup.eventId)).catch(() => undefined);
    if (cleanup.notifId) await orm.delete(notifications).where(eq(notifications.id, cleanup.notifId)).catch(() => undefined);
    if (cleanup.subId) {
      await orm.delete(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, cleanup.subId)).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, cleanup.subId)).catch(() => undefined);
    }
    if (cleanup.logId) await orm.delete(eventActionLogs).where(eq(eventActionLogs.id, cleanup.logId)).catch(() => undefined);
    if (cleanup.ruleId) await orm.delete(eventActionRules).where(eq(eventActionRules.id, cleanup.ruleId)).catch(() => undefined);
    if (cleanup.dlqId) await orm.delete(deadLetterEvents).where(eq(deadLetterEvents.id, cleanup.dlqId)).catch(() => undefined);
    await orm.delete(outboxEvents).where(inArray(outboxEvents.eventId, [cleanup.eventId])).catch(() => undefined);
    await h.cleanup();
  }
  return results;
}
