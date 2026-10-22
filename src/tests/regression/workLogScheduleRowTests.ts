import { orm } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { PieceworkService } from '../../services/piecework.service.js';
import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { outcomeProblems, raceBehindRowLock } from '../invariants/concurrencyHarness.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * 10.2 package 12, the #329 review notes M3 and M4 (TD-1346, TD-1347): an edit of a schedule-linked work log keeps the
 * row's quantity as its cap, like the create path (TD-955), and a batch with a schedule row locks every project of the
 * batch, so it no longer deadlocks against its mirror batch. Red on v10.2.26: an edit to 500 on a row of 10 was saved,
 * and the two mirror batches ended in a deadlock (40P01).
 */
export async function runWorkLogScheduleRowTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_work_log_edit_within_row_quantity_td_1346',
      '10.2 package 12 review M3: editing a schedule-linked work log above its row quantity is refused (422 PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED) and the log is unchanged; a stored log already above its row keeps its quantity and still takes other edits; a manual log has no cap (TD-1346)',
      ['td1346', 'm3', 'projects', 'piecework', 'schedule', 'package12'], editCapCase],
    ['reg_work_log_mirror_batches_no_deadlock_td_1347',
      '10.2 package 12 review M4: a batch with a schedule row in project A and a manual log in B, run beside the mirror batch, saves both batches without a deadlock (TD-1347)',
      ['td1347', 'm4', 'projects', 'piecework', 'schedule', 'concurrency', 'package12'], mirrorBatchCase],
  ]);
}

let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

