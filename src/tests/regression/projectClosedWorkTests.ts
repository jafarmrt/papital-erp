import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * Series 10 phase 3, lane L3 (package 11), product-owner decision t10 of phase 5: no new remittance or work log on a
 * cancelled project, no work log above its schedule row, no work log after the end of employment. Through the real
 * Express routes; each case is red on the code before its fix.
 */
export async function runProjectClosedWorkTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_cancelled_project_refuses_documents_and_logs_td_921',
      'v10.0.28: a final remittance, the finalize of a draft remittance and a work log on a cancelled project are refused with 422 PROJECT_CANCELLED; an open project still takes them (TD-921)',
      ['td921', 'p5-m06', 'projects', 'documents', 'piecework', 'package11'], cancelledProjectCase],
    ['reg_schedule_log_within_row_quantity_td_955',
      'v10.0.29: a work log from a workshop schedule row may not exceed the row quantity (422 PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED); the row quantity itself is saved (TD-955)',
      ['td955', 'p5-w11', 'projects', 'piecework', 'schedule', 'package11'], scheduleQuantityCase],
  ]);
}

let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

async function newProject(stageSchedules?: unknown): Promise<number> {
  const [row] = await orm.insert(productionProjects).values({
    projectCode: unique('PRJ-T10'), title: unique('t10 project'),
    ...(stageSchedules ? { stageSchedules } : {}),
  } as never).returning({ id: productionProjects.id });
  return row.id;
}

async function newTaskId(h: Harness): Promise<number> {
  const [row] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, 1000) RETURNING id`, [unique('PT'), unique('t10 task')]);
  return Number(row.id);
}

async function logCount(h: Harness, personnelId: number): Promise<number> {
  const [row] = await h.q('SELECT COUNT(*)::int AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [personnelId]);
  return Number(row?.n ?? 0);
}

/** P5-M06 (TD-921): a cancelled project refused allocations only; remittances and work logs still debited it */
async function cancelledProjectCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const project = await newProject();
  const line = [{ itemId: material, quantity: 2, unit_price: 0, location: f.wh }];
  const draft = await h.post('/api/documents', f.doc('remittance', 'draft', line, { projectId: project }));
  const draftId = Number((draft.body as { docId?: unknown })?.docId);
  if (draft.status !== 200 || !Number.isInteger(draftId)) throw new Error(`setup: the draft remittance answered ${brief(draft)}`);
  const worker = await newWorker('TD-921');
  const task = await newTaskId(h);

  await orm.update(productionProjects).set({ status: 'cancelled' }).where(eq(productionProjects.id, project));
  const remit = await h.post('/api/documents', f.doc('remittance', 'final', line, { projectId: project }));
  if (remit.status !== 422 || codeOf(remit) !== 'PROJECT_CANCELLED') wrong.push(`a final remittance on a cancelled project answered ${brief(remit)}, expected 422 PROJECT_CANCELLED`);
  const fin = await h.put(`/api/documents/${draftId}/finalize`, {});
  if (fin.status !== 422 || codeOf(fin) !== 'PROJECT_CANCELLED') wrong.push(`finalizing a draft remittance of a cancelled project answered ${brief(fin)}, expected 422 PROJECT_CANCELLED`);
  if (await f.stock(material) !== 20) wrong.push(`stock moved to ${await f.stock(material)} although every remittance was refused`);
  const log = await h.post('/api/piecework/logs', { personnelId: worker, taskId: task, projectId: project, date: f.today, quantity: 1 });
  if (log.status !== 422 || codeOf(log) !== 'PROJECT_CANCELLED') wrong.push(`a work log on a cancelled project answered ${brief(log)}, expected 422 PROJECT_CANCELLED`);
  if (await logCount(h, worker) !== 0) wrong.push('the refused work log was saved');

  const open = await newProject();
  const ok = await h.post('/api/documents', f.doc('remittance', 'final', line, { projectId: open }));
  if (ok.status !== 200) wrong.push(`a final remittance on an open project answered ${brief(ok)}, expected 200`);
  const okLog = await h.post('/api/piecework/logs', { personnelId: worker, taskId: task, projectId: open, date: f.today, quantity: 1 });
  if (okLog.status !== 201) wrong.push(`a work log on an open project answered ${brief(okLog)}, expected 201`);
  return 'a cancelled project takes no remittance, finalize or work log; an open one does';
}

/** P5-W11 (TD-955): a schedule row of 5 accepted a log of 50 */
async function scheduleQuantityCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const worker = await newWorker('TD-955');
  const task = await newTaskId(h);
  const tasks = [{ id: 'row-a', taskId: task, taskTitle: 'row', assignedPersonnelId: worker, quantity: 5, status: 'pending' }];
  const project = await newProject({ 1: { 'prod-main': { productId: 'prod-main', assignedPersonnel: [], tasks } } });
  const item = (quantity: number) => ({ personnelId: worker, taskId: task, projectId: project, date: f.today, quantity, scheduleRef: { stageId: 1, productId: 'prod-main', rowId: 'row-a' } });
  const over = await h.post('/api/piecework/logs', { items: [item(6)] });
  if (over.status !== 422 || codeOf(over) !== 'PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED') wrong.push(`a log of 6 on a row of 5 answered ${brief(over)}, expected 422 PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED`);
  if (await logCount(h, worker) !== 0) wrong.push('the refused log over the row quantity was saved');
  const exact = await h.post('/api/piecework/logs', { items: [item(5)] });
  if (exact.status !== 201) wrong.push(`a log of 5 on a row of 5 answered ${brief(exact)}, expected 201`);
  return 'a schedule log above its row quantity is refused; the row quantity is saved';
}
