import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-726 / B15-24 (decision t3 a): a rule's trigger event is «*» or a type the
 * server publishes. The editor used to offer InvoiceCancelled, ChequeStatusChanged, ProjectStageCompleted and
 * CustomerCreated, which nothing publishes, so such a rule was saved active and never ran. On v9.0.380 such rules were
 * created, renamed and activated with 200 and the draft evaluation accepted them, and nothing listed the stored ones.
 */
export async function runRuleEventTypeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_rule_event_type_published_only_td_726';
  if (!shouldRun(id, 'td726', 'b15-24', 'action-rule', 'package15')) return results;

  const name = 'v9.0.381: a rule is created, kept active or activated only with an event type the server publishes, and stored ones are listed (TD-726)';
  const tStart = Date.now();
  const tag = `td726_${Date.now()}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];
    const audit = { descriptionTemplate: 'td726' };

    // 1. a new rule for a type nothing publishes is refused; «*» and a published type are accepted
    for (const eventType of ['InvoiceCancelled', 'ChequeStatusChanged', 'ProjectStageCompleted', 'CustomerCreated']) {
      const res = await send('post', '/api/events/action-rules', { name: `${tag} new ${eventType}`, eventType, actionType: 'audit_log', actionConfigJson: audit, isActive: 0 });
      if (res.status !== 422 || res.body?.code !== 'RULE_EVENT_TYPE_UNKNOWN') wrong.push(`create ${eventType}: ${res.status} ${res.body?.code}`);
    }
    for (const eventType of ['*', 'woocommerce.order.synced']) {
      const res = await send('post', '/api/events/action-rules', { name: `${tag} new ${eventType}`, eventType, actionType: 'audit_log', actionConfigJson: audit, isActive: 0 });
      if (res.status >= 300) wrong.push(`create ${eventType}: ${res.status} ${res.body?.message}`);
    }
    const draft = await send('post', '/api/events/action-rules/test-draft', { rule: { name: 'd', eventType: 'ChequeStatusChanged', actionType: 'audit_log', conditionsJson: [], actionConfigJson: audit } });
    if (draft.status !== 422 || !JSON.stringify(draft.body?.details ?? {}).includes('ChequeStatusChanged')) wrong.push(`draft ChequeStatusChanged: ${draft.status} ${draft.body?.code}`);

    // 2. stored rules of such types are listed by the health check
    const insertRule = async (eventType: string, isActive: number) => {
      const [row] = await orm.insert(eventActionRules).values({
        name: `${tag} legacy ${eventType}`, eventType, conditionsJson: [], actionType: 'audit_log', actionConfigJson: audit, isActive,
      }).returning({ id: eventActionRules.id });
      return row.id;
    };
    const activeLegacy = await insertRule('CustomerCreated', 1);
    const inactiveLegacy = await insertRule('ProjectStageCompleted', 0);
    const healthy = await insertRule('InvoiceApproved', 1);
    const healthModule = await import('../../services/events/unpublishedRuleEventHealth.js').catch(() => null);
    if (!healthModule) {
      wrong.push('no health check for rules of unpublished event types');
    } else {
      const health = healthModule.buildUnpublishedRuleEventHealthTest(await healthModule.findRulesWithUnpublishedEvent());
      const listed = new Set((health.items ?? []).map(i => Number(i.id)));
      if (health.status !== 'warning' || !listed.has(activeLegacy) || !listed.has(inactiveLegacy) || listed.has(healthy)) wrong.push(`health: ${health.status}, items ${[...listed].join(',')}`);
    }

    // 3. an active legacy rule is not saved active, an inactive one is editable, activation needs a published type
    const renameActive = await send('put', `/api/events/action-rules/${activeLegacy}`, { name: `${tag} renamed` });
    if (renameActive.status !== 422 || renameActive.body?.code !== 'RULE_EVENT_TYPE_UNKNOWN') wrong.push(`rename active legacy: ${renameActive.status} ${renameActive.body?.code}`);
    const off = await send('post', `/api/events/action-rules/${activeLegacy}/toggle`, {});
    if (off.status !== 200 || off.body?.data?.isActive !== 0) wrong.push(`toggle off: ${off.status} ${off.body?.data?.isActive}`);
    const renameInactive = await send('put', `/api/events/action-rules/${activeLegacy}`, { name: `${tag} renamed` });
    if (renameInactive.status !== 200) wrong.push(`rename inactive legacy: ${renameInactive.status} ${renameInactive.body?.message}`);
    const on = await send('post', `/api/events/action-rules/${inactiveLegacy}/toggle`, {});
    if (on.status !== 422 || on.body?.code !== 'RULE_EVENT_TYPE_UNKNOWN') wrong.push(`toggle on legacy: ${on.status} ${on.body?.code}`);
    const fixed = await send('put', `/api/events/action-rules/${inactiveLegacy}`, { eventType: 'StockIssued', isActive: 1 });
    if (fixed.status !== 200 || fixed.body?.data?.eventType !== 'StockIssued' || fixed.body?.data?.isActive !== 1) wrong.push(`choose event and activate: ${fixed.status} ${JSON.stringify(fixed.body?.data ?? fixed.body?.message)}`);
    const toUnknown = await send('put', `/api/events/action-rules/${healthy}`, { eventType: 'InvoiceCancelled', isActive: 0 });
    if (toUnknown.status !== 422 || toUnknown.body?.code !== 'RULE_EVENT_TYPE_UNKNOWN') wrong.push(`switch to InvoiceCancelled: ${toUnknown.status} ${toUnknown.body?.code}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'unpublished types refused 422 on create, switch, activation and active save (draft too); «*» and published types accepted; stored rules listed by the health check',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const rows = await orm.select({ id: eventActionRules.id }).from(eventActionRules).where(like(eventActionRules.name, `${tag}%`)).catch(() => []);
    if (rows.length > 0) await orm.delete(eventActionRules).where(inArray(eventActionRules.id, rows.map(r => r.id))).catch(() => undefined);
    await orm.delete(eventActionRules).where(eq(eventActionRules.name, `${tag} renamed`)).catch(() => undefined);
  }
  return results;
}
