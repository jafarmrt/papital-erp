import { asc, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeadStageHistory, crmLeads, personnel } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Harness = Awaited<ReturnType<typeof import('../security/workflowTestHarness.js')['createHarness']>>;

/**
 * v10.1.70 (migration 0125): the funnel report read only the stage history that starts with v10.1.18, so every lead
 * changed earlier was missing from it. erp_backfill_crm_lead_stage_history() rebuilds each lead's earlier history from
 * its activity rows (stage change, proforma, conversion, reopened proforma), marks guessed rows `backfill_estimated`,
 * skips leads created after v10.1.18, never duplicates a live row and adds nothing when it runs again; the report counts
 * the estimated entries. Red on v10.1.68, which had neither the function nor the source column.
 */
export async function runCrmStageHistoryBackfillTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_crm_stage_history_backfill';
  const name = 'v10.1.70: the lead stage history before v10.1.18 is rebuilt from the activity log, estimated rows marked, run again adds nothing';
  if (!shouldRun(id, 'crm', 'funnel', 'n02')) return [];
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const leads: number[] = [];
  const staff: number[] = [];
  const tStart = Date.now();
  try {
    const details = await backfillCase(h, leads, staff);
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
    if (staff.length) await orm.update(personnel).set({ isDeleted: 1 }).where(inArray(personnel.id, staff)).catch(() => undefined);
    await h.cleanup();
  }
}

const at = (day: string, time = '08:00:00') => `${day} ${time}`;
const change = (from: string, to: string) => `مرحله فروش از "${from}" به "${to}" تغییر یافت.`;