async function newTaskId(h: Harness): Promise<number> {
  const [row] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, 1000) RETURNING id`, [unique('M3T'), unique('M3 task')]);
  return Number(row.id);
}

/** A project whose stage 1 has one schedule row for `worker` and `task` on the single-item key «prod-main» */
async function scheduledProject(worker: number, task: number, quantity: number): Promise<number> {
  const tasks = [{ id: 'row-a', taskId: task, taskTitle: 'row', assignedPersonnelId: worker, quantity, status: 'pending' }];
  const [row] = await orm.insert(productionProjects).values({
    projectCode: unique('PRJ-M3'), title: unique('M3 project'),
    stageSchedules: { 1: { 'prod-main': { productId: 'prod-main', assignedPersonnel: [], tasks } } },
  } as never).returning({ id: productionProjects.id });
  return row.id;
}

const ROW_A = { stageId: 1, productId: 'prod-main', rowId: 'row-a' };

async function storedLog(h: Harness, id: number): Promise<{ quantity: number; total: number; notes: string }> {
  const [row] = await h.q('SELECT quantity, total_amount, notes FROM piecework_logs WHERE id = $1', [id]);
  return { quantity: Number(row?.quantity), total: Number(row?.total_amount), notes: String(row?.notes ?? '') };
}

/** M3: `updateWorkLog` skipped the row cap the create path has; 500 on a row of 10 was saved and paid 50 times the plan */
async function editCapCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const worker = await newWorker('TD-1346');
  const task = await newTaskId(h);
  const project = await scheduledProject(worker, task, 10);
  const created = await h.post('/api/piecework/logs', { items: [{ personnelId: worker, taskId: task, projectId: project, date: f.today, quantity: 5, scheduleRef: ROW_A }] });
  const logId = Number((created.body as { insertedIds?: unknown[] })?.insertedIds?.[0]);
  if (created.status !== 201 || !Number.isInteger(logId)) throw new Error(`setup: the schedule log answered ${brief(created)}`);

  const over = await h.put(`/api/piecework/logs/${logId}`, { quantity: 500 });
  if (over.status !== 422 || codeOf(over) !== 'PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED') wrong.push(`editing the log to 500 on a row of 10 answered ${brief(over)}, expected 422 PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED`);
  const afterOver = await storedLog(h, logId);
  if (afterOver.quantity !== 5 || afterOver.total !== 5000) wrong.push(`the refused edit left quantity ${afterOver.quantity} and total ${afterOver.total}, expected 5 and 5000`);
  const exact = await h.put(`/api/piecework/logs/${logId}`, { quantity: 10 });
  if (exact.status !== 200) wrong.push(`editing the log to the row quantity 10 answered ${brief(exact)}, expected 200`);
  if ((await storedLog(h, logId)).quantity !== 10) wrong.push(`the edit to 10 stored ${(await storedLog(h, logId)).quantity}`);

  // a log saved above its row before the cap (or through this hole) is never rewritten; it still takes other edits
  await h.q('UPDATE piecework_logs SET quantity = 50, total_amount = 50000 WHERE id = $1', [logId]);
  const notes = await h.put(`/api/piecework/logs/${logId}`, { notes: 'M3 note' });
  if (notes.status !== 200) wrong.push(`a notes edit of a stored log above its row answered ${brief(notes)}, expected 200`);
  const resent = await h.put(`/api/piecework/logs/${logId}`, { quantity: 50, notes: 'M3 note 2' });
  if (resent.status !== 200) wrong.push(`an edit that resends the stored quantity 50 answered ${brief(resent)}, expected 200`);
  const lower = await h.put(`/api/piecework/logs/${logId}`, { quantity: 40 });
  if (lower.status !== 422 || codeOf(lower) !== 'PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED') wrong.push(`editing the stored 50 to 40 on a row of 10 answered ${brief(lower)}, expected 422 PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED`);
  const legacy = await storedLog(h, logId);
  if (legacy.quantity !== 50 || legacy.total !== 50000 || legacy.notes !== 'M3 note 2') wrong.push(`the stored log above its row reads quantity ${legacy.quantity}, total ${legacy.total}, notes «${legacy.notes}»; expected 50, 50000 and «M3 note 2»`);

  const manual = await h.post('/api/piecework/logs', { personnelId: worker, taskId: task, projectId: project, date: f.today, quantity: 5 });
  const manualId = Number((manual.body as { insertedIds?: unknown[] })?.insertedIds?.[0]);
  if (manual.status !== 201 || !Number.isInteger(manualId)) throw new Error(`setup: the manual log answered ${brief(manual)}`);
  const manualEdit = await h.put(`/api/piecework/logs/${manualId}`, { quantity: 500 });
  if (manualEdit.status !== 200 || (await storedLog(h, manualId)).quantity !== 500) wrong.push(`editing a manual log of the same project to 500 answered ${brief(manualEdit)}, expected 200 and 500 stored`);
  return 'an edit above the row is refused and changes nothing; a stored log above its row keeps its quantity; a manual log has no cap';
}

/** M4: the batch took the scheduled project exclusively, then a shared lock on every project, so mirror batches deadlocked */
async function mirrorBatchCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const worker = await newWorker('TD-1347');
  const task = await newTaskId(h);
  const [a, b] = [await scheduledProject(worker, task, 5), await scheduledProject(worker, task, 5)];
  const batch = (scheduled: number, manual: number) => () => PieceworkService.logWorkEntries([
    { personnelId: worker, taskId: task, projectId: scheduled, date: f.today, quantity: 1, scheduleRef: ROW_A },
    { personnelId: worker, taskId: task, projectId: manual, date: f.today, quantity: 1 },
  ]);
  // both batches queue behind a lock on the worker's row, after their first project lock and before their shared locks
  const outcomes = await raceBehindRowLock<unknown>('personnel', [worker], [batch(a, b), batch(b, a)], { staggered: true });
  wrong.push(...outcomeProblems(['schedule row in A, manual log in B', 'schedule row in B, manual log in A'], outcomes, () => false));
  const [count] = await h.q('SELECT COUNT(*)::int AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [worker]);
  if (Number(count?.n) !== 4) wrong.push(`${Number(count?.n)} work logs were saved, expected 4`);
  return 'two mirror batches with a schedule row each save without a deadlock';
}
