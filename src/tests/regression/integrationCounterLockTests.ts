import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { setProbeEventPatterns } from '../fixtures/eventProbe.js';
import { orm, pool } from '../../db/drizzle.js';
import { eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-718 / B15-16: a rule's execution counter and a webhook subscription's
 * delivery counters are read under the row's lock and written in the same transaction as the attempt's log row, so
 * concurrent attempts are all counted. On v9.0.378 each attempt wrote the count it had read before its action
 * (10 concurrent executions left `execution_count` far below 10).
 */
export async function runIntegrationCounterLockTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_integration_counters_under_row_lock_td_718';
  if (!shouldRun(id, 'td718', 'b15-16', 'webhook', 'action-rule', 'concurrency', 'package15')) return results;

  const name = 'v9.0.379: concurrent rule executions and webhook deliveries are all counted on the rule and subscription (TD-718)';
  const tStart = Date.now();
  const tag = `td718_${Date.now()}`;
  const runs = 10;
  const savedPort = process.env.PORT;
  const receiver = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => setTimeout(() => { res.statusCode = 200; res.end('{}'); }, 20));
  });
  let ruleId = 0;
  let subId = 0;
  try {
    const port = await new Promise<number>(resolve => receiver.listen(0, '127.0.0.1', () => resolve((receiver.address() as AddressInfo).port)));
    process.env.PORT = String(port); // the SSRF guard's echo exception: this server's own port and the exact echo path
    const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const wrong: string[] = [];

    const [rule] = await orm.insert(eventActionRules).values({
      name: `${tag} rule`, eventType: 'Td718.Probe', conditionsJson: [], actionType: 'audit_log', isActive: 1,
      actionConfigJson: { category: tag, descriptionTemplate: 'td718 {{eventId}}' },
    }).returning({ id: eventActionRules.id });
    ruleId = rule.id;
    const sub = await WebhookSubscriptionService.createSubscription({
      name: `${tag} sub`, targetUrl: `http://127.0.0.1:${port}/api/events/webhook-echo`, eventPatterns: ['*'], timeoutMs: 3000,
    });
    subId = sub.id;
    await setProbeEventPatterns(subId, ['Td718.Probe']);

    const now = new Date().toISOString();
    const eventOf = (i: number) => ({
      eventId: `${tag}_${i}`, eventType: 'Td718.Probe', aggregateType: 'Document', aggregateId: String(i), payload: { i },
      metadata: { userId: 0, userName: 'td718', timestamp: now }, occurredAt: now,
    }) as unknown as Parameters<typeof EventActionEngineService.runRuleActionAttempt>[1];

    await Promise.all(Array.from({ length: runs }, (_, i) => EventActionEngineService.runRuleActionAttempt(ruleId, eventOf(i), { jobId: 0, attempt: 1 })));
    await Promise.all(Array.from({ length: runs }, (_, i) => WebhookSubscriptionService.deliverJobAttempt(subId, eventOf(i), { jobId: i + 1, attempt: 1 })));

    const [ruleRow] = await orm.select({ executionCount: eventActionRules.executionCount }).from(eventActionRules).where(eq(eventActionRules.id, ruleId));
    const logs = await orm.select({ id: eventActionLogs.id }).from(eventActionLogs).where(eq(eventActionLogs.ruleId, ruleId));
    if (ruleRow?.executionCount !== runs || logs.length !== runs) wrong.push(`rule: execution_count ${ruleRow?.executionCount}, logs ${logs.length}, expected ${runs}`);

    const [subRow] = await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId));
    const deliveries = await orm.select({ status: webhookDeliveries.status }).from(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, subId));
    const succeeded = deliveries.filter(d => d.status === 'success').length;
    if (subRow?.totalDeliveries !== deliveries.length || subRow?.successfulDeliveries !== succeeded || subRow?.failedDeliveries !== deliveries.length - succeeded || deliveries.length !== runs) {
      wrong.push(`subscription: total ${subRow?.totalDeliveries}, successful ${subRow?.successfulDeliveries}, failed ${subRow?.failedDeliveries}; delivery rows ${deliveries.length} (${succeeded} success)`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `${runs} concurrent rule executions -> execution_count ${runs}; ${runs} concurrent webhook deliveries -> total and successful ${runs}`,
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
    if (ruleId) {
      await orm.delete(eventActionLogs).where(eq(eventActionLogs.ruleId, ruleId)).catch(() => undefined);
      await orm.delete(eventActionRules).where(eq(eventActionRules.id, ruleId)).catch(() => undefined);
    }
    if (subId) {
      await orm.delete(webhookDeliveries).where(inArray(webhookDeliveries.subscriptionId, [subId])).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, subId)).catch(() => undefined);
    }
    await pool.query('DELETE FROM activity_logs WHERE entity = $1', [tag]).catch(() => undefined);
  }
  return results;
}