async function backfillCase(h: Harness, leads: number[], staff: number[]): Promise<string> {
  const wrong: string[] = [];
  const [seller] = await orm.insert(personnel).values({ fullName: `BF seller ${h.tag}` }).returning({ id: personnel.id });
  staff.push(seller.id);
  const lead = async (label: string, stage: string, created: string, updated: string, extra: Record<string, unknown> = {}) => {
    const [row] = await orm.insert(crmLeads).values({
      title: `BF ${label} ${h.tag}`, stage, assignedPersonnelId: seller.id, createdAt: at(created), updatedAt: at(updated), createdBy: 'bf', ...extra,
    }).returning({ id: crmLeads.id });
    leads.push(row.id);
    return row.id;
  };
  const activity = (leadId: number, title: string, description: string, createdAt: string, type = 'task') =>
    orm.insert(crmActivities).values({ leadId, type, title, description, loggedBy: 'bf', createdAt });

  // A: every move read from the activity log (form changes and a proforma)
  const a = await lead('A', 'won', '2020-01-01', '2020-01-07');
  await activity(a, 'تغییر مرحله فروش', change('مخاطب اولیه', 'ارزیابی و نیازسنجی'), at('2020-01-03'));
  await activity(a, 'صدور پیش‌فاکتور شماره 12', 'پیش‌فاکتور رسمی به شماره 12 در سیستم ثبت گردید.', at('2020-01-05'), 'quote');
  await activity(a, 'تغییر مرحله فروش', change('پیش‌فاکتور و پیشنهاد', 'موفق (بسته شد)'), at('2020-01-07'));
  // B: lost with a stored reason
  const b = await lead('B', 'lost', '2020-01-02', '2020-01-04', { status: 'lost', lostReason: 'price' });
  await activity(b, 'تغییر مرحله فروش', change('مخاطب اولیه', 'ناموفق (انصراف)'), at('2020-01-04'));
  // C: creation stage guessed, and the log does not reach the current stage
  const c = await lead('C', 'qualified', '2020-01-02', '2020-01-09');
  await activity(c, 'صدور پیش‌فاکتور شماره 13', 'پیش‌فاکتور رسمی به شماره 13 در سیستم ثبت گردید.', at('2020-01-06'), 'quote');
  // D: changed before and after v10.1.18; the activity written with the live row is not read twice
  const d = await lead('D', 'proposal', '2020-01-01', '2020-01-10');
  await activity(d, 'تغییر مرحله فروش', change('مخاطب اولیه', 'ارزیابی و نیازسنجی'), at('2020-01-02'));
  await activity(d, 'تغییر مرحله فروش', change('ارزیابی و نیازسنجی', 'پیش‌فاکتور و پیشنهاد'), at('2020-01-10', '08:00:00.000'));
  await orm.insert(crmLeadStageHistory).values({ leadId: d, fromStage: 'qualified', toStage: 'proposal', assignedPersonnelId: seller.id, changedAt: at('2020-01-10', '08:00:00.004') });
  // E: created after v10.1.18, its history is complete
  const e = await lead('E', 'lead', '2020-01-03', '2020-01-03');
  await orm.insert(crmLeadStageHistory).values({ leadId: e, fromStage: null, toStage: 'lead', assignedPersonnelId: seller.id, changedAt: at('2020-01-03') });

  // F–K (another seller): no stage activity, no dates, an unreadable log row, an empty old stage, an unknown stage
  const other = { assignedPersonnelId: null };
  const f = await lead('F', 'won', '2020-01-02', '2020-01-02', { ...other, status: 'won' });
  const g = await lead('G', 'lead', '2020-01-02', '2020-01-02', other);
  const [hRow] = await orm.insert(crmLeads).values({ title: `BF H ${h.tag}`, stage: 'lead', createdAt: null, updatedAt: null }).returning({ id: crmLeads.id });
  leads.push(hRow.id);
  const i = await lead('I', 'qualified', '2020-01-02', '2020-01-08', other);
  await activity(i, 'تغییر مرحله فروش', 'متن دست‌خورده بی مرحله', at('2020-01-05'));
  const j = await lead('J', '', '2020-01-01', '2020-01-10', other);
  await orm.insert(crmLeadStageHistory).values({ leadId: j, fromStage: null, toStage: 'qualified', changedAt: at('2020-01-10') });
  const k = await lead('K', 'archived', '2020-01-02', '2020-01-02', other);

  await orm.execute(sql`SELECT erp_backfill_crm_lead_stage_history()`);
  const history = async (leadId: number) => (await orm.select().from(crmLeadStageHistory)
    .where(eq(crmLeadStageHistory.leadId, leadId)).orderBy(asc(crmLeadStageHistory.changedAt), asc(crmLeadStageHistory.id)))
    .map(r => `${r.fromStage ?? '-'}>${r.toStage}@${r.changedAt.slice(0, 10)}:${r.source}${r.lostReason ? `:${r.lostReason}` : ''}`).join(' ');
  const expectHistory = async (label: string, leadId: number, want: string) => {
    const got = await history(leadId);
    if (got !== want) wrong.push(`${label}: ${got} (expected ${want})`);
  };
  await expectHistory('A', a, '->lead@2020-01-01:backfill lead>qualified@2020-01-03:backfill qualified>proposal@2020-01-05:backfill proposal>won@2020-01-07:backfill');
  await expectHistory('B', b, '->lead@2020-01-02:backfill lead>lost@2020-01-04:backfill:price');
  await expectHistory('C', c, '->lead@2020-01-02:backfill_estimated lead>proposal@2020-01-06:backfill proposal>qualified@2020-01-09:backfill_estimated');
  await expectHistory('D', d, '->lead@2020-01-01:backfill lead>qualified@2020-01-02:backfill qualified>proposal@2020-01-10:live');
  await expectHistory('E', e, '->lead@2020-01-03:live');

  await expectHistory('F', f, '->won@2020-01-02:backfill_estimated');
  await expectHistory('G', g, '->lead@2020-01-02:backfill');
  const hHistory = await history(hRow.id);
  if (!/^->lead@\d{4}-\d{2}-\d{2}:backfill$/.test(hHistory)) wrong.push(`H (no dates): ${hHistory}`);
  await expectHistory('I', i, '->lead@2020-01-02:backfill_estimated lead>qualified@2020-01-08:backfill_estimated');
  await expectHistory('J', j, '->lead@2020-01-01:backfill ->qualified@2020-01-10:live');
  await expectHistory('K', k, '->lead@2020-01-02:backfill_estimated');

  const before = await history(a) + await history(c) + await history(d);
  await orm.execute(sql`SELECT erp_backfill_crm_lead_stage_history()`);
  if (await history(a) + await history(c) + await history(d) !== before) wrong.push('a second run changed the rebuilt history');

  // the report counts the rebuilt entries of A, B and C (D and E are moved to another seller) and the estimated ones
  await orm.update(crmLeadStageHistory).set({ assignedPersonnelId: null }).where(inArray(crmLeadStageHistory.leadId, [d, e]));
  const res = await h.get(`/api/crm/reports/funnel?fromDate=2020-01-01&toDate=2020-01-31&assignedPersonnelId=${seller.id}`);
  if (res.status !== 200) throw new Error(`funnel answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  const entered = (s: string) => (res.body.stages as Array<{ stage: string; entered: number }>).find(r => r.stage === s)?.entered;
  if (entered('lead') !== 3) wrong.push(`lead entries ${entered('lead')}, expected 3`);
  if (entered('qualified') !== 2) wrong.push(`qualified entries ${entered('qualified')}, expected 2`);
  if (entered('won') !== 1) wrong.push(`won entries ${entered('won')}, expected 1`);
  if (res.body.estimatedEntries !== 2) wrong.push(`estimated entries ${res.body.estimatedEntries}, expected 2`);
  const reasons = (res.body.lost?.reasons ?? []).map((r: { reason: string; count: number }) => `${r.reason}:${r.count}`).join(',');
  if (reasons !== 'price:1') wrong.push(`lost reasons ${reasons}`);

  if (wrong.length) throw new Error(wrong.join(' | '));
  return 'earlier history rebuilt from the activity log, estimated rows marked and counted, live rows untouched, second run adds nothing';
}
