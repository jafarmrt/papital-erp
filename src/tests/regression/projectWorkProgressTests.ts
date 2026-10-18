import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * 10.2 package 12, item 3 (D6, TD-1340, owner decision ت۴۲ الف): a project's progress counts the done work of its workshop
 * schedule rows. A cell of the progress matrix carries «done of planned» from the rows' live work logs, a stage's and a
 * product's percent count it (100 only when ticked), and writing, editing or deleting a schedule-linked work log syncs
 * the stored stage percents and the project status in the log's own transaction. The «تمام» tick stays the manager's.
 * Through the real Express routes; red on v10.2.9, where a cell had no work, a stage read 0% until ticked and the
 * workshop panel counted only approved reports.
 */
export async function runProjectWorkProgressTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_work_progress_d6',
      '10.2 package 12: a schedule-linked work log moves its matrix cell, its stage percent and the project status; a quantity edit and a delete sync them again; only the tick completes a stage (D6, TD-1340)',
      ['d6', 'projects', 'piecework', 'workshop'], logProgressCase],
    ['reg_project_work_progress_main_item_d6',
      '10.2 package 12: a single-item project\'s schedule («prod-main») counts in its matrix, an approved workshop report syncs the stage and the tick suggestion names the main item; a project without a matrix keeps its status (D6, TD-1340)',
      ['d6', 'projects', 'workshop'], mainItemCase],
    ['reg_project_work_progress_closed_d6',
      '10.2 package 12 review H1: a work log never reopens a completed project or a completed stage, never unblocks a stage and never touches a paused project; it only updates percents and starts a waiting stage or a planned project (D6, TD-1340)',
      ['d6', 'projects', 'piecework'], closedProjectCase],
  ]);
}

let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
/** the schedule rows' unit, which the matrix and the workshop panel answer back */
const PIECES = 'عدد';

interface ScheduleRow { id: string; taskId: number; taskTitle: string; assignedPersonnelId: number; quantity: number; unit: string }

async function newTaskId(h: Harness): Promise<number> {
  const [row] = await h.q(`INSERT INTO piecework_tasks (code, title, default_rate) VALUES ($1, $2, 1000) RETURNING id`, [unique('D6T'), unique('D6 task')]);
  return Number(row.id);
}

