import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmLeads, roles, users } from '../../db/schema.js';

/**
 * Package 9, OBS-R2-29 (TD-991): a sales lead's detail (`GET /crm/leads/:id`) opens for the same keys as the lead list
 * (`crm.view`, `customers.view`, `customers.manage`); it asked `crm.view` only, so a customers reader saw the lead in the
 * list and got 403 on its drawer. Red on v10.0.31.
 */
export async function runCrmLeadDetailReadTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_lead_detail_read_keys_obs_r2_29';
  if (!shouldRun(id, 'obs_r2_29', 'td991', 'crm', 'lead', 'package9')) return results;

  const name = 'v10.0.32: a sales lead detail opens for every key the lead list accepts (customers.view reads both), and a user with none of them gets 403 on both (OBS-R2-29)';
  const tStart = Date.now();
  const tag = `R229-${String(Date.now()).slice(-6)}`;
  const roleIds: number[] = [];
  const userIds: number[] = [];
  let leadId: number | undefined;
  try {
    const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const wrong: string[] = [];
    const [lead] = await orm.insert(crmLeads).values({ title: `${tag} lead`, customerName: `${tag} buyer`, stage: 'lead', status: 'active' }).returning({ id: crmLeads.id });
    leadId = lead.id;

    for (const [permissions, expected] of [[['customers.view'], 200], [['customers.manage', 'customers.view'], 200], [['crm.view'], 200], [['products.view'], 403]] as const) {
      const role = await createTestRole({ permissions: [...permissions] });
      roleIds.push(role.id);
      const user = await createTestUser({ role: role.code });
      userIds.push(user.id);
      const session = await loginTestUserWithSession(app, user.username);
      const list = await request(app).get('/api/crm/leads').set('Cookie', session.cookie);
      const detail = await request(app).get(`/api/crm/leads/${lead.id}`).set('Cookie', session.cookie);
      if (list.status !== expected) wrong.push(`${permissions.join('+')}: list answered ${list.status}, not ${expected}`);
      if (detail.status !== expected) wrong.push(`${permissions.join('+')}: detail answered ${detail.status}, not ${expected}`);
      if (expected === 200 && !Array.isArray(detail.body?.activities)) wrong.push(`${permissions.join('+')}: detail has no activities list`);
    }

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'List and detail agree for customers.view, customers.manage, crm.view (200) and an unrelated key (403)',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadId) await orm.update(crmLeads).set({ isDeleted: 1 }).where(eq(crmLeads.id, leadId)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
