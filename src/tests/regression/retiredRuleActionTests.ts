import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, eventActionRules, notifications } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-712 / B15-10 (decision t4 a): the rule actions «workflow_trigger» (did nothing,
 * reported «queued») and «sms_simulation» (wrote a log line) are removed. Migration *_retired_rule_actions deactivates
 * existing rules of those types and records them, the health check lists them, a rule is never created or activated
 * with them, and the draft evaluation really evaluates without any effect. On v9.0.376 the migration did not exist,
 * such rules were created and run as «success», and test-draft answered success for an invalid operator and an unknown
 * event type.
 */
export async function runRetiredRuleActionTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_retired_rule_actions_and_real_draft_evaluation_td_712';
  if (!shouldRun(id, 'td712', 'b15-10', 'action-rule', 'package15')) return results;

  const name = 'v9.0.377: workflow-trigger and SMS rule actions retired (deactivated, listed, refused) and the draft evaluation really evaluates (TD-712)';
  const tStart = Date.now();
  const ruleIds: number[] = [];
  const tag = `td712_${Date.now()}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    // 1. legacy rules of the removed types are deactivated and recorded by the migration; another rule is untouched
    const insertRule = async (actionType: string, actionConfigJson: object) => {
      const [row] = await orm.insert(eventActionRules).values({
        name: `${tag} ${actionType}`, eventType: 'InvoiceApproved', conditionsJson: [], actionType, actionConfigJson, isActive: 1,
      }).returning({ id: eventActionRules.id });
      ruleIds.push(row.id);
      return row.id;
    };
    const wfId = await insertRule('workflow_trigger', { workflowCode: 'INVOICE_APPROVAL', entityType: 'invoice', entityIdField: 'payload.documentId' });
    const smsId = await insertRule('sms_simulation', { recipientPhoneTemplate: '09120000000', messageTemplate: 'x' });
    const keepId = await insertRule('audit_log', { descriptionTemplate: 'kept' });
    const migrationFile = fs.readdirSync(path.resolve(process.cwd(), 'drizzle')).find(f => /^\d{4}_retired_rule_actions\.sql$/.test(f));
    if (migrationFile) {
      const sqlText = fs.readFileSync(path.resolve(process.cwd(), 'drizzle', migrationFile), 'utf8');
      for (let run = 0; run < 2; run++) for (const stmt of sqlText.split('--> statement-breakpoint')) await pool.query(stmt);
    } else {
      wrong.push('migration *_retired_rule_actions.sql not found');
    }
    const after = await orm.select({ id: eventActionRules.id, isActive: eventActionRules.isActive }).from(eventActionRules).where(inArray(eventActionRules.id, [wfId, smsId, keepId]));
    const activeOf = (rid: number) => after.find(r => r.id === rid)?.isActive;
    if (activeOf(wfId) !== 0 || activeOf(smsId) !== 0 || activeOf(keepId) !== 1) wrong.push(`after migration active: wf ${activeOf(wfId)}, sms ${activeOf(smsId)}, audit ${activeOf(keepId)}`);
    if (migrationFile) {
      const recorded = await pool.query('SELECT rule_id, action_type, was_active FROM event_action_rule_retirements WHERE rule_id = ANY($1::int[]) ORDER BY rule_id', [[wfId, smsId, keepId]]);
      if (recorded.rows.length !== 2 || !recorded.rows.every((r: { was_active: number }) => r.was_active === 1)) wrong.push(`retirement rows: ${JSON.stringify(recorded.rows)}`);
    }

    // 2. the health check lists them
    const healthModule = await import('../../services/events/retiredRuleActionHealth.js').catch(() => null);
    if (!healthModule) {
      wrong.push('no health check for rules of removed action types');
    } else {
      const health = healthModule.buildRetiredRuleActionHealthTest(await healthModule.findRetiredActionRules());
      const listed = new Set((health.items ?? []).map(i => Number(i.id)));
      if (health.status !== 'warning' || !listed.has(wfId) || !listed.has(smsId) || listed.has(keepId)) wrong.push(`health: ${health.status}, items ${[...listed].join(',')}`);
    }

    // 3. a rule of a removed type is never created or activated; it stays editable while inactive
    const create = await send('post', '/api/events/action-rules', { name: `${tag} new sms`, eventType: 'InvoiceApproved', actionType: 'sms_simulation', actionConfigJson: { messageTemplate: 'x' } });
    const createdRows = await orm.select({ id: eventActionRules.id }).from(eventActionRules).where(eq(eventActionRules.name, `${tag} new sms`));
    ruleIds.push(...createdRows.map(r => r.id));
    if (create.status !== 422 || create.body?.code !== 'RULE_ACTION_TYPE_RETIRED' || createdRows.length > 0) wrong.push(`create sms rule: ${create.status} ${create.body?.code}, rows ${createdRows.length}`);
    const toggle = await send('post', `/api/events/action-rules/${wfId}/toggle`, { active: true });
    if (toggle.status !== 422 || toggle.body?.code !== 'RULE_ACTION_TYPE_RETIRED') wrong.push(`toggle on: ${toggle.status} ${toggle.body?.code}`);
    const activate = await send('put', `/api/events/action-rules/${wfId}`, { isActive: 1 });
    if (activate.status !== 422) wrong.push(`PUT isActive 1: ${activate.status}`);
    const rename = await send('put', `/api/events/action-rules/${wfId}`, { name: `${tag} renamed` });
    if (rename.status !== 200) wrong.push(`rename inactive retired rule: ${rename.status} ${rename.body?.message}`);
    const convert = await send('put', `/api/events/action-rules/${wfId}`, { actionType: 'audit_log', actionConfigJson: { descriptionTemplate: 'converted' }, isActive: 1 });
    if (convert.status !== 200 || convert.body?.data?.isActive !== 1 || convert.body?.data?.actionType !== 'audit_log') wrong.push(`convert to audit_log: ${convert.status} ${JSON.stringify(convert.body?.data ?? convert.body?.message)}`);
    const [converted] = await orm.select({ isActive: eventActionRules.isActive }).from(eventActionRules).where(eq(eventActionRules.id, wfId));
    if (converted?.isActive !== 1) wrong.push('converted rule is not active');

    // 4. the draft evaluation refuses an invalid draft and evaluates a valid one without any effect
    const draft = (rule: object) => send('post', '/api/events/action-rules/test-draft', { rule });
    const invalid = await draft({ name: 'bad', eventType: 'NoSuchEvent', actionType: 'audit_log', conditionsJson: [{ field: 'payload.totalAmount', operator: 'bogus_op', value: 1 }], actionConfigJson: { descriptionTemplate: 'x' } });
    const invalidText = JSON.stringify(invalid.body?.details ?? {});
    if (invalid.status !== 422 || invalid.body?.code !== 'RULE_DRAFT_INVALID' || !invalidText.includes('NoSuchEvent') || !invalidText.includes('bogus_op')) wrong.push(`invalid draft: ${invalid.status} ${invalid.body?.code} ${invalidText.slice(0, 200)}`);
    const noUrl = await draft({ name: 'hook', eventType: 'InvoiceApproved', actionType: 'webhook', conditionsJson: [], actionConfigJson: { url: '' } });
    if (noUrl.status !== 422) wrong.push(`webhook draft without url: ${noUrl.status}`);
    const retiredDraft = await draft({ name: 'wf', eventType: 'InvoiceApproved', actionType: 'workflow_trigger', conditionsJson: [], actionConfigJson: {} });
    if (retiredDraft.status !== 422) wrong.push(`retired type draft: ${retiredDraft.status}`);

    const category = `${tag}_category`;
    const matching = await draft({ name: 'audit', eventType: 'InvoiceApproved', actionType: 'audit_log', conditionsJson: [{ field: 'payload.totalAmount', operator: 'gt', value: 0 }], actionConfigJson: { category, descriptionTemplate: 'Invoice {{payload.refNumber}}' } });
    if (matching.status !== 200 || matching.body?.conditionMatches !== true || !String(matching.body?.preview?.description ?? '').includes('INV-1405-TEST')) wrong.push(`matching draft: ${matching.status} ${JSON.stringify(matching.body).slice(0, 200)}`);
    const notMatching = await draft({ name: 'audit', eventType: 'InvoiceApproved', actionType: 'audit_log', conditionsJson: [{ field: 'payload.totalAmount', operator: 'gt', value: 999999999999 }], actionConfigJson: { category, descriptionTemplate: 'x' } });
    if (notMatching.status !== 200 || notMatching.body?.conditionMatches !== false) wrong.push(`not matching draft: ${notMatching.status} ${notMatching.body?.conditionMatches}`);
    const title = `${tag} notification`;
    const notify = await draft({ name: 'notify', eventType: 'InvoiceApproved', actionType: 'in_app_notification', conditionsJson: [], actionConfigJson: { titleTemplate: title, messageTemplate: 'm' } });
    if (notify.status !== 200 || !(Number(notify.body?.preview?.recipientCount) >= 1)) wrong.push(`notification draft: ${notify.status} ${JSON.stringify(notify.body?.preview)}`);
    const audits = await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entity, category));
    const notes = await orm.select({ id: notifications.id }).from(notifications).where(like(notifications.title, `${tag}%`));
    if (audits.length > 0 || notes.length > 0) wrong.push(`draft evaluation wrote ${audits.length} audit row(s) and ${notes.length} notification(s)`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'migration deactivated and recorded 2 legacy rules (rerun idempotent); health lists them; create / toggle / activate refused 422, rename and conversion allowed; invalid drafts 422, valid drafts evaluated with no audit row or notification',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (ruleIds.length > 0) {
      await pool.query('DELETE FROM event_action_rule_retirements WHERE rule_id = ANY($1::int[])', [ruleIds]).catch(() => undefined);
      await orm.delete(eventActionRules).where(inArray(eventActionRules.id, ruleIds)).catch(() => undefined);
    }
  }
  return results;
}
