import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, personnel } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — فهرست پیگیری‌های باز در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

interface FollowupRow { id: number; title: string }
interface FollowupBody { data?: FollowupRow[]; total?: number; totalPages?: number; dueCount?: number; openCount?: number }

export async function runCrmFollowupsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_open_followups_no_activity_range_td_428';
  if (!shouldRun(id, 'td428', 'crm', 'followup', 'package9')) return results;

  const name = 'v9.0.14: پیگیری‌های باز بی بازه تاریخ اقدام و با صفحه‌بندی از سرور می‌آیند؛ پیگیری معوقِ اقدام ۴۰ روز پیش در فهرست «امروز و معوق» هست و شمار آن با کارت آمار یکی است (TD-428)';
  const tStart = Date.now();
  const activityIds: number[] = [];
  const personnelIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const get = async (path: string) => {
      const res = await request(app).get(path).set('Cookie', admin.cookie);
      return { status: res.status, body: res.body as FollowupBody & Record<string, unknown> };
    };
    const today = await businessTodayIsoDate();
    const shift = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const tag = `TD428-${String(Date.now()).slice(-6)}`;
    const [person] = await orm.insert(personnel).values({ fullName: `فروشنده ${tag}` }).returning({ id: personnel.id });
    personnelIds.push(person.id);

    const act = async (title: string, fields: Partial<typeof crmActivities.$inferInsert>) => {
      const [row] = await orm.insert(crmActivities).values({
        type: 'call', title: `${title} ${tag}`, loggedBy: 'td428', activityDate: shift(-40), activityDateIso: shift(-40), ...fields,
      }).returning({ id: crmActivities.id });
      activityIds.push(row.id);
      return row.id;
    };
    const oldOverdue = await act('پیگیری معوق اقدام قدیمی', { nextFollowUpDate: shift(-5), nextFollowUpDateIso: shift(-5), assignedPersonnelId: person.id });
    const legacyAssignee = await act('پیگیری مسئول متنی', { nextFollowUpDate: shift(-1), nextFollowUpDateIso: shift(-1), assignedTo: `فروشنده ${tag}` });
    const future = await act('پیگیری آینده', { nextFollowUpDate: shift(10), nextFollowUpDateIso: shift(10), activityDate: today, activityDateIso: today });
    const done = await act('پیگیری انجام‌شده', { nextFollowUpDate: shift(-3), nextFollowUpDateIso: shift(-3), isFollowUpCompleted: 1 });
    const removed = await act('پیگیری حذف‌شده', { nextFollowUpDate: shift(-2), nextFollowUpDateIso: shift(-2), isDeleted: 1 });
    await act('اقدام بی پیگیری', {});

    const wrong: string[] = [];
    const idsOf = (body: FollowupBody) => (Array.isArray(body.data) ? body.data.map(r => r.id) : []);
    const search = `search=${encodeURIComponent(tag)}`;

    const due = await get(`/api/crm/followups?status=pending&due=due&${search}`);
    if (due.status !== 200) throw new Error(`/api/crm/followups پاسخ ${due.status} داد (مسیر پیگیری‌های باز نیست)`);
    if (JSON.stringify(idsOf(due.body)) !== JSON.stringify([oldOverdue, legacyAssignee])) {
      wrong.push(`«امروز و معوق» ${JSON.stringify(idsOf(due.body))} آمد، نه [${oldOverdue}, ${legacyAssignee}] به ترتیب سررسید`);
    }
    const open = await get(`/api/crm/followups?${search}`);
    if (JSON.stringify(idsOf(open.body)) !== JSON.stringify([oldOverdue, legacyAssignee, future])) wrong.push(`پیگیری‌های باز ${JSON.stringify(idsOf(open.body))} آمد`);
    const completed = await get(`/api/crm/followups?status=completed&${search}`);
    if (JSON.stringify(idsOf(completed.body)) !== JSON.stringify([done])) wrong.push(`پیگیری‌های انجام‌شده ${JSON.stringify(idsOf(completed.body))} آمد`);
    if ([...idsOf(open.body), ...idsOf(completed.body)].includes(removed)) wrong.push('پیگیری حذف‌شده در فهرست آمد');

    const byAssignee = await get(`/api/crm/followups?assignedPersonnelId=${person.id}&${search}`);
    if (JSON.stringify(idsOf(byAssignee.body)) !== JSON.stringify([oldOverdue, legacyAssignee])) wrong.push(`فیلتر مسئول ${JSON.stringify(idsOf(byAssignee.body))} داد`);

    const page1 = await get(`/api/crm/followups?${search}&limit=2&page=1`);
    const page2 = await get(`/api/crm/followups?${search}&limit=2&page=2`);
    if (page1.body.total !== 3 || page1.body.totalPages !== 2 || JSON.stringify([...idsOf(page1.body), ...idsOf(page2.body)]) !== JSON.stringify([oldOverdue, legacyAssignee, future])) {
      wrong.push(`صفحه‌بندی: total=${page1.body.total}، صفحه‌ها=${page1.body.totalPages}، ردیف‌ها ${JSON.stringify([idsOf(page1.body), idsOf(page2.body)])}`);
    }

    // فهرست پیش‌فرض صفحه (بازه ۳۰ روزه اقدام) آن را نداشت؛ شمار سرور با کارت آمار یکی است
    const stats = await get('/api/crm/stats');
    if (due.body.dueCount !== stats.body.pendingFollowupsCount) wrong.push(`dueCount=${due.body.dueCount} با کارت آمار ${String(stats.body.pendingFollowupsCount)} یکی نیست`);
    if (open.body.openCount !== stats.body.openFollowupsCount) wrong.push(`openCount=${open.body.openCount} با شمار زبانه ${String(stats.body.openFollowupsCount)} یکی نیست`);

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'پیگیری معوق اقدام ۴۰ روز پیش در «امروز و معوق»؛ وضعیت، مسئول (شناسه و نام قدیمی)، جست‌وجو و صفحه‌بندی در سرور؛ شمارها با کارت آمار یکی',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (activityIds.length > 0) await orm.delete(crmActivities).where(inArray(crmActivities.id, activityIds)).catch(() => undefined);
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
  }
  return results;
}
