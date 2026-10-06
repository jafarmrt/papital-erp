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

  const name = 'v9.0.19: «انجام» و «بازگشایی» پیگیری عمل صریح با وضعیت هدف‌اند؛ تکرار یا ارسال هم‌زمان پیگیری را دوباره باز نمی‌کند و نتیجه را دوباره نمی‌افزاید؛ هر تغییر یک لاگ ممیزی دارد (TD-430)';
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
      wrong.push(`انجام تکراری: ${first.status}/${repeat.status}، وضعیت ${s.done}، نتیجه ${notes} بار`);
    }
    if (repeat.body?.changed !== false) wrong.push('پاسخ «انجام» تکراری changed=false ندارد');
    if (await auditCount() !== 1) wrong.push(`پس از دو «انجام» ${await auditCount()} لاگ ممیزی هست، نه ۱`);

    // ۲) «بازگشایی» هم‌زمان دوبار: باز می‌ماند و یک لاگ دیگر
    const reopened = await Promise.all([put(reopen), put(reopen)]);
    s = await state();
    if (reopened.some(r => r.status !== 200) || s.done !== 0) wrong.push(`بازگشایی هم‌زمان: ${reopened.map(r => r.status).join('/')}، وضعیت ${s.done}`);
    if (await auditCount() !== 2) wrong.push(`پس از بازگشایی ${await auditCount()} لاگ ممیزی هست، نه ۲`);

    // ۳) «انجام» هم‌زمان دوبار: انجام می‌ماند، نه برگشت به باز
    await Promise.all([put(complete), put(complete)]);
    s = await state();
    if (s.done !== 1 || await auditCount() !== 3) wrong.push(`انجام هم‌زمان: وضعیت ${s.done}، ${await auditCount()} لاگ`);

    // ۴) کلید دوطرفه دیگر نیست؛ اقدام ناموجود ۴۰۴
    const legacy = await put(`/api/crm/activities/${act.id}/toggle-followup`);
    if (legacy.status !== 404) wrong.push(`toggle-followup هنوز پاسخ ${legacy.status} می‌دهد`);
    const missing = await put(`/api/crm/activities/${act.id + 1_000_000}/complete-followup`);
    if (missing.status !== 404) wrong.push(`اقدام ناموجود ${missing.status} داد`);

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'دو «انجام» یک تغییر و یک لاگ؛ بازگشایی و انجام هم‌زمان هرکدام یک تغییر؛ toggle-followup حذف شد',
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
