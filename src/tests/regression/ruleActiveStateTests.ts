import { and, asc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, eventActionRules } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-729 / B15-27: switching an automatic rule on or off sends the target state
 * (`{ active }`), under the rule row lock: a repeat or a concurrent second request changes nothing, and each change writes
 * one audit row with before / after in its transaction. On v9.0.437 the route flipped the state on every call, so two
 * clicks put the rule back where it was (with two success messages) and no change was audited.
 */
export async function runRuleActiveStateTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_rule_active_target_state_td_729';
  if (!shouldRun(id, 'td729', 'b15-27', 'rules', 'package15')) return results;

  const name = 'v9.0.438: an automatic rule is switched to a target state under its row lock, a repeat changes nothing and each change is audited (TD-729)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  let ruleId = 0;
  try {
    const manager = await h.sessionWith(['events.view', 'events.manage']);
    const wrong: string[] = [];
    const [rule] = await orm.insert(eventActionRules).values({
      name: `TD729 rule ${h.tag}`, eventType: 'InvoiceApproved', actionType: 'audit_log',
      actionConfigJson: { descriptionTemplate: 'td729' }, isActive: 0,
    }).returning({ id: eventActionRules.id });
    ruleId = rule.id;
    const url = `/api/events/action-rules/${ruleId}/toggle`;
    const stateOf = async () => (await orm.select({ isActive: eventActionRules.isActive }).from(eventActionRules).where(eq(eventActionRules.id, ruleId)))[0]?.isActive;
    const audits = async () => orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, `قانون واکنش خودکار #${ruleId}`), eq(activityLogs.entityId, String(ruleId))))
      .orderBy(asc(activityLogs.id));

    const on = await h.post(url, { active: true }, manager);
    if (on.status !== 200 || on.body?.changed !== true || await stateOf() !== 1) wrong.push(`switch on: ${on.status} changed ${on.body?.changed}, state ${await stateOf()}`);
    const again = await h.post(url, { active: true }, manager);
    if (again.status !== 200 || again.body?.changed !== false || await stateOf() !== 1) wrong.push(`repeat on: ${again.status} changed ${again.body?.changed}, state ${await stateOf()}`);

    const both = await Promise.all([h.post(url, { active: false }, manager), h.post(url, { active: false }, manager)]);
    const changedCount = both.filter(r => r.body?.changed === true).length;
    if (both.some(r => r.status !== 200) || changedCount !== 1 || await stateOf() !== 0) {
      wrong.push(`two concurrent offs: ${both.map(r => `${r.status}/${r.body?.changed}`).join(', ')}, state ${await stateOf()}`);
    }

    const rows = await audits();
    const flips = rows.map(r => (r.details as { after?: { isActive?: number } })?.after?.isActive);
    if (rows.length !== 2 || flips.join(',') !== '1,0') wrong.push(`audit rows ${rows.length}: ${JSON.stringify(rows.map(r => r.details))}`);

    const noTarget = await h.post(url, {}, manager);
    if (noTarget.status !== 400 || await stateOf() !== 0) wrong.push(`no target state: ${noTarget.status}, state ${await stateOf()}`);
    const missing = await h.post('/api/events/action-rules/999999999/toggle', { active: true }, manager);
    if (missing.status !== 404 || missing.body?.code !== 'EVENT_RULE_NOT_FOUND') wrong.push(`missing rule: ${missing.status} ${missing.body?.code}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'on → changed; on again → unchanged; two concurrent offs → one change; two audit rows (1, 0); no target 400; missing rule 404',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (ruleId) {
      await orm.delete(activityLogs).where(and(eq(activityLogs.entity, `قانون واکنش خودکار #${ruleId}`), inArray(activityLogs.entityId, [String(ruleId)]))).catch(() => undefined);
      await orm.delete(eventActionRules).where(eq(eventActionRules.id, ruleId)).catch(() => undefined);
    }
    await h.cleanup();
  }
  return results;
}
