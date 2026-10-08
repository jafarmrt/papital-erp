import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, notifications, personnel, users } from '../../db/schema.js';

/**
 * v9.0.413 (TD-709, B15-07): the notification bell reminds a user only of their own due follow-ups: the assignee's
 * personnel record linked to that user, else (a legacy row without a personnel id) the trimmed assignee or logger name
 * exactly equal to the user's full name or username; never «contains». On v9.0.412 a user named «علی» got the reminder
 * of «علی رضایی»'s follow-up (with its title and customer), the follow-up of the personnel linked to them was missed, and
 * a follow-up of another personnel whose name text held their name reached them.
 */
export async function runCrmDueReminderTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_due_reminder_own_followups_td_709';
  if (!shouldRun(id, 'td709', 'notifications', 'crm', 'reminder', 'package15')) return results;

  const name = 'v9.0.413: the CRM due reminder reaches only the assignee: linked personnel id, else exact trimmed name, never a name that only contains it (TD-709)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const leadIds: number[] = [];
  const personnelIds: number[] = [];
  try {
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const today = await businessTodayIsoDate();
    const yesterday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const shortName = `علی ${h.tag}`;
    const longName = `${shortName} رضایی`;
    const ali = await h.sessionWith(['crm.view']);
    const alireza = await h.sessionWith(['crm.view']);
    await orm.update(users).set({ fullName: shortName }).where(eq(users.id, ali.userId));
    await orm.update(users).set({ fullName: longName }).where(eq(users.id, alireza.userId));
    const [aliPerson] = await orm.insert(personnel).values({ fullName: shortName, userId: ali.userId }).returning({ id: personnel.id });
    const [alirezaPerson] = await orm.insert(personnel).values({ fullName: longName, userId: alireza.userId }).returning({ id: personnel.id });
    personnelIds.push(aliPerson.id, alirezaPerson.id);

    const [lead] = await orm.insert(crmLeads).values({ title: `TD709 lead ${h.tag}`, customerName: `TD709 buyer ${h.tag}` }).returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const followup = async (label: string, fields: Partial<typeof crmActivities.$inferInsert>) => {
      const [row] = await orm.insert(crmActivities).values({
        leadId: lead.id, type: 'call', title: `TD709 ${label} ${h.tag}`, loggedBy: 'td709',
        activityDate: yesterday, activityDateIso: yesterday, nextFollowUpDate: yesterday, nextFollowUpDateIso: yesterday,
        nextFollowUpTask: `TD709 ${label}`, ...fields,
      }).returning({ id: crmActivities.id });
      return row.id;
    };
    const legacyLongName = await followup('legacy long name', { assignedTo: longName });
    const linkedToAli = await followup('linked to ali', { assignedPersonnelId: aliPerson.id, assignedTo: 'free text' });
    const linkedToAlireza = await followup('linked to alireza', { assignedPersonnelId: alirezaPerson.id, assignedTo: shortName });
    const legacyExactPadded = await followup('legacy exact padded', { assignedTo: `  ${shortName}  ` });
    const legacyLogger = await followup('legacy logger', { assignedTo: '', loggedBy: shortName });

    await h.get('/api/notifications', ali);
    await h.get('/api/notifications/unread-count', alireza);
    const remindedOf = async (userId: number) => {
      const rows = await orm.select({ link: notifications.link }).from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.type, 'crm_due_task')));
      const ids = [legacyLongName, linkedToAli, linkedToAlireza, legacyExactPadded, legacyLogger];
      return ids.filter(a => rows.some(r => r.link === `/crm?activityId=${a}`)).sort((x, y) => x - y);
    };
    const expectedAli = [linkedToAli, legacyExactPadded, legacyLogger].sort((x, y) => x - y);
    const expectedAlireza = [legacyLongName, linkedToAlireza].sort((x, y) => x - y);
    const gotAli = await remindedOf(ali.userId);
    const gotAlireza = await remindedOf(alireza.userId);
    const wrong: string[] = [];
    if (JSON.stringify(gotAli) !== JSON.stringify(expectedAli)) wrong.push(`short-name user was reminded of ${JSON.stringify(gotAli)}, expected ${JSON.stringify(expectedAli)}`);
    if (JSON.stringify(gotAlireza) !== JSON.stringify(expectedAlireza)) wrong.push(`long-name user was reminded of ${JSON.stringify(gotAlireza)}, expected ${JSON.stringify(expectedAlireza)}`);

    // a second bell request adds no second reminder
    await h.get('/api/notifications', ali);
    const again = await orm.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, ali.userId), eq(notifications.type, 'crm_due_task')));
    if (again.length !== expectedAli.length) wrong.push(`a second bell request left ${again.length} reminders, expected ${expectedAli.length}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'linked personnel and exact legacy names only; the longer namesake and the other personnel row were not shown',
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
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
    await h.cleanup();
  }
  return results;
}