/** A project with two stages; `rows` puts schedule rows under stage 1 or 2 for one product key. */
async function scheduledProject(h: Harness, input: {
  products: unknown[];
  itemId?: number | null;
  productKey: string;
  rows: Array<{ stage: 1 | 2; row: ScheduleRow }>;
}): Promise<{ projectId: number; stageIds: [number, number] }> {
  const [project] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, item_id, quantity, products) VALUES ($1, $2, 'planned', $3, 10, $4) RETURNING id`,
    [unique('D6P'), unique('D6 project'), input.itemId ?? null, JSON.stringify(input.products)],
  );
  const projectId = Number(project.id);
  const stageIds: number[] = [];
  for (const [order, title] of [[1, 'برش'], [2, 'مونتاژ']] as const) {
    const [stage] = await h.q(`INSERT INTO project_stages (project_id, stage_order, title) VALUES ($1, $2, $3) RETURNING id`, [projectId, order, title]);
    stageIds.push(Number(stage.id));
  }
  const schedules: Record<string, Record<string, { productId: string; productName: string; tasks: ScheduleRow[] }>> = {};
  for (const { stage, row } of input.rows) {
    const stageId = String(stageIds[stage - 1]);
    schedules[stageId] ??= { [input.productKey]: { productId: input.productKey, productName: 'D6 product', tasks: [] } };
    schedules[stageId][input.productKey].tasks.push(row);
  }
  await h.q(`UPDATE production_projects SET stage_schedules = $2 WHERE id = $1`, [projectId, JSON.stringify(schedules)]);
  return { projectId, stageIds: [stageIds[0], stageIds[1]] };
}

const stageRows = (h: Harness, projectId: number) =>
  h.q(`SELECT stage_order, progress_percent, status FROM project_stages WHERE project_id = $1 AND is_deleted = 0 ORDER BY stage_order`, [projectId]);
const projectStatus = async (h: Harness, projectId: number) => String((await h.q(`SELECT status FROM production_projects WHERE id = $1`, [projectId]))[0]?.status);

interface CellView { stage_order: number; status: string; work?: { planned_quantity: number; done_quantity: number; unit: string | null; share: number } | null }
interface ProgressView { products: Array<{ item_id: number | null; progress: CellView[]; progress_percent: number }>; summary: { per_stage_counts: Array<{ stage_order: number; progress_percent?: number }> } }

async function progressView(h: Harness, projectId: number): Promise<ProgressView> {
  const res = await h.get(`/api/projects/${projectId}/product-progress`);
  if (res.status !== 200) throw new Error(`product-progress answered ${brief(res)}`);
  return (res.body as { data: ProgressView }).data;
}

interface PanelStage { stageId: number; plannedQuantity: number | null; approvedQuantity: number | null; unit: string | null; percent: number }

/** one stage of the schedule tab's workshop panel */
async function panelStage(h: Harness, projectId: number, stageId: number): Promise<PanelStage | undefined> {
  const res = await h.get(`/api/workshop/projects/${projectId}/reports`);
  if (res.status !== 200) throw new Error(`the workshop panel answered ${brief(res)}`);
  return ((res.body as { stageProgress?: PanelStage[] }).stageProgress ?? []).find(s => s.stageId === stageId);
}

const cellOf = (view: ProgressView, stageOrder: number) => view.products[0]?.progress.find(c => c.stage_order === stageOrder);
const stagePercentOf = (view: ProgressView, stageOrder: number) => view.summary.per_stage_counts.find(s => s.stage_order === stageOrder)?.progress_percent;

/** stage rows as «order:percent:status» for one comparable string */
const stageText = (rows: Array<Record<string, unknown>>) => rows.map(r => `${r.stage_order}:${Number(r.progress_percent)}:${r.status}`).join(' ');

async function logProgressCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(0);
  const task = await newTaskId(h);
  const worker = await newWorker('D6 worker');
  const row = (id: string, quantity: number): ScheduleRow => ({ id, taskId: task, taskTitle: 'برش D6', assignedPersonnelId: worker, quantity, unit: PIECES });
  const { projectId, stageIds } = await scheduledProject(h, {
    products: [{ id: 'prod-a', item_id: item, item_code: '', item_name: 'D6 product', quantity: 10, unit: 'عدد' }],
    productKey: 'prod-a',
    rows: [{ stage: 1, row: row('row-a', 100) }, { stage: 2, row: row('row-b', 50) }],
  });

  const logged = await h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId, date: f.today, quantity: 60,
    scheduleRef: { stageId: stageIds[0], productId: 'prod-a', rowId: 'row-a' },
  });
  const logId = Number((logged.body as { insertedIds?: number[] }).insertedIds?.[0]);
  if (logged.status !== 201 || !logId) throw new Error(`setup: logging the schedule row answered ${brief(logged)}`);

  // the matrix: the cell shows 60 of 100, the stage 60%, the product the average of its two stages
  const view = await progressView(h, projectId);
  const work = cellOf(view, 1)?.work;
  if (!work || work.planned_quantity !== 100 || work.done_quantity !== 60 || work.unit !== PIECES || Math.abs(work.share - 0.6) > 1e-9) {
    wrong.push(`the stage 1 cell carries work ${JSON.stringify(work ?? null)}, expected 60 of 100 pieces`);
  }
  if (cellOf(view, 2)?.work?.done_quantity !== 0) wrong.push(`the stage 2 cell carries work ${JSON.stringify(cellOf(view, 2)?.work ?? null)}, expected 0 of 50`);
  if (stagePercentOf(view, 1) !== 60 || stagePercentOf(view, 2) !== 0) wrong.push(`the stage percents are ${JSON.stringify(view.summary.per_stage_counts)}, expected 60 and 0`);
  if (view.products[0]?.progress_percent !== 30) wrong.push(`the product reads ${view.products[0]?.progress_percent}%, expected 30%`);
  if (cellOf(view, 1)?.status !== 'pending') wrong.push(`logging work ticked the cell (${cellOf(view, 1)?.status}); only the manager ticks a cell complete`);

  // the stored stages and the project status follow in the log's transaction
  if (stageText(await stageRows(h, projectId)) !== '1:60:in_progress 2:0:pending') wrong.push(`after the log the stages are ${stageText(await stageRows(h, projectId))}, expected 1:60:in_progress 2:0:pending`);
  if (await projectStatus(h, projectId) !== 'in_progress') wrong.push(`after the log the project is ${await projectStatus(h, projectId)}, expected in_progress`);

  // the workshop panel of the schedule tab counts the same log
  const stage1 = await panelStage(h, projectId, stageIds[0]);
  if (stage1?.approvedQuantity !== 60 || stage1?.plannedQuantity !== 100 || stage1?.unit !== PIECES || stage1?.percent !== 60) {
    wrong.push(`the workshop panel shows ${JSON.stringify(stage1 ?? null)}, expected 60 of 100 pieces at 60%`);
  }

  // the whole row done: 99%, never 100% or completed without the tick, in the matrix and the workshop panel alike
  const full = await h.put(`/api/piecework/logs/${logId}`, { quantity: 100 });
  if (full.status !== 200) wrong.push(`raising the log to 100 answered ${brief(full)}`);
  if (stageText(await stageRows(h, projectId)) !== '1:99:in_progress 2:0:pending') wrong.push(`after the edit the stages are ${stageText(await stageRows(h, projectId))}, expected 1:99:in_progress 2:0:pending`);
  if ((await progressView(h, projectId)).products[0]?.progress_percent !== 50) wrong.push('after the edit the product does not read 50%');
  if ((await panelStage(h, projectId, stageIds[0]))?.percent !== 99) wrong.push(`with the row done but not ticked the workshop panel reads ${(await panelStage(h, projectId, stageIds[0]))?.percent}%, expected 99%`);

  // deleting the log takes its work out of the stage; a started stage stays started (review H1: a log only starts)
  const removed = await h.del(`/api/piecework/logs/${logId}`);
  if (removed.status !== 200) wrong.push(`deleting the log answered ${brief(removed)}`);
  if (stageText(await stageRows(h, projectId)) !== '1:0:in_progress 2:0:pending') wrong.push(`after the delete the stages are ${stageText(await stageRows(h, projectId))}, expected 1:0:in_progress 2:0:pending`);
  if (cellOf(await progressView(h, projectId), 1)?.work?.done_quantity !== 0) wrong.push('after the delete the cell still counts the deleted log');

  // the row takes a new log, and only the tick completes the stage
  const again = await h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId, date: f.today, quantity: 100,
    scheduleRef: { stageId: stageIds[0], productId: 'prod-a', rowId: 'row-a' },
  });
  if (again.status !== 201) wrong.push(`logging the freed row again answered ${brief(again)}`);
  const ticked = await h.put(`/api/projects/${projectId}/product-progress`, { items: [{ item_id: item, stage_order: 1, status: 'completed' }] });
  if (ticked.status !== 200) wrong.push(`ticking the cell answered ${brief(ticked)}`);
  if (stageText(await stageRows(h, projectId)) !== '1:100:completed 2:0:pending') wrong.push(`after the tick the stages are ${stageText(await stageRows(h, projectId))}, expected 1:100:completed 2:0:pending`);
  if ((await panelStage(h, projectId, stageIds[0]))?.percent !== 100) wrong.push('after the tick the workshop panel does not read 100%');

  // moving the log to another project takes its work out of this project's cell; the tick stays
  const [other] = await h.q(`INSERT INTO production_projects (project_code, title) VALUES ($1, $2) RETURNING id`, [unique('D6O'), unique('D6 other')]);
  const againId = Number((again.body as { insertedIds?: number[] }).insertedIds?.[0]);
  const moved = await h.put(`/api/piecework/logs/${againId}`, { projectId: Number(other.id) });
  if (moved.status !== 200) wrong.push(`moving the log to another project answered ${brief(moved)}`);
  const afterMove = await progressView(h, projectId);
  if (cellOf(afterMove, 1)?.work?.done_quantity !== 0) wrong.push(`after the move the cell counts ${JSON.stringify(cellOf(afterMove, 1)?.work ?? null)}, expected 0`);
  if (stageText(await stageRows(h, projectId)) !== '1:100:completed 2:0:pending') wrong.push('the move changed the ticked stage, which only the tick decides');
  return 'schedule work counted in the matrix cell, the stage and the project; edit, delete and move re-synced in their transactions';
}

async function mainItemCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(0);
  const task = await newTaskId(h);
  const workerSession = await h.sessionWith(['workshop.self']);
  const worker = await newWorker('D6 main worker');
  await h.q(`UPDATE personnel SET user_id = $2 WHERE id = $1`, [worker, workerSession.userId]);
  const manager = await h.sessionWith(['workshop.review', 'projects.view']);
  const { projectId, stageIds } = await scheduledProject(h, {
    products: [],
    itemId: item,
    productKey: 'prod-main',
    rows: [{ stage: 1, row: { id: 'row-m', taskId: task, taskTitle: 'برش D6', assignedPersonnelId: worker, quantity: 40, unit: PIECES } }],
  });
  await h.q(`INSERT INTO project_managers (project_id, user_id) VALUES ($1, $2)`, [projectId, manager.userId]);

  const submitted = await h.post('/api/workshop/reports', { projectId, stageId: stageIds[0], productId: 'prod-main', rowId: 'row-m', quantity: 30 }, workerSession);
  const report = (submitted.body as { report?: { id: number; version: number } }).report;
  if (submitted.status !== 201 || !report) throw new Error(`setup: the report answered ${brief(submitted)}`);
  const approved = await h.post(`/api/workshop/reports/${report.id}/approve`, { version: report.version }, manager);
  if (approved.status !== 200) throw new Error(`setup: the approval answered ${brief(approved)}`);
  const suggestion = (approved.body as { matrixTickSuggestion?: { itemId?: number | null } }).matrixTickSuggestion;
  if (suggestion?.itemId !== item) wrong.push(`the tick suggestion names item ${JSON.stringify(suggestion?.itemId ?? null)}, expected the project's main item ${item}`);

  const view = await progressView(h, projectId);
  const work = cellOf(view, 1)?.work;
  if (view.products[0]?.item_id !== item || work?.done_quantity !== 30 || work?.planned_quantity !== 40) {
    wrong.push(`the main item's cell carries ${JSON.stringify(work ?? null)}, expected 30 of 40`);
  }
  if (stageText(await stageRows(h, projectId)) !== '1:75:in_progress 2:0:pending') wrong.push(`after the approval the stages are ${stageText(await stageRows(h, projectId))}, expected 1:75:in_progress 2:0:pending`);
  if (await projectStatus(h, projectId) !== 'in_progress') wrong.push(`after the approval the project is ${await projectStatus(h, projectId)}, expected in_progress`);

  // a project without a progress matrix (no warehouse item): its stages and status stay the stage form's
  const plain = await scheduledProject(h, {
    products: [{ id: 'prod-a', item_name: 'D6 plain', item_code: '', quantity: 1, unit: 'عدد' }],
    productKey: 'prod-a',
    rows: [{ stage: 1, row: { id: 'row-p', taskId: task, taskTitle: 'برش D6', assignedPersonnelId: worker, quantity: 5, unit: PIECES } }],
  });
  await h.q(`UPDATE project_stages SET progress_percent = 100, status = 'completed' WHERE project_id = $1`, [plain.projectId]);
  const plainLog = await h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId: plain.projectId, date: f.today, quantity: 5,
    scheduleRef: { stageId: plain.stageIds[0], productId: 'prod-a', rowId: 'row-p' },
  });
  if (plainLog.status !== 201) wrong.push(`logging a row of a project without a matrix answered ${brief(plainLog)} (${codeOf(plainLog)})`);
  if (await projectStatus(h, plain.projectId) !== 'planned') wrong.push(`a log moved a project without a matrix to ${await projectStatus(h, plain.projectId)}, expected planned`);
  return 'the single-item schedule counts in the matrix, the approval syncs the stage, and a project without a matrix is left alone';
}

