import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { findMissingConditionalConstraints } from '../../services/system/conditionalConstraints.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v9.0.445 (TD-611, B01-31, decision t6 «الف»): webhook deliveries and rule action logs have the foreign keys the Drizzle
 * schema declares (CASCADE and SET NULL, migration 0090), deleting a subscription or a rule runs in one transaction with
 * its queued jobs and one audit row, and a key left NOT VALID over legacy orphans is listed and validated by hand once the
 * data is clean. Red on v9.0.444: no constraint, so the delivery and the log kept pointing to the deleted id, and the
 * webhook delete wrote no audit row.
 */

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await orm.execute(q)).rows as Row[];
const one = async (q: ReturnType<typeof sql>) => (await rows(q))[0];

async function scenario(): Promise<string> {
  const problems: string[] = [];
  const admin = await sandboxAdminClient();
  const tag = `td611-${Date.now()}`;

  const fks = await rows(sql`SELECT conname, confdeltype, convalidated FROM pg_constraint
    WHERE connamespace = current_schema()::regnamespace AND conname IN ('fk_webhook_deliveries_subscription', 'fk_event_action_logs_rule')`);
  const fk = new Map(fks.map(r => [String(r.conname), r]));
  if (fk.get('fk_webhook_deliveries_subscription')?.confdeltype !== 'c' || fk.get('fk_webhook_deliveries_subscription')?.convalidated !== true) {
    problems.push(`webhook delivery key: ${JSON.stringify(fk.get('fk_webhook_deliveries_subscription') ?? null)}`);
  }
  if (fk.get('fk_event_action_logs_rule')?.confdeltype !== 'n' || fk.get('fk_event_action_logs_rule')?.convalidated !== true) {
    problems.push(`rule log key: ${JSON.stringify(fk.get('fk_event_action_logs_rule') ?? null)}`);
  }

  // a subscription with one delivery and one queued job; a rule with one log and one queued job
  const subId = Number((await one(sql`INSERT INTO webhook_subscriptions (name, target_url, secret_key)
    VALUES (${`${tag} hook`}, 'https://collector-td611.example.com/h', 'enc:v1:td611-secret') RETURNING id`))?.id);
  await orm.execute(sql`INSERT INTO webhook_deliveries (subscription_id, subscription_name, event_id, event_type, target_url, status)
    VALUES (${subId}, ${`${tag} hook`}, ${`${tag}-e1`}, 'DocumentCreated', 'https://collector-td611.example.com/h', 'success')`);
  const ruleId = Number((await one(sql`INSERT INTO event_action_rules (name, event_type, action_type)
    VALUES (${`${tag} rule`}, 'DocumentCreated', 'audit_log') RETURNING id`))?.id);
  await orm.execute(sql`INSERT INTO event_action_logs (rule_id, rule_name, event_id, event_type, action_type, status)
    VALUES (${ruleId}, ${`${tag} rule`}, ${`${tag}-e1`}, 'DocumentCreated', 'audit_log', 'success')`);
  for (const [kind, target] of [['webhook', subId], ['rule_action', ruleId]] as const) {
    await orm.execute(sql`INSERT INTO integration_delivery_jobs (kind, target_id, event_id, event_type, event)
      VALUES (${kind}, ${target}, ${`${tag}-e2`}, 'DocumentCreated', '{}'::jsonb)`);
  }
  const jobStatus = async (kind: string, target: number) =>
    String((await one(sql`SELECT status FROM integration_delivery_jobs WHERE kind = ${kind} AND target_id = ${target}`))?.status);

  const delHook = await admin.del(`/api/events/webhooks/${subId}`);
  if (delHook.status !== 200) problems.push(`webhook delete answered ${delHook.status}`);
  const leftDeliveries = Number((await one(sql`SELECT COUNT(*)::int AS n FROM webhook_deliveries WHERE subscription_id = ${subId}`))?.n);
  if (leftDeliveries !== 0) problems.push(`${leftDeliveries} delivery row(s) still point to the deleted subscription`);
  if (await jobStatus('webhook', subId) !== 'cancelled') problems.push(`the subscription's queued job is ${await jobStatus('webhook', subId)}`);
  const hookAudit = await rows(sql`SELECT details FROM activity_logs WHERE action = 'DELETE' AND entity = ${`اشتراک وب‌هوک: ${tag} hook`}`);
  if (hookAudit.length !== 1) problems.push(`expected one webhook delete audit row, found ${hookAudit.length}`);
  else {
    const text = JSON.stringify(hookAudit[0].details);
    if (!text.includes('"deliveriesRemoved":1') || !text.includes('"pendingDeliveriesCancelled":1')) problems.push(`webhook audit details: ${text.slice(0, 300)}`);
    if (text.includes('td611-secret')) problems.push('the webhook audit row holds the signing key');
  }

  const delRule = await admin.del(`/api/events/action-rules/${ruleId}`);
  if (delRule.status !== 200) problems.push(`rule delete answered ${delRule.status}`);
  const log = await one(sql`SELECT rule_id, rule_name FROM event_action_logs WHERE event_id = ${`${tag}-e1`}`);
  if (!log) problems.push('the rule log was deleted with the rule');
  else if (log.rule_id !== null || log.rule_name !== `${tag} rule`) problems.push(`the rule log after the delete: ${JSON.stringify(log)}`);
  if (await jobStatus('rule_action', ruleId) !== 'cancelled') problems.push(`the rule's queued job is ${await jobStatus('rule_action', ruleId)}`);
  const ruleAudit = await rows(sql`SELECT details FROM activity_logs WHERE action = 'DELETE' AND entity = ${`قانون واکنش خودکار #${ruleId}`}`);
  if (ruleAudit.length !== 1 || !JSON.stringify(ruleAudit[0]?.details).includes('"logsKept":1')) {
    problems.push(`rule delete audit rows: ${JSON.stringify(ruleAudit).slice(0, 300)}`);
  }

  const again = await admin.del(`/api/events/webhooks/${subId}`);
  if (again.status !== 404) problems.push(`a second webhook delete answered ${again.status}`);
  const againRule = await admin.del(`/api/events/action-rules/${ruleId}`);
  if (againRule.status !== 404) problems.push(`a second rule delete answered ${againRule.status}`);

  let refused = '';
  try {
    await orm.execute(sql`INSERT INTO webhook_deliveries (subscription_id, event_id, event_type, target_url, status)
      VALUES (${subId}, ${`${tag}-e3`}, 'DocumentCreated', 'https://collector-td611.example.com/h', 'failed')`);
  } catch (err) {
    refused = String((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code ?? 'error');
  }
  if (refused !== '23503') problems.push(`a delivery row for a missing subscription was ${refused ? `refused with ${refused}` : 'accepted'}`);

  assertNoProblems(problems);

  // a database whose legacy logs point to a removed rule: 0090 leaves the key NOT VALID and lists it
  await orm.execute(sql`ALTER TABLE event_action_logs DROP CONSTRAINT fk_event_action_logs_rule`);
  await orm.execute(sql`INSERT INTO event_action_logs (rule_id, rule_name, event_id, event_type, action_type, status)
    VALUES (987611, 'legacy rule', ${`${tag}-legacy`}, 'DocumentCreated', 'audit_log', 'success')`);
  await orm.execute(sql`ALTER TABLE event_action_logs ADD CONSTRAINT fk_event_action_logs_rule FOREIGN KEY (rule_id) REFERENCES event_action_rules(id) ON DELETE SET NULL NOT VALID`);
  const listed = (await findMissingConditionalConstraints()).find(e => e.name === 'fk_event_action_logs_rule');
  if (!listed || listed.state !== 'blocked' || listed.blockers !== 1 || listed.unvalidated !== true) problems.push(`the unvalidated key is listed as ${JSON.stringify(listed ?? null)}`);
  const blocked = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(blocked.body?.blocked ?? []).includes('fk_event_action_logs_rule')) problems.push(`the build over the orphan answered ${JSON.stringify(blocked.body).slice(0, 200)}`);
  await orm.execute(sql`UPDATE event_action_logs SET rule_id = NULL WHERE event_id = ${`${tag}-legacy`}`);
  const built = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(built.body?.built ?? []).includes('fk_event_action_logs_rule')) problems.push(`the build after the fix answered ${JSON.stringify(built.body).slice(0, 200)}`);
  const validated = await one(sql`SELECT convalidated FROM pg_constraint WHERE conname = 'fk_event_action_logs_rule' AND connamespace = current_schema()::regnamespace`);
  if (validated?.convalidated !== true) problems.push('the key is still not validated after the build');

  assertNoProblems(problems);
  return 'both keys carry their declared ON DELETE and are validated; deleting the subscription removed its delivery and the rule kept its log with a null rule id, queued jobs were cancelled, one audit row each, a repeat is 404, an orphan insert is refused, and a NOT VALID key over a legacy orphan was listed and validated after the fix';
}

export async function runEventParentDeleteTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_event_parent_delete_td_611';
  if (shouldRun(id, 'TD-611', 'B01-31')) {
    await runCase(results, id, 'v9.0.445: webhook deliveries and rule logs follow their declared ON DELETE and the delete is one audited transaction (TD-611)',
      () => inFiscalSandbox(scenario));
  }
  return results;
}
