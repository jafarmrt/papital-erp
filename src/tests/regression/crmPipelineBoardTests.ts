import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeadStageHistory, crmLeads } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Harness = Awaited<ReturnType<typeof import('../security/workflowTestHarness.js')['createHarness']>>;

/**
 * N-02 part 3 (v10.1.19, TD-1272): the pipeline card shows each lead's nearest open follow-up, which the lead list now
 * carries as `nextFollowUpDate`. Red on v10.1.18, whose lead list had no such field.
 */
export async function runCrmPipelineBoardTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_crm_lead_next_followup_td_1272';
  const name = 'v10.1.19: the lead list carries each lead\'s nearest open follow-up; completed and deleted ones do not count (TD-1272)';
  if (!shouldRun(id, 'n02', 'crm', 'td-1272')) return [];

  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const leads: number[] = [];
  const tStart = Date.now();
  try {
    const details = await nextFollowupCase(h, leads);
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (leads.length) {
      await orm.delete(crmLeadStageHistory).where(inArray(crmLeadStageHistory.leadId, leads)).catch(() => undefined);
      await orm.update(crmActivities).set({ isDeleted: 1 }).where(inArray(crmActivities.leadId, leads)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leads)).catch(() => undefined);
    }
    await h.cleanup();
  }
}

async function nextFollowupCase(h: Harness, leads: number[]): Promise<string> {
  const wrong: string[] = [];
  const newLead = async (label: string): Promise<number> => {
    const res = await h.post('/api/crm/leads', { title: `TD1272 ${label} ${h.tag}`, customerName: `TD1272 buyer ${label} ${h.tag}` });
    if (res.status !== 201) throw new Error(`lead create answered ${res.status}`);
    leads.push(res.body.id);
    return res.body.id;
  };
  const followup = async (leadId: number, date: string): Promise<number> => {
    const res = await h.post('/api/crm/activities', { leadId, title: `پیگیری ${date}`, type: 'call', nextFollowUpDate: date });
    if (res.status !== 201) throw new Error(`activity create answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return res.body.id;
  };

  const withFollowups = await newLead('with');
  const without = await newLead('without');
  await followup(withFollowups, '2026-11-20');
  await followup(withFollowups, '2026-11-05');
  const done = await followup(withFollowups, '2026-10-01');
  const removed = await followup(withFollowups, '2026-10-02');
  const completed = await h.put(`/api/crm/activities/${done}/complete-followup`, {});
  if (completed.status !== 200) wrong.push(`complete-followup answered ${completed.status}`);
  const deleted = await h.del(`/api/crm/activities/${removed}`);
  if (deleted.status !== 200) wrong.push(`activity delete answered ${deleted.status}`);

  const list = await h.get(`/api/crm/leads?search=${encodeURIComponent(`TD1272`)}`);
  const rows = (Array.isArray(list.body) ? list.body : []) as Array<{ id: number; nextFollowUpDate?: string | null }>;
  const next = (leadId: number) => rows.find((r) => r.id === leadId)?.nextFollowUpDate;
  if (next(withFollowups) !== '2026-11-05') wrong.push(`lead with follow-ups: next ${String(next(withFollowups))}, expected 2026-11-05`);
  if (next(without) !== null) wrong.push(`lead without follow-ups: next ${String(next(without))}, expected null`);

  const paged = await h.get(`/api/crm/leads?page=1&limit=50&search=${encodeURIComponent(`TD1272 with ${h.tag}`)}`);
  const pagedRow = (paged.body?.data ?? []).find((r: { id: number }) => r.id === withFollowups) as { nextFollowUpDate?: string } | undefined;
  if (pagedRow?.nextFollowUpDate !== '2026-11-05') wrong.push(`paged list: next ${String(pagedRow?.nextFollowUpDate)}`);

  if (wrong.length) throw new Error(wrong.join('; '));
  return 'nearest open follow-up 2026-11-05 on both list shapes; completed and deleted follow-ups ignored; none = null';
}
