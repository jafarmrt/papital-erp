import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, notifications, users } from '../../db/schema.js';

/**
 * v9.0.414 (TD-717, B15-15, decision t8 a): dismissing a notification keeps its row (dismissed_at) and hides it from the
 * bell and its counter, a dismissed due reminder never comes back, and concurrent bell requests make one reminder
 * (unique index uq_notifications_due_reminder, insert ON CONFLICT DO NOTHING). On v9.0.413 the delete removed the row and
 * the next bell request made the reminder again, and four concurrent requests could make two.
 */
export async function runNotificationDismissTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_notification_dismiss_and_unique_reminder_td_717';
  if (!shouldRun(id, 'td717', 'notifications', 'reminder', 'package15')) return results;

  const name = 'v9.0.414: a dismissed notification is kept but not listed or counted, a dismissed due reminder never comes back, and concurrent bell requests make one reminder (TD-717)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const leadIds: number[] = [];
  try {
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { buildDueReminderHealthTest, findDuplicateDueReminders, hasDueReminderUniqueIndex } = await import('../../services/notifications/notificationReminderHealth.js');
    const today = await businessTodayIsoDate();
    const yesterday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const owner = await h.sessionWith(['crm.view']);
    const other = await h.sessionWith(['crm.view']);
    const ownerName = `TD717 owner ${h.tag}`;
    await orm.update(users).set({ fullName: ownerName }).where(eq(users.id, owner.userId));
    const [lead] = await orm.insert(crmLeads).values({ title: `TD717 lead ${h.tag}`, customerName: `TD717 buyer ${h.tag}` }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const [act] = await orm.insert(crmActivities).values({
      leadId: lead.id, type: 'call', title: `TD717 followup ${h.tag}`, loggedBy: 'td717', assignedTo: ownerName,
      activityDate: yesterday, activityDateIso: yesterday, nextFollowUpDate: yesterday, nextFollowUpDateIso: yesterday, nextFollowUpTask: 'TD717 call',
    }).returning({ id: crmActivities.id });
    const link = `/crm?activityId=${act.id}`;
    const reminderRows = () => orm.select({ id: notifications.id, dismissedAt: notifications.dismissedAt }).from(notifications)
      .where(and(eq(notifications.userId, owner.userId), eq(notifications.type, 'crm_due_task'), eq(notifications.link, link)));
    const listed = async () => {
      const res = await h.get('/api/notifications', owner);
      return Array.isArray(res.body) ? (res.body as Array<{ id: number }>) : [];
    };
    const unread = async () => Number((await h.get('/api/notifications/unread-count', owner)).body?.count);
    const wrong: string[] = [];

    // 1) the bell and its counter ask together: one reminder
    await Promise.all([
      h.get('/api/notifications', owner), h.get('/api/notifications/unread-count', owner),
      h.get('/api/notifications', owner), h.get('/api/notifications/unread-count', owner),
    ]);
    const made = await reminderRows();
    if (made.length !== 1) wrong.push(`four concurrent bell requests made ${made.length} reminders, expected 1`);
    const reminderId = made[0]?.id;
    if (reminderId === undefined) throw new Error(`no reminder was made: ${wrong.join('; ')}`);
    if (!(await listed()).some(n => n.id === reminderId)) wrong.push('the reminder is not listed before dismissal');
    const unreadBefore = await unread();

    // 2) another user cannot dismiss it
    await h.del(`/api/notifications/${reminderId}`, other);
    const [afterOther] = await reminderRows();
    if (!afterOther || afterOther.dismissedAt !== null) wrong.push('another user dismissed or removed the reminder');

    // 3) the owner dismisses it: the row stays with dismissed_at, it is neither listed nor counted
    const dismissed = await h.del(`/api/notifications/${reminderId}`, owner);
    if (dismissed.status !== 200) wrong.push(`dismissing answered ${dismissed.status}`);
    const kept = await reminderRows();
    if (kept.length !== 1 || kept[0]?.dismissedAt === null || kept[0]?.dismissedAt === undefined) {
      wrong.push(`after dismissal the reminder rows are ${JSON.stringify(kept)}, expected one row with dismissed_at`);
    }
    if ((await listed()).some(n => n.id === reminderId)) wrong.push('the dismissed reminder is still listed');
    const unreadAfter = await unread();
    if (unreadAfter !== unreadBefore - 1) wrong.push(`unread count after dismissal is ${unreadAfter}, expected ${unreadBefore - 1}`);

    // 4) the next bell requests do not bring it back
    await Promise.all([h.get('/api/notifications', owner), h.get('/api/notifications/unread-count', owner)]);
    const again = await reminderRows();
    if (again.length !== 1) wrong.push(`after dismissal the bell made the reminder again (${again.length} rows)`);

    // 5) the unique index exists and the health check lists no duplicate of this user
    if (!(await hasDueReminderUniqueIndex())) wrong.push('uq_notifications_due_reminder is missing');
    const duplicates = (await findDuplicateDueReminders()).filter(r => r.userId === owner.userId);
    if (duplicates.length > 0) wrong.push(`the health check lists ${duplicates.length} duplicate reminders of this user`);
    const health = buildDueReminderHealthTest([{ userId: owner.userId, userName: ownerName, link, count: 2 }], false);
    if (health.id !== 'notification_reminder_uniqueness' || health.status !== 'warning' || health.count !== 1) {
      wrong.push(`the health test for a legacy duplicate is ${JSON.stringify({ id: health.id, status: health.status, count: health.count })}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'one reminder from concurrent requests; dismissal kept the row, hid it and it never came back',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) {
      const acts = await orm.select({ id: crmActivities.id }).from(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => []);
      if (acts.length > 0) await orm.delete(notifications).where(inArray(notifications.link, acts.map(a => `/crm?activityId=${a.id}`))).catch(() => undefined);
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    await h.cleanup();
  }
  return results;
}
