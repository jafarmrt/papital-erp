import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, crmActivities, crmLeads, notifications } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — حذف پرونده فروش در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

interface StatsBody { pendingFollowupsCount?: number; openFollowupsCount?: number }

export async function runCrmLeadDeleteTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_lead_delete_guards_td_425';
  if (!shouldRun(id, 'td425', 'crm', 'lead', 'delete', 'package9')) return results;

  const name = 'v9.0.16: deleting a missing sales lead is 404 with no delete audit row; a lead with an active proforma is not deleted; follow-ups of a deleted lead leave the stats, lists and due reminder (TD-425)';
  const tStart = Date.now();
  const leadIds: number[] = [];
  const activityIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (req: request.Test) => req.set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const today = await businessTodayIsoDate();
    const yesterday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const tag = `TD425-${String(Date.now()).slice(-6)}`;
    const wrong: string[] = [];

    // ۱) شناسه ناموجود: ۴۰۴ و بی لاگ ممیزی «حذف»
    const [maxRow] = await orm.select({ n: sql<string>`COALESCE(MAX(${crmLeads.id}), 0)::text` }).from(crmLeads);
    const missingId = Number(maxRow?.n ?? 0) + 1_000_000;
    const missing = await send(request(app).delete(`/api/crm/leads/${missingId}`));
    if (missing.status !== 404) wrong.push(`deleting a missing sales file returned ${missing.status}, not 404`);
    const missingLogs = await orm.select({ id: activityLogs.id }).from(activityLogs)
      .where(and(eq(activityLogs.action, 'DELETE'), eq(activityLogs.entityId, String(missingId))));
    if (missingLogs.length > 0) wrong.push(`deleting a missing sales file created ${missingLogs.length} "delete" log rows`);

    // ۲) پرونده با پیگیری معوق (مسئول همین کاربر): حذف آن را از آمار، فهرست‌ها و یادآور بیرون می‌برد
    const [lead] = await orm.insert(crmLeads).values({ title: `پرونده حذفی ${tag}`, customerName: `خریدار ${tag}` }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const [act] = await orm.insert(crmActivities).values({
      leadId: lead.id, type: 'call', title: `پیگیری پرونده حذفی ${tag}`, loggedBy: 'td425', assignedTo: 'pen_admin',
      activityDate: yesterday, activityDateIso: yesterday, nextFollowUpDate: yesterday, nextFollowUpDateIso: yesterday, nextFollowUpTask: `تماس ${tag}`,
    }).returning({ id: crmActivities.id });
    activityIds.push(act.id);
    const stats = async () => (await send(request(app).get('/api/crm/stats'))).body as StatsBody;
    const before = await stats();
    const removed = await send(request(app).delete(`/api/crm/leads/${lead.id}`));
    if (removed.status !== 200) wrong.push(`deleting the sales file returned ${removed.status}`);
    const after = await stats();
    if (after.pendingFollowupsCount !== Number(before.pendingFollowupsCount) - 1) {
      wrong.push(`due follow-up count after the delete is ${String(after.pendingFollowupsCount)}, not ${Number(before.pendingFollowupsCount) - 1}`);
    }
    if (after.openFollowupsCount !== Number(before.openFollowupsCount) - 1) wrong.push(`open follow-up count after the delete is ${String(after.openFollowupsCount)}`);
    const followups = await send(request(app).get(`/api/crm/followups?search=${encodeURIComponent(tag)}`));
    const listed = Array.isArray(followups.body?.data) ? followups.body.data as Array<{ id: number }> : [];
    if (listed.some(r => r.id === act.id)) wrong.push('the follow-up of the deleted sales file stayed in the follow-up list');
    const activities = await send(request(app).get(`/api/crm/activities?pendingFollowupsOnly=true&limit=500`));
    if (Array.isArray(activities.body) && (activities.body as Array<{ id: number }>).some(r => r.id === act.id)) wrong.push('the follow-up of the deleted sales file stayed in "pending follow-ups"');
    await send(request(app).get('/api/notifications'));
    const reminders = await orm.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.link, `/crm?activityId=${act.id}`), eq(notifications.type, 'crm_due_task')));
    if (reminders.length > 0) wrong.push('the due reminder created a notification for the follow-up of the deleted sales file');

    // ۳) پرونده دارای پیش‌فاکتور فعال: ۴۰۹ و پرونده می‌ماند؛ پس از ابطال پیش‌فاکتور حذف می‌شود
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 1_000_000 });
    const [withProforma] = await orm.insert(crmLeads).values({ title: `پرونده با پیش‌فاکتور ${tag}`, customerName: `خریدار ${tag}`, stage: 'qualified' }).returning({ id: crmLeads.id });
    leadIds.push(withProforma.id);
    const proforma = await send(request(app).post('/api/documents')).send({
      docType: 'invoice', status: 'proforma', inOut: 'out', refNumber: 'auto', date: today, buyer_name: `خریدار ${tag}`,
      items: [{ itemId: item.id, quantity: 1, unit_price: 3_000_000, location: wh }], crmLeadId: withProforma.id,
    });
    const proformaId = Number(proforma.body?.id ?? proforma.body?.docId);
    if (proforma.status !== 201 && proforma.status !== 200) throw new Error(`issuing the proforma returned ${proforma.status}`);
    const refused = await send(request(app).delete(`/api/crm/leads/${withProforma.id}`));
    const [kept] = await orm.select({ isDeleted: crmLeads.isDeleted }).from(crmLeads).where(eq(crmLeads.id, withProforma.id));
    if (refused.status !== 409 || kept.isDeleted !== 0) wrong.push(`حذف پرونده دارای پیش‌فاکتور فعال ${refused.status} داد و پرونده ${kept.isDeleted === 1 ? 'حذف شد' : 'ماند'}`);
    await send(request(app).delete(`/api/documents/${proformaId}`));
    const allowed = await send(request(app).delete(`/api/crm/leads/${withProforma.id}`));
    if (allowed.status !== 200) wrong.push(`deleting the sales file after voiding the proforma returned ${allowed.status}`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'missing file 404 with no log; the follow-up of the deleted file left the statistics, lists and reminder; an active proforma refused the delete with 409',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (activityIds.length > 0) {
      await orm.delete(notifications).where(inArray(notifications.link, activityIds.map(a => `/crm?activityId=${a}`))).catch(() => undefined);
    }
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
  }
  return results;
}
