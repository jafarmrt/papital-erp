import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { setProbeEventPatterns } from '../fixtures/eventProbe.js';
import { orm, pool } from '../../db/drizzle.js';
import { eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-705 / B15-03 (decision t2 a): every delivery of an event (webhook subscription
 * x event, rule action x event) has its own durable row; a failed one is retried with a growing delay, reaches the dead
 * letter queue after its cap, and the replay runs only that delivery; a delivery that succeeded is never sent again. On
 * v9.0.377 webhook retries were three in-memory timers, a failed rule action was never run again, both outbox handlers
 * always reported success and nothing reached the dead letter queue.
 */
export async function runIntegrationDeliveryRetryTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_integration_delivery_retry_dead_letter_td_705';
  if (!shouldRun(id, 'td705', 'b15-03', 'webhook', 'outbox', 'dlq', 'package15')) return results;

  const name = 'v9.0.378: a failed webhook or rule action delivery is retried from its own durable row, then dead-lettered and replayed alone (TD-705)';
  const tStart = Date.now();
  const tag = `td705_${Date.now()}`;
  const eventType = `Td705.Probe${Date.now()}`;
  const savedPort = process.env.PORT;
  const requests: Array<{ sub: string; deliveryId: string; eventId: string }> = [];
  let failing = true;
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const sub = String(req.headers['x-test-sub'] ?? '');
      let eventId = '';
      try {
        const parsed = JSON.parse(body) as { eventId?: string; event?: { eventId?: string } };
        eventId = parsed.eventId ?? parsed.event?.eventId ?? '';
      } catch { /* not JSON */ }
      requests.push({ sub, deliveryId: String(req.headers['x-erp-delivery-id'] ?? ''), eventId });
      res.statusCode = failing && sub !== 'ok' ? 500 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ received: true }));
    });
  });
  const subIds: number[] = [];
  let ruleId = 0;
  try {
    const port = await new Promise<number>(resolve => receiver.listen(0, '127.0.0.1', () => resolve((receiver.address() as AddressInfo).port)));
    process.env.PORT = String(port); // the SSRF guard's echo exception: this server's own port and the exact echo path
    const target = `http://127.0.0.1:${port}/api/events/webhook-echo`;
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
    const { DeadLetterQueueService } = await import('../../services/events/deadLetterQueueService.js');
    const delivery = await import('../../services/events/integrationDelivery.service.js').catch(() => null);
    const wrong: string[] = [];

    for (const sub of ['fail', 'ok']) {
      const created = await WebhookSubscriptionService.createSubscription({
        name: `${tag} ${sub}`, targetUrl: target, eventPatterns: ['*'], customHeaders: { 'X-Test-Sub': sub }, retryLimit: 3, timeoutMs: 3000,
      });
      await setProbeEventPatterns(created.id, [eventType]);
      subIds.push(created.id);
    }
    const [failSubId, okSubId] = subIds;
    const [rule] = await orm.insert(eventActionRules).values({
      name: `${tag} rule`, eventType, conditionsJson: [], actionType: 'webhook', isActive: 1,
      actionConfigJson: { url: target, method: 'POST', timeoutMs: 3000, headers: { 'X-Test-Sub': 'rule' } },
    }).returning({ id: eventActionRules.id });
    ruleId = rule.id;

    const now = new Date().toISOString();
    const eventId = `${tag}_event`;
    const event = {
      eventId, eventType, aggregateType: 'Document' as const, aggregateId: '705', payload: { documentId: 705 },
      metadata: { userId: 0, userName: 'td705', timestamp: now }, occurredAt: now,
    } as unknown as Parameters<typeof WebhookSubscriptionService.dispatchDomainEventToSubscribers>[0];
    const handleEvent = async () => {
      const dispatched = await WebhookSubscriptionService.dispatchDomainEventToSubscribers(event) as unknown as { attempts?: Promise<unknown>[] } | undefined;
      await Promise.all(dispatched?.attempts ?? []);
      await EventActionEngineService.processEvent(event);
    };
    const jobs = async () => {
      try {
        const rows = await pool.query('SELECT id, kind, target_id, status, attempts, max_attempts, EXTRACT(EPOCH FROM (next_attempt_at - now())) AS wait FROM integration_delivery_jobs WHERE event_id = $1', [eventId]);
        return rows.rows as Array<{ id: number; kind: string; target_id: number; status: string; attempts: number; max_attempts: number; wait: string }>;
      } catch {
        return null;
      }
    };
    const jobOf = async (kind: string, targetId: number) => (await jobs())?.find(j => j.kind === kind && j.target_id === targetId);
    const sentTo = (sub: string) => requests.filter(r => r.sub === sub && r.eventId === eventId);
    const forceDue = () => pool.query(`UPDATE integration_delivery_jobs SET next_attempt_at = now() - interval '1 second' WHERE event_id = $1 AND status = 'pending'`, [eventId]).catch(() => undefined);

    // 1. first attempts: the healthy subscription is delivered, the failing subscription and rule wait in their rows
    await handleEvent();
    await new Promise(r => setTimeout(r, 300));
    const failJob = await jobOf('webhook', failSubId);
    const okJob = await jobOf('webhook', okSubId);
    const ruleJob = await jobOf('rule_action', ruleId);
    if (!failJob || !okJob || !ruleJob) {
      wrong.push(`no durable delivery rows: ${JSON.stringify(await jobs())}`);
    } else {
      if (okJob.status !== 'succeeded') wrong.push(`healthy subscription job ${okJob.status}`);
      const wait = Number(failJob.wait);
      if (failJob.status !== 'pending' || failJob.attempts !== 1 || failJob.max_attempts !== 3 || !(wait > 2 && wait <= 6)) {
        wrong.push(`failing subscription job after one attempt: ${failJob.status} attempts ${failJob.attempts}/${failJob.max_attempts}, retry in ${wait}s`);
      }
      if (ruleJob.status !== 'pending' || ruleJob.attempts !== 1 || ruleJob.max_attempts !== 5) wrong.push(`rule job after one attempt: ${ruleJob.status} attempts ${ruleJob.attempts}/${ruleJob.max_attempts}`);
    }

    // 2. the outbox running the handlers again (a retry of the event) sends nothing that is recorded and not yet due
    const sentBefore = { ok: sentTo('ok').length, fail: sentTo('fail').length, rule: sentTo('rule').length };
    await handleEvent();
    await new Promise(r => setTimeout(r, 300));
    if (sentTo('ok').length !== 1 || sentTo('fail').length !== sentBefore.fail || sentTo('rule').length !== sentBefore.rule) {
      wrong.push(`handlers run again sent ok ${sentTo('ok').length - sentBefore.ok}, fail ${sentTo('fail').length - sentBefore.fail}, rule ${sentTo('rule').length - sentBefore.rule} more`);
    }

    // 3. the worker retries until the cap, then the dead letter queue holds each failed delivery on its own
    if (delivery) {
      for (let pass = 0; pass < 6; pass++) {
        await forceDue();
        await delivery.IntegrationDeliveryService.processDueJobs();
      }
    } else {
      wrong.push('no integration delivery worker');
    }
    const failedJob = await jobOf('webhook', failSubId);
    const failedRule = await jobOf('rule_action', ruleId);
    if (failedJob?.status !== 'failed' || failedJob.attempts !== 3) wrong.push(`failing subscription job after the worker: ${failedJob?.status} attempts ${failedJob?.attempts}`);
    if (failedRule?.status !== 'failed' || failedRule.attempts !== 5) wrong.push(`rule job after the worker: ${failedRule?.status} attempts ${failedRule?.attempts}`);
    const failRequests = sentTo('fail');
    if (failRequests.length !== 3 || new Set(failRequests.map(r => r.deliveryId)).size !== 1) {
      wrong.push(`failing subscription got ${failRequests.length} request(s) with delivery ids ${[...new Set(failRequests.map(r => r.deliveryId))].join(',')}`);
    }
    if (sentTo('rule').length !== 5) wrong.push(`rule action sent ${sentTo('rule').length} request(s), expected 5`);
    const deliveryRows = await orm.select({ attempt: webhookDeliveries.attempt, status: webhookDeliveries.status }).from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.subscriptionId, failSubId), eq(webhookDeliveries.eventId, eventId)));
    if (deliveryRows.map(r => r.attempt).sort().join(',') !== '1,2,3') wrong.push(`delivery log attempts ${deliveryRows.map(r => `${r.attempt}:${r.status}`).join(',')}`);
    const dead = await pool.query(`SELECT id, original_event_id, source, status, metadata FROM dead_letter_events WHERE original_event_id LIKE $1 ORDER BY id`, [`${eventId}#%`]);
    const deadWebhook = dead.rows.find((r: { source: string }) => r.source === 'webhook');
    const deadRule = dead.rows.find((r: { source: string }) => r.source === 'action_engine');
    if (dead.rows.length !== 2 || deadWebhook?.original_event_id !== `${eventId}#webhook:${failSubId}` || deadRule?.original_event_id !== `${eventId}#rule:${ruleId}`) {
      wrong.push(`dead letter rows: ${JSON.stringify(dead.rows.map((r: { original_event_id: string; source: string }) => [r.original_event_id, r.source]))}`);
    }

    // 4. replay of the webhook's dead letter runs only that delivery, with the same delivery id
    failing = false;
    if (deadWebhook) {
      const okSentBefore = sentTo('ok').length;
      const replay = await DeadLetterQueueService.replayEvent(Number(deadWebhook.id)).catch((err: unknown) => ({ success: false, message: err instanceof Error ? err.message : String(err) }));
      const replayedJob = await jobOf('webhook', failSubId);
      const last = sentTo('fail').at(-1);
      if (!replay.success || replayedJob?.status !== 'succeeded' || sentTo('fail').length !== 4 || last?.deliveryId !== failRequests[0]?.deliveryId || sentTo('ok').length !== okSentBefore) {
        wrong.push(`replay: ${replay.success} ${replay.message}, job ${replayedJob?.status}, fail requests ${sentTo('fail').length}, ok requests +${sentTo('ok').length - okSentBefore}`);
      }
    }

    // 5. requeue of the dead letter queue puts the rule's delivery back in its own queue, not in the outbox
    if (deadRule && delivery) {
      await orm.transaction(tx => DeadLetterQueueService.requeueUnresolvedToOutbox(tx));
      const requeued = await jobOf('rule_action', ruleId);
      const outbox = await pool.query(`SELECT event_id FROM outbox_events WHERE event_id LIKE $1`, [`${eventId}#%`]);
      if (requeued?.status !== 'pending' || requeued.attempts !== 0 || outbox.rows.length > 0) wrong.push(`requeue: job ${requeued?.status} attempts ${requeued?.attempts}, outbox rows ${outbox.rows.length}`);
      await delivery.IntegrationDeliveryService.processDueJobs();
      const done = await jobOf('rule_action', ruleId);
      const logs = await orm.select({ status: eventActionLogs.status }).from(eventActionLogs).where(and(eq(eventActionLogs.ruleId, ruleId), eq(eventActionLogs.eventId, eventId)));
      if (done?.status !== 'succeeded' || logs.length !== 6 || logs.filter(l => l.status === 'success').length !== 1) wrong.push(`requeued rule action: job ${done?.status}, logs ${logs.map(l => l.status).join(',')}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'first attempts: healthy sent once, failing webhook and rule pending with backoff; handlers rerun send nothing; worker: webhook 3 attempts (one delivery id), rule 5, both dead-lettered on their own rows; replay sends only that webhook; requeue returns the rule to its queue, not the outbox',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
    await pool.query('DELETE FROM integration_delivery_jobs WHERE event_id LIKE $1', [`${tag}%`]).catch(() => undefined);
    await pool.query('DELETE FROM dead_letter_events WHERE original_event_id LIKE $1', [`${tag}%`]).catch(() => undefined);
    await pool.query('DELETE FROM outbox_events WHERE event_id LIKE $1', [`${tag}%`]).catch(() => undefined);
    if (subIds.length > 0) {
      await orm.delete(webhookDeliveries).where(inArray(webhookDeliveries.subscriptionId, subIds)).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(inArray(webhookSubscriptions.id, subIds)).catch(() => undefined);
    }
    if (ruleId) {
      await orm.delete(eventActionLogs).where(eq(eventActionLogs.ruleId, ruleId)).catch(() => undefined);
      await orm.delete(eventActionRules).where(eq(eventActionRules.id, ruleId)).catch(() => undefined);
    }
    await orm.delete(webhookSubscriptions).where(like(webhookSubscriptions.name, `${tag}%`)).catch(() => undefined);
  }
  return results;
}
