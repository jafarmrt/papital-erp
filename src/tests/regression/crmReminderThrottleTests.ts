import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, notifications, users } from '../../db/schema.js';

/**
 * v10.1.62 (OBS-R2-85, decision ت۴۰ item 12): the bell and its counter read the user's due follow-ups at most once an hour
 * per user. On v10.1.62 every bell and counter request (every 30 seconds per open tab) scanned them, so a follow-up that
 * fell due was reminded on the very next request.
 */
export async function runCrmReminderThrottleTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_due_reminder_hourly_obs_r2_85';
  if (!shouldRun(id, 'obs-r2-85', 'notifications', 'crm', 'reminder', 'throttle')) return results;

  const name = 'v10.1.62: the follow-up reminder scan of the bell runs at most once an hour per user, and again once the hour has passed (OBS-R2-85)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const leadIds: number[] = [];
  try {
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const reminders = await import('../../services/notifications/crmDueReminders.js');
    const today = await businessTodayIsoDate();
    const yesterday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const owner = await h.sessionWith(['crm.view']);
    const ownerName = `OBS-R2-85 owner ${h.tag}`;
    await orm.update(users).set({ fullName: ownerName }).where(eq(users.id, owner.userId));
    const [lead] = await orm.insert(crmLeads).values({ title: `R2-85 lead ${h.tag}`, customerName: `R2-85 buyer ${h.tag}` }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const followup = async (label: string) => (await orm.insert(crmActivities).values({
      leadId: lead.id, type: 'call', title: `R2-85 ${label} ${h.tag}`, loggedBy: 'r2-85', assignedTo: ownerName,
      activityDate: yesterday, activityDateIso: yesterday, nextFollowUpDate: yesterday, nextFollowUpDateIso: yesterday, nextFollowUpTask: label,
    }).returning({ id: crmActivities.id }))[0].id;
    const remindedCount = async () => (await orm.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, owner.userId), eq(notifications.type, 'crm_due_task')))).length;
    const wrong: string[] = [];

    await followup('first');
    await h.get('/api/notifications/unread-count', owner);
    if (await remindedCount() !== 1) wrong.push(`the first bell request made ${await remindedCount()} reminders, expected 1`);

    await followup('second');
    await h.get('/api/notifications', owner);
    await h.get('/api/notifications/unread-count', owner);
    if (await remindedCount() !== 1) wrong.push(`bell requests within the hour scanned again (${await remindedCount()} reminders)`);

    const made = await reminders.generateCrmDueRemindersThrottled(owner.userId, Date.now() + 60 * 60 * 1000 + 1000);
    if (made !== 0 || await remindedCount() !== 2) wrong.push(`after the hour the scan did not remind the second follow-up (${await remindedCount()} reminders)`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'one scan per hour: the second due follow-up waited for the next hour',
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
