import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, crmActivities } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — «انجام» و «بازگشایی» پیگیری در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCrmFollowupActionTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_followup_explicit_actions_td_430';
  if (!shouldRun(id, 'td430', 'crm', 'followup', 'package9')) return results;

  const name = 'v9.0.19: completing and reopening a follow-up are explicit actions with a target state; a repeat or concurrent request does not reopen it or add the result again; each change has one audit row (TD-430)';
  const tStart = Date.now();
  const activityIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const put = (path: string, body: Record<string, unknown> = {}) => request(app).put(path)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const today = await businessTodayIsoDate();
    const tag = `TD430-${String(Date.now()).slice(-6)}`;
    const wrong: string[] = [];

    const [act] = await orm.insert(crmActivities).values({
      type: 'call', title: `پیگیری ${tag}`, loggedBy: 'td430', activityDate: today, activityDateIso: today,
      nextFollowUpDate: today, nextFollowUpDateIso: today, nextFollowUpTask: `تماس ${tag}`, description: 'شرح',
    }).returning({ id: crmActivities.id });
    activityIds.push(act.id);
    const state = async () => (await orm.select({ done: crmActivities.isFollowUpCompleted, description: crmActivities.description, result: crmActivities.result })
      .from(crmActivities).where(eq(crmActivities.id, act.id)))[0];
    const auditCount = async () => (await orm.select({ id: activityLogs.id }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'اقدام و تماس CRM'), eq(activityLogs.entityId, String(act.id)), eq(activityLogs.action, 'UPDATE')))).length;
    const complete = `/api/crm/activities/${act.id}/complete-followup`;
    const reopen = `/api/crm/activities/${act.id}/reopen-followup`;

    // ۱) «انجام» دوبار پشت‌سرهم: انجام می‌ماند، نتیجه یک بار افزوده می‌شود، یک لاگ
    const first = await put(complete, { result: 'توافق شد', resultNote: `نتیجه ${tag}` });
    const repeat = await put(complete, { result: 'توافق شد', resultNote: `نتیجه ${tag}` });
    let s = await state();
    const notes = (s.description?.match(new RegExp(`نتیجه ${tag}`, 'g')) ?? []).length;
    if (first.status !== 200 || repeat.status !== 200 || s.done !== 1 || notes !== 1 || s.result !== 'توافق شد') {
      wrong.push(`repeated complete: ${first.status}/${repeat.status}, status ${s.done}, result ${notes} times`);
    }
    if (repeat.body?.changed !== false) wrong.push('the repeated "complete" response does not have changed=false');
    if (await auditCount() !== 1) wrong.push(`after two "complete" actions there are ${await auditCount()} audit log rows, not 1`);

    // ۲) «بازگشایی» هم‌زمان دوبار: باز می‌ماند و یک لاگ دیگر
    const reopened = await Promise.all([put(reopen), put(reopen)]);
    s = await state();
    if (reopened.some(r => r.status !== 200) || s.done !== 0) wrong.push(`concurrent reopen: ${reopened.map(r => r.status).join('/')}, status ${s.done}`);
    if (await auditCount() !== 2) wrong.push(`after reopen there are ${await auditCount()} audit log rows, not 2`);

    // ۳) «انجام» هم‌زمان دوبار: انجام می‌ماند، نه برگشت به باز
    await Promise.all([put(complete), put(complete)]);
    s = await state();
    if (s.done !== 1 || await auditCount() !== 3) wrong.push(`concurrent complete: status ${s.done}, ${await auditCount()} log rows`);

    // ۴) کلید دوطرفه دیگر نیست؛ اقدام ناموجود ۴۰۴
    const legacy = await put(`/api/crm/activities/${act.id}/toggle-followup`);
    if (legacy.status !== 404) wrong.push(`toggle-followup still responds ${legacy.status}`);
    const missing = await put(`/api/crm/activities/${act.id + 1_000_000}/complete-followup`);
    if (missing.status !== 404) wrong.push(`a missing activity returned ${missing.status}`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'two "complete" actions make one change and one log row; concurrent reopen and complete each make one change; toggle-followup is removed',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const a of activityIds) await orm.delete(crmActivities).where(eq(crmActivities.id, a)).catch(() => undefined);
  }
  return results;
}