/**
 * the project's status and its stage rows with their completion times as one comparable string (not the version: the
 * schedule link itself writes the log id into the project row, TD-736)
 */
async function projectState(h: Harness, projectId: number): Promise<string> {
  const [project] = await h.q(`SELECT status FROM production_projects WHERE id = $1`, [projectId]);
  const stages = await h.q(`SELECT stage_order, progress_percent, status, completed_at FROM project_stages WHERE project_id = $1 AND is_deleted = 0 ORDER BY stage_order`, [projectId]);
  return `${project?.status} ${stages.map(r => `${r.stage_order}:${Number(r.progress_percent)}:${r.status}:${r.completed_at || '-'}`).join(' ')}`;
}

const DONE_AT = '2026-10-01T08:00:00.000Z';

async function closedProjectCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(0);
  const task = await newTaskId(h);
  const worker = await newWorker('D6 closed worker');
  const row = (id: string): ScheduleRow => ({ id, taskId: task, taskTitle: 'برش D6', assignedPersonnelId: worker, quantity: 10, unit: PIECES });
  const scheduled = () => scheduledProject(h, {
    products: [{ id: 'prod-a', item_id: item, item_code: '', item_name: 'D6 product', quantity: 10, unit: 'عدد' }],
    productKey: 'prod-a',
    rows: [{ stage: 1, row: row('row-a') }, { stage: 2, row: row('row-b') }],
  });
  const logRow = (projectId: number, stageId: number, rowId: string, quantity: number) => h.post('/api/piecework/logs', {
    personnelId: worker, taskId: task, projectId, date: f.today, quantity, scheduleRef: { stageId, productId: 'prod-a', rowId },
  });
  const idOf = (res: { body?: unknown }) => Number((res.body as { insertedIds?: number[] }).insertedIds?.[0]);

  // a completed project whose matrix was never ticked in full (common before TD-739 / TD-758): create, edit and delete
  // of a linked log leave its status, its stages and their completion times as they are
  const done = await scheduled();
  await h.q(`UPDATE production_projects SET status = 'completed' WHERE id = $1`, [done.projectId]);
  await h.q(`UPDATE project_stages SET progress_percent = 100, status = 'completed', completed_at = $2 WHERE project_id = $1`, [done.projectId, DONE_AT]);
  const doneBefore = await projectState(h, done.projectId);
  const created = await logRow(done.projectId, done.stageIds[0], 'row-a', 10);
  if (created.status !== 201) wrong.push(`logging a row of a completed project answered ${brief(created)}`);
  if (await projectState(h, done.projectId) !== doneBefore) wrong.push(`a new log changed the completed project: ${await projectState(h, done.projectId)}, expected ${doneBefore}`);
  const edited = await h.put(`/api/piecework/logs/${idOf(created)}`, { quantity: 9 });
  if (edited.status !== 200) wrong.push(`editing the log answered ${brief(edited)}`);
  if (await projectState(h, done.projectId) !== doneBefore) wrong.push(`a log edit reopened the completed project: ${await projectState(h, done.projectId)}, expected ${doneBefore}`);
  const deleted = await h.del(`/api/piecework/logs/${idOf(created)}`);
  if (deleted.status !== 200) wrong.push(`deleting the log answered ${brief(deleted)}`);
  if (await projectState(h, done.projectId) !== doneBefore) wrong.push(`a log delete changed the completed project: ${await projectState(h, done.projectId)}, expected ${doneBefore}`);

  // a running project: its completed stage keeps its percent, status and time; a blocked stage takes the percent and
  // stays blocked; the project stays as it is
  const running = await scheduled();
  await h.q(`UPDATE production_projects SET status = 'in_progress' WHERE id = $1`, [running.projectId]);
  await h.q(`UPDATE project_stages SET progress_percent = 100, status = 'completed', completed_at = $2 WHERE id = $1`, [running.stageIds[0], DONE_AT]);
  await h.q(`UPDATE project_stages SET status = 'blocked' WHERE id = $1`, [running.stageIds[1]]);
  const first = await logRow(running.projectId, running.stageIds[0], 'row-a', 5);
  const second = await logRow(running.projectId, running.stageIds[1], 'row-b', 5);
  if (first.status !== 201 || second.status !== 201) wrong.push(`logging the running project answered ${brief(first)} / ${brief(second)}`);
  const edit = await h.put(`/api/piecework/logs/${idOf(first)}`, { quantity: 4 });
  if (edit.status !== 200) wrong.push(`editing the running project's log answered ${brief(edit)}`);
  const expected = `in_progress 1:100:completed:${DONE_AT} 2:50:blocked:-`;
  if (await projectState(h, running.projectId) !== expected) wrong.push(`the running project reads ${await projectState(h, running.projectId)}, expected ${expected}`);

  // a paused project is left alone
  const paused = await scheduled();
  await h.q(`UPDATE production_projects SET status = 'paused' WHERE id = $1`, [paused.projectId]);
  const pausedBefore = await projectState(h, paused.projectId);
  const pausedLog = await logRow(paused.projectId, paused.stageIds[0], 'row-a', 5);
  if (pausedLog.status !== 201) wrong.push(`logging a row of a paused project answered ${brief(pausedLog)}`);
  if (await projectState(h, paused.projectId) !== pausedBefore) wrong.push(`a log changed the paused project: ${await projectState(h, paused.projectId)}, expected ${pausedBefore}`);
  return 'a work log left completed and paused projects, a completed stage and a blocked stage as they were';
}
