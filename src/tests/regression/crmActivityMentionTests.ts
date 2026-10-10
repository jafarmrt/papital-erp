import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, notifications, roles, users } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Package 9 (customers and CRM), TD-976: a CRM activity mentions live users by id only, notifies only mentioned users
 * who may read CRM activities, and never matches «@name» inside the description by substring. Red on v10.0.33.
 */
export async function runCrmActivityMentionTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_activity_mentions_td_976';
  if (!shouldRun(id, 'td976', 'crm', 'mention', 'package9')) return results;

  const name = 'v10.0.34: a CRM activity mention is a live user id (unknown id 422, nothing saved), the description is never scanned for «@name», and only mentioned users who may read CRM activities are notified (TD-976)';
  const tStart = Date.now();
  const tag = `TD976-${String(Date.now()).slice(-6)}`;
  const roleIds: number[] = [];
  const userIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (body: Record<string, unknown>) => request(app).post('/api/crm/activities')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ type: 'call', ...body });
    const wrong: string[] = [];

    const crmRole = await createTestRole({ permissions: ['crm.view'] });
    const otherRole = await createTestRole({ permissions: ['daily_logs.view'] });
    roleIds.push(crmRole.id, otherRole.id);
    const short = await createTestUser({ role: crmRole.code, fullName: `مهسا ${tag}` });
    const long = await createTestUser({ role: crmRole.code, fullName: `مهسا ${tag} کریمی` });
    const outsider = await createTestUser({ role: otherRole.code, fullName: `بیرونی ${tag}` });
    userIds.push(short.id, long.id, outsider.id);
    const mentionsOf = async (userId: number) => (await orm.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, 'mention')))).length;

    // 1) an unknown user id refuses the activity and writes nothing
    const unknown = await post({ title: `${tag} unknown`, mentions: [2147480000] });
    if (unknown.status !== 422 || unknown.body?.code !== 'CRM_MENTION_USER_NOT_FOUND') wrong.push(`unknown mention answered ${unknown.status} ${unknown.body?.code}`);
    const saved = await orm.select({ id: crmActivities.id }).from(crmActivities).where(like(crmActivities.title, containsLikePattern(`${tag} unknown`)));
    if (saved.length !== 0) wrong.push(`${saved.length} activity rows written for a refused mention`);

    // 2) «@مهسا … کریمی» in the text with only the long name's id: the short name is not notified by substring
    const both = await post({ title: `${tag} names`, description: `@مهسا ${tag} کریمی لطفاً پیگیری کنید`, mentions: [long.id] });
    if (both.status !== 201) wrong.push(`activity with a mention answered ${both.status} ${JSON.stringify(both.body).slice(0, 160)}`);
    if (await mentionsOf(long.id) !== 1) wrong.push(`the mentioned user got ${await mentionsOf(long.id)} notifications, not 1`);
    if (await mentionsOf(short.id) !== 0) wrong.push('the user whose name is a prefix of the mentioned name was notified');

    // 3) a mentioned user without a CRM read key is stored on the activity but gets no notification
    const hidden = await post({ title: `${tag} outsider`, mentions: [outsider.id] });
    if (hidden.status !== 201) wrong.push(`activity mentioning an outsider answered ${hidden.status}`);
    if (await mentionsOf(outsider.id) !== 0) wrong.push('a user who cannot read CRM activities was notified');
    if (JSON.stringify(hidden.body?.mentions) !== JSON.stringify([outsider.id])) wrong.push(`stored mentions ${JSON.stringify(hidden.body?.mentions)}`);

    // 4) a text mention is refused as input (only ids)
    const text = await post({ title: `${tag} text`, mentions: ['@someone'] });
    if (text.status !== 400) wrong.push(`a text mention answered ${text.status}, not 400`);

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Unknown id 422 with no row; only the mentioned id notified, not the prefix name; outsider stored but not notified; text mention 400',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(crmActivities).where(like(crmActivities.title, containsLikePattern(tag))).catch(() => undefined);
    if (userIds.length > 0) {
      await orm.delete(notifications).where(inArray(notifications.userId, userIds)).catch(() => undefined);
      await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    }
    if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
