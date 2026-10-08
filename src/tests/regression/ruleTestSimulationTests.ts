import request from 'supertest';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, eventActionLogs, eventActionRules, integrationDeliveryJobs, notifications, outboxEvents, webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-708 / B15-06 (decision t5 a): the rule «test» button, the event simulation and
 * the timeline replay have no effect. A rule test evaluates the stored rule on a sample event and shows what its action
 * would do; the simulation publishes nothing and lists the matching rules and webhook subscriptions; the live replay is
 * removed. On v9.0.384 a rule test ran the real action (a real notification and an audit row such as «تراکنش کلان»), the
 * simulation published any type and payload to the live handlers (a validly signed webhook to an outside partner), and the
 * replay published with `dryRun: false`.
 */
export async function runRuleTestSimulationTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_rule_test_and_simulation_have_no_effect_td_708';
  if (!shouldRun(id, 'td708', 'b15-06', 'action-rule', 'package15')) return results;

  const name = 'v9.0.385: rule test, event simulation and timeline replay evaluate only, with no notification, audit row, delivery or published event (TD-708)';
  const tStart = Date.now();
  const ruleIds: number[] = [];
  let subscriptionId: number | null = null;
  const tag = `td708_${Date.now()}`;
  const fakeRef = `FAKE-${tag}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (url: string, body: object) =>
      request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    const category = `${tag}_category`;
    const insertRule = async (actionType: string, actionConfigJson: object) => {
      const [row] = await orm.insert(eventActionRules).values({
        name: `${tag} ${actionType}`, eventType: 'InvoiceApproved', conditionsJson: [], actionType, actionConfigJson, isActive: 1,
      }).returning({ id: eventActionRules.id });
      ruleIds.push(row.id);
      return row.id;
    };
    const auditRule = await insertRule('audit_log', { category, descriptionTemplate: 'Invoice {{payload.refNumber}} amount {{payload.totalAmount}}' });
    const notifyRule = await insertRule('in_app_notification', { titleTemplate: `${tag} {{payload.refNumber}}`, messageTemplate: 'm' });
    const hookRule = await insertRule('webhook', { url: '/api/events/webhook-echo', method: 'POST' });
    const [sub] = await orm.insert(webhookSubscriptions).values({
      name: `${tag} partner`, targetUrl: 'https://partner.example.com/hooks', secretKey: 'test-only', eventPatterns: ['InvoiceApproved'], isActive: 1,
    }).returning({ id: webhookSubscriptions.id });
    subscriptionId = sub.id;

    const effects = async () => {
      const [audits] = await orm.select({ n: sql<number>`count(*)::int` }).from(activityLogs).where(eq(activityLogs.entity, category));
      const [notes] = await orm.select({ n: sql<number>`count(*)::int` }).from(notifications).where(like(notifications.title, `${tag}%`));
      const [logs] = await orm.select({ n: sql<number>`count(*)::int` }).from(eventActionLogs).where(inArray(eventActionLogs.ruleId, ruleIds));
      const [deliveries] = await orm.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, sub.id));
      const [jobs] = await orm.select({ n: sql<number>`count(*)::int` }).from(integrationDeliveryJobs)
        .where(or(and(eq(integrationDeliveryJobs.kind, 'webhook'), eq(integrationDeliveryJobs.targetId, sub.id)), and(eq(integrationDeliveryJobs.kind, 'rule_action'), inArray(integrationDeliveryJobs.targetId, ruleIds))));
      const [outbox] = await orm.select({ n: sql<number>`count(*)::int` }).from(outboxEvents).where(sql`${outboxEvents.payload}::text LIKE ${`%${tag}%`}`);
      const counters = await orm.select({ n: eventActionRules.executionCount }).from(eventActionRules).where(inArray(eventActionRules.id, ruleIds));
      const recent = await request(app).get('/api/events/domain-events?limit=500').set('Cookie', admin.cookie);
      const published = (Array.isArray(recent.body?.events) ? recent.body.events : []).filter((e: unknown) => JSON.stringify(e).includes(tag)).length;
      return { audits: audits.n, notes: notes.n, logs: logs.n, deliveries: deliveries.n, jobs: jobs.n, outbox: outbox.n, executions: counters.reduce((s, r) => s + Number(r.n ?? 0), 0), published };
    };
    const before = await effects();

    // 1. a rule test evaluates the stored rule and shows what its action would do, without running it
    const auditTest = await post(`/api/events/action-rules/${auditRule}/test`, {});
    if (auditTest.status !== 200 || auditTest.body?.executed !== false || auditTest.body?.conditionMatches !== true || !String(auditTest.body?.preview?.description ?? '').includes('INV-1405-TEST')) {
      wrong.push(`audit rule test: ${auditTest.status} ${JSON.stringify(auditTest.body).slice(0, 240)}`);
    }
    const notifyTest = await post(`/api/events/action-rules/${notifyRule}/test`, {});
    if (notifyTest.status !== 200 || !(Number(notifyTest.body?.preview?.recipientCount) >= 1)) wrong.push(`notification rule test: ${notifyTest.status} ${JSON.stringify(notifyTest.body?.preview)}`);
    const hookTest = await post(`/api/events/action-rules/${hookRule}/test`, {});
    if (hookTest.status !== 200 || !String(hookTest.body?.preview?.url ?? '').includes('/api/events/webhook-echo')) wrong.push(`webhook rule test: ${hookTest.status} ${JSON.stringify(hookTest.body?.preview)}`);
    const missing = await post('/api/events/action-rules/987654321/test', {});
    if (missing.status !== 404 || missing.body?.code !== 'RULE_NOT_FOUND') wrong.push(`missing rule test: ${missing.status} ${missing.body?.code}`);

    // 2. the simulation publishes nothing; it lists the matching rules (with the caller's payload) and webhook subscriptions
    const simulate = await post('/api/events/domain-events/simulate', { eventType: 'InvoiceApproved', payload: { refNumber: fakeRef, totalAmount: 987654321 } });
    const simulatedRules: Array<{ ruleId: number; matched: boolean; preview: Record<string, unknown> | null }> = Array.isArray(simulate.body?.rules) ? simulate.body.rules : [];
    const auditOutcome = simulatedRules.find(r => r.ruleId === auditRule);
    const webhookIds = (Array.isArray(simulate.body?.webhooks) ? simulate.body.webhooks : []).map((w: { subscriptionId: number }) => w.subscriptionId);
    if (simulate.status !== 200 || simulate.body?.simulated !== true || !auditOutcome?.matched || !String(auditOutcome.preview?.description ?? '').includes(fakeRef) || !webhookIds.includes(sub.id)) {
      wrong.push(`simulate: ${simulate.status} ${JSON.stringify(simulate.body).slice(0, 300)}`);
    }
    const unknownType = await post('/api/events/domain-events/simulate', { eventType: 'SimulatedTestEvent', payload: { refNumber: fakeRef } });
    if (unknownType.status !== 422 || unknownType.body?.code !== 'EVENT_SIMULATION_TYPE_UNKNOWN') wrong.push(`simulate unknown type: ${unknownType.status} ${unknownType.body?.code}`);

    // 3. the timeline replay is only a simulation; the live replay is refused
    const replay = (dryRun: boolean) => post('/api/events/event-sourcing/simulate-replay', {
      eventId: `${tag}-replay`, eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId: '1', payload: { refNumber: fakeRef, totalAmount: 1 }, dryRun,
    });
    const live = await replay(false);
    if (live.status !== 422 || live.body?.code !== 'EVENT_REPLAY_LIVE_REMOVED') wrong.push(`live replay: ${live.status} ${live.body?.code}`);
    const dry = await replay(true);
    if (dry.status !== 200 || dry.body?.dryRun !== true || !Array.isArray(dry.body?.rulesBreakdown)) wrong.push(`dry replay: ${dry.status} ${JSON.stringify(dry.body).slice(0, 200)}`);

    // 4. nothing was written, sent, counted or published
    const after = await effects();
    if (JSON.stringify(after) !== JSON.stringify(before)) wrong.push(`effects changed: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'three rule tests previewed audit / notification / webhook without running them (missing rule 404); simulation listed the matching rule with the given payload and the subscription, unknown type 422; live replay 422, dry replay 200; no audit row, notification, action log, delivery, job, outbox row, counter change or published event',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(activityLogs).where(eq(activityLogs.entity, `${tag}_category`)).catch(() => undefined);
    await orm.delete(notifications).where(like(notifications.title, `${tag}%`)).catch(() => undefined);
    if (ruleIds.length > 0) {
      await orm.delete(eventActionLogs).where(inArray(eventActionLogs.ruleId, ruleIds)).catch(() => undefined);
      await orm.delete(integrationDeliveryJobs).where(and(eq(integrationDeliveryJobs.kind, 'rule_action'), inArray(integrationDeliveryJobs.targetId, ruleIds))).catch(() => undefined);
      await orm.delete(eventActionRules).where(inArray(eventActionRules.id, ruleIds)).catch(() => undefined);
    }
    if (subscriptionId !== null) {
      await orm.delete(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, subscriptionId)).catch(() => undefined);
      await orm.delete(integrationDeliveryJobs).where(and(eq(integrationDeliveryJobs.kind, 'webhook'), eq(integrationDeliveryJobs.targetId, subscriptionId))).catch(() => undefined);
      await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, subscriptionId)).catch(() => undefined);
    }
  }
  return results;
}
