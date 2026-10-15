import { and, desc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, crmActivities, crmLeadStageHistory, crmLeads, notifications, personnel, users } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Harness = Awaited<ReturnType<typeof import('../security/workflowTestHarness.js')['createHarness']>>;

/**
 * N-02 part 2 (v10.1.16), CRM plan decisions ت۱–ت۴, ت۶, ت۷: an activity is edited with its version and soft-deleted, both
 * by crm.manage holders and audited; a lead moved to «lost» needs a reason from the list; every stage change is recorded
 * in crm_lead_stage_history and the funnel report reads it; «my follow-ups» shows only the user's own unless a crm.manage
 * holder asks for all. All red on v10.1.15, which had no edit or delete route, no lost reason, no history and no scope.
 */
export async function runCrmActivityEditFunnelTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<{ id: string; name: string; tags: string[]; run: (h: Harness, track: Track) => Promise<string> }> = [
    { id: 'reg_crm_activity_edit_delete_n02', name: 'v10.1.16: a CRM activity is edited with its version (stale 409), new mentions only are notified, delete is soft and audited, crm.view cannot (N-02)', tags: ['n02', 'crm'], run: activityEditCase },
    { id: 'reg_crm_lost_reason_stage_history_n02', name: 'v10.1.16: a lead moved to lost needs a listed reason, leaving lost clears it, and every stage change is recorded (N-02)', tags: ['n02', 'crm'], run: lostReasonCase },
    { id: 'reg_crm_my_followups_n02', name: 'v10.1.16: «my follow-ups» lists only the user\'s own; only a crm.manage holder sees all or one seller (N-02, OBS-R2-27)', tags: ['n02', 'crm', 'followups'], run: myFollowupsCase },
    { id: 'reg_crm_funnel_report_n02', name: 'v10.1.16: the funnel report counts entries, advances, average days and lost reasons from the stage history (N-02)', tags: ['n02', 'crm', 'funnel'], run: funnelCase },
  ];
  const selected = cases.filter(c => shouldRun(c.id, ...c.tags));
  if (selected.length === 0) return results;

  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const track: Track = { leads: [], personnel: [] };
  try {
    for (const c of selected) {
      const tStart = Date.now();
      try {
        const details = await c.run(h, track);
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
      } catch (err) {
        results.push(makeTestCase({
          id: c.id, name: c.name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  } finally {
    if (track.leads.length) {
      await orm.delete(crmLeadStageHistory).where(inArray(crmLeadStageHistory.leadId, track.leads)).catch(() => undefined);
      await orm.update(crmActivities).set({ isDeleted: 1 }).where(inArray(crmActivities.leadId, track.leads)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, track.leads)).catch(() => undefined);
    }
    if (track.personnel.length) await orm.update(personnel).set({ isDeleted: 1, userId: null }).where(inArray(personnel.id, track.personnel)).catch(() => undefined);
    await h.cleanup();
  }
  return results;
}

interface Track { leads: number[]; personnel: number[] }

async function newLead(h: Harness, track: Track, label: string, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await h.post('/api/crm/leads', { title: `N02 ${label} ${h.tag}`, customerName: `N02 buyer ${label} ${h.tag}`, ...extra });
  if (res.status !== 201) throw new Error(`lead create answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  track.leads.push(res.body.id);
  return res.body.id;
}

async function activityEditCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const leadId = await newLead(h, track, 'edit');
  const reader = await h.sessionWith(['crm.view']);
  const reader2 = await h.sessionWith(['crm.view']);
  const viewer = await h.sessionWith(['crm.view']);
  const created = await h.post('/api/crm/activities', { leadId, title: 'تماس نخست', type: 'call', mentions: [reader.userId] });
  if (created.status !== 201) throw new Error(`activity create answered ${created.status}`);
  const actId = Number(created.body.id);
  if (Number(created.body.version) !== 1) wrong.push(`new activity version ${created.body.version}`);

  const denied = await h.put(`/api/crm/activities/${actId}`, { version: 1, title: 'x' }, viewer);
  if (denied.status !== 403) wrong.push(`crm.view edit answered ${denied.status}`);
  const deniedDel = await h.del(`/api/crm/activities/${actId}`, viewer);
  if (deniedDel.status !== 403) wrong.push(`crm.view delete answered ${deniedDel.status}`);

  const edited = await h.put(`/api/crm/activities/${actId}`, { version: 1, title: 'تماس ویرایش‌شده', result: 'پاسخ داد', mentions: [reader.userId, reader2.userId] });
  if (edited.status !== 200) throw new Error(`edit answered ${edited.status} ${JSON.stringify(edited.body).slice(0, 200)}`);
  if (edited.body.title !== 'تماس ویرایش‌شده' || edited.body.result !== 'پاسخ داد' || Number(edited.body.version) !== 2) wrong.push(`edit result ${JSON.stringify(edited.body).slice(0, 160)}`);
  if (edited.body.type !== 'call') wrong.push(`unsent type changed to ${edited.body.type}`);
  const stale = await h.put(`/api/crm/activities/${actId}`, { version: 1, title: 'کهنه' });
  if (stale.status !== 409 || stale.body?.code !== 'OCC_CONFLICT') wrong.push(`stale edit answered ${stale.status} ${stale.body?.code}`);
  const extraKey = await h.put(`/api/crm/activities/${actId}`, { version: 2, leadId: 1 });
  if (extraKey.status !== 400) wrong.push(`edit with leadId answered ${extraKey.status}`);

  const mentionsOf = async (userId: number) => (await orm.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, 'mention'), eq(notifications.link, `/crm?activityId=${actId}`)))).length;
  if (await mentionsOf(reader.userId) !== 1) wrong.push(`first mentioned user has ${await mentionsOf(reader.userId)} mention notices, expected 1`);
  if (await mentionsOf(reader2.userId) !== 1) wrong.push(`newly mentioned user has ${await mentionsOf(reader2.userId)} mention notices, expected 1`);

  const [audit] = await orm.select({ details: activityLogs.details }).from(activityLogs)
    .where(and(eq(activityLogs.entity, 'اقدام و تماس CRM'), eq(activityLogs.entityId, String(actId)), eq(activityLogs.action, 'UPDATE')))
    .orderBy(desc(activityLogs.id)).limit(1);
  const changes = (audit?.details as { changes?: Record<string, { before: unknown; after: unknown }> } | undefined)?.changes ?? {};
  if (changes.title?.before !== 'تماس نخست' || changes.title?.after !== 'تماس ویرایش‌شده') wrong.push(`edit audit ${JSON.stringify(changes).slice(0, 200)}`);

  const del = await h.del(`/api/crm/activities/${actId}`);
  if (del.status !== 200) wrong.push(`delete answered ${del.status}`);
  const [row] = await orm.select({ isDeleted: crmActivities.isDeleted }).from(crmActivities).where(eq(crmActivities.id, actId));
  if (row?.isDeleted !== 1) wrong.push('deleted activity row is not soft-deleted');
  const list = await h.get(`/api/crm/activities?leadId=${leadId}`);
  if ((Array.isArray(list.body) ? list.body : []).some((a: { id: number }) => a.id === actId)) wrong.push('deleted activity still listed');
  const again = await h.del(`/api/crm/activities/${actId}`);
  if (again.status !== 404) wrong.push(`second delete answered ${again.status}`);
  const [delAudit] = await orm.select({ id: activityLogs.id }).from(activityLogs)
    .where(and(eq(activityLogs.entity, 'اقدام و تماس CRM'), eq(activityLogs.entityId, String(actId)), eq(activityLogs.action, 'DELETE')));
  if (!delAudit) wrong.push('delete wrote no audit row');

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'stale version 409, unsent fields kept, one notice per new mention, soft delete audited and hidden, crm.view refused';
}

async function lostReasonCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const leadId = await newLead(h, track, 'lost');
  const history = async () => orm.select().from(crmLeadStageHistory).where(eq(crmLeadStageHistory.leadId, leadId)).orderBy(crmLeadStageHistory.id);
  const first = await history();
  if (first.length !== 1 || first[0].fromStage !== null || first[0].toStage !== 'lead') wrong.push(`create history ${JSON.stringify(first)}`);

  const noReason = await h.put(`/api/crm/leads/${leadId}`, { stage: 'lost' });
  if (noReason.status !== 422 || noReason.body?.code !== 'CRM_LEAD_LOST_REASON_REQUIRED') wrong.push(`lost without reason answered ${noReason.status} ${noReason.body?.code}`);
  const otherNoNote = await h.put(`/api/crm/leads/${leadId}`, { stage: 'lost', lostReason: 'other' });
  if (otherNoNote.status !== 422) wrong.push(`«other» without note answered ${otherNoNote.status}`);
  const unknown = await h.put(`/api/crm/leads/${leadId}`, { stage: 'lost', lostReason: 'weather' });
  if (unknown.status !== 400) wrong.push(`unknown reason answered ${unknown.status}`);
  const [still] = await orm.select({ stage: crmLeads.stage }).from(crmLeads).where(eq(crmLeads.id, leadId));
  if (still?.stage !== 'lead') wrong.push(`refused change moved the lead to ${still?.stage}`);

  const lost = await h.put(`/api/crm/leads/${leadId}`, { stage: 'lost', lostReason: 'competitor' });
  if (lost.status !== 200 || lost.body?.lostReason !== 'competitor' || lost.body?.status !== 'lost') wrong.push(`lost with reason ${lost.status} ${JSON.stringify(lost.body).slice(0, 160)}`);
  const keep = await h.put(`/api/crm/leads/${leadId}`, { notes: 'یادداشت تازه' });
  if (keep.body?.lostReason !== 'competitor') wrong.push(`edit of a lost lead dropped its reason: ${keep.body?.lostReason}`);
  const back = await h.put(`/api/crm/leads/${leadId}`, { stage: 'qualified' });
  if (back.status !== 200 || back.body?.lostReason !== '') wrong.push(`leaving lost kept reason ${back.body?.lostReason}`);

  const rows = await history();
  const path = rows.map(r => `${r.fromStage ?? '-'}>${r.toStage}${r.lostReason ? `(${r.lostReason})` : ''}`).join(' ');
  if (path !== '->lead lead>lost(competitor) lost>qualified') wrong.push(`history path ${path}`);
  if (rows.some(r => !r.changedById || !r.changedByName)) wrong.push('history row without its user');

  const createdLost = await h.post('/api/crm/leads', { title: `N02 created lost ${h.tag}`, customerName: `N02 x ${h.tag}`, stage: 'lost' });
  if (createdLost.status !== 422) wrong.push(`lead created lost without reason answered ${createdLost.status}`);
  if (createdLost.status === 201) track.leads.push(createdLost.body.id);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return `history ${path}; missing, «other» without note and unknown reasons refused`;
}

async function myFollowupsCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const seller = await h.sessionWith(['crm.view']);
  const manager = await h.sessionWith(['crm.view', 'crm.manage']);
  await orm.update(users).set({ fullName: `N02 seller ${h.tag}` }).where(eq(users.id, seller.userId));
  const [sellerPerson] = await orm.insert(personnel).values({ fullName: `N02 seller ${h.tag}`, userId: seller.userId }).returning({ id: personnel.id });
  const [otherPerson] = await orm.insert(personnel).values({ fullName: `N02 other ${h.tag}` }).returning({ id: personnel.id });
  track.personnel.push(sellerPerson.id, otherPerson.id);
  const leadId = await newLead(h, track, 'mine');
  const follow = async (label: string, personnelId: number) => {
    const res = await h.post('/api/crm/activities', { leadId, title: `N02 ${label} ${h.tag}`, nextFollowUpDate: '2030-01-01', nextFollowUpTask: `N02 ${label}`, assignedPersonnelId: personnelId });
    if (res.status !== 201) throw new Error(`follow-up create answered ${res.status}`);
    return Number(res.body.id);
  };
  const mine = await follow('mine', sellerPerson.id);
  const others = await follow('others', otherPerson.id);
  const ids = async (s: typeof seller | null, query: string) => {
    const res = await h.get(`/api/crm/followups?search=${encodeURIComponent(h.tag)}${query}`, s ?? undefined);
    return { scope: res.body?.scope, ids: ((res.body?.data ?? []) as Array<{ id: number }>).map(r => r.id).filter(i => i === mine || i === others).sort((a, b) => a - b), open: res.body?.openCount };
  };
  const sellerDefault = await ids(seller, '');
  if (JSON.stringify(sellerDefault.ids) !== JSON.stringify([mine]) || sellerDefault.scope !== 'mine') wrong.push(`seller default ${JSON.stringify(sellerDefault)}`);
  const sellerAll = await ids(seller, '&scope=all');
  if (JSON.stringify(sellerAll.ids) !== JSON.stringify([mine])) wrong.push(`seller asking all got ${JSON.stringify(sellerAll)}`);
  const sellerOther = await ids(seller, `&assignedPersonnelId=${otherPerson.id}`);
  if (JSON.stringify(sellerOther.ids) !== JSON.stringify([mine])) wrong.push(`seller asking another seller got ${JSON.stringify(sellerOther)}`);
  const managerDefault = await ids(manager, '');
  if (managerDefault.ids.length !== 0) wrong.push(`manager default (own) got ${JSON.stringify(managerDefault)}`);
  const managerAll = await ids(manager, '&scope=all');
  if (JSON.stringify(managerAll.ids) !== JSON.stringify([mine, others].sort((a, b) => a - b)) || managerAll.scope !== 'all') wrong.push(`manager all got ${JSON.stringify(managerAll)}`);
  const managerOne = await ids(manager, `&assignedPersonnelId=${otherPerson.id}`);
  if (JSON.stringify(managerOne.ids) !== JSON.stringify([others])) wrong.push(`manager one seller got ${JSON.stringify(managerOne)}`);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'seller sees own only whatever it asks; crm.manage sees own by default, all, or one seller';
}

async function funnelCase(h: Harness, track: Track): Promise<string> {
  const wrong: string[] = [];
  const [seller] = await orm.insert(personnel).values({ fullName: `N02 funnel ${h.tag}` }).returning({ id: personnel.id });
  track.personnel.push(seller.id);
  const leads: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [row] = await orm.insert(crmLeads).values({ title: `N02 funnel ${i} ${h.tag}`, assignedPersonnelId: seller.id }).returning({ id: crmLeads.id });
    leads.push(row.id);
    track.leads.push(row.id);
  }
  const at = (day: string) => `${day} 08:00:00`;
  const rows: Array<[number, string | null, string, string, string?]> = [
    [leads[0], null, 'lead', '2020-03-01'], [leads[0], 'lead', 'qualified', '2020-03-03'], [leads[0], 'qualified', 'proposal', '2020-03-07'], [leads[0], 'proposal', 'won', '2020-03-10'],
    [leads[1], null, 'lead', '2020-03-02'], [leads[1], 'lead', 'qualified', '2020-03-06'], [leads[1], 'qualified', 'lost', '2020-03-08', 'price'],
    [leads[2], null, 'lead', '2020-03-02'], [leads[2], 'lead', 'lost', '2020-03-04', 'competitor'],
    [leads[3], null, 'lead', '2020-03-05'],
  ];
  for (const [leadId, from, to, day, reason] of rows) {
    await orm.insert(crmLeadStageHistory).values({ leadId, fromStage: from, toStage: to, lostReason: reason ?? '', assignedPersonnelId: seller.id, changedByName: 'n02', changedAt: at(day) });
  }
  const res = await h.get(`/api/crm/reports/funnel?fromDate=2020-03-01&toDate=2020-03-31&assignedPersonnelId=${seller.id}`);
  if (res.status !== 200) throw new Error(`funnel answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  const stage = (s: string) => (res.body.stages as Array<Record<string, unknown>>).find(r => r.stage === s) ?? {};
  const expect = (s: string, want: Record<string, unknown>) => {
    const got = stage(s);
    for (const [k, v] of Object.entries(want)) if (got[k] !== v) wrong.push(`${s}.${k} = ${JSON.stringify(got[k])}, expected ${JSON.stringify(v)}`);
  };
  // lead: 4 entered, 2 went forward (0 and 1); days to next change 2, 4, 2 (lead 3 still there) → 2.7
  expect('lead', { entered: 4, advanced: 2, conversionPercent: 50, avgDays: 2.7, measured: 3 });
  // qualified: 2 entered, 1 forward (lead 0); days 4 and 2 → 3
  expect('qualified', { entered: 2, advanced: 1, conversionPercent: 50, avgDays: 3, measured: 2 });
  expect('proposal', { entered: 1, advanced: 1, conversionPercent: 100, avgDays: 3, measured: 1 });
  expect('won', { entered: 1, advanced: 0, conversionPercent: null });
  if (res.body.lost?.count !== 2) wrong.push(`lost count ${res.body.lost?.count}`);
  const reasons = (res.body.lost?.reasons ?? []).map((r: { reason: string; count: number }) => `${r.reason}:${r.count}`).sort().join(',');
  if (reasons !== 'competitor:1,price:1') wrong.push(`lost reasons ${reasons}`);

  const narrow = await h.get(`/api/crm/reports/funnel?fromDate=2020-03-05&toDate=2020-03-31&assignedPersonnelId=${seller.id}`);
  const narrowLead = (narrow.body.stages as Array<{ stage: string; entered: number }>).find(r => r.stage === 'lead');
  if (narrowLead?.entered !== 1) wrong.push(`range from 5 March counted ${narrowLead?.entered} lead entries, expected 1`);
  const viewer = await h.sessionWith(['customers.view']);
  const denied = await h.get('/api/crm/reports/funnel', viewer);
  if (denied.status !== 403) wrong.push(`customers.view reader answered ${denied.status}`);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'entries, advances, average days and lost reasons as expected for one seller and range';
}
