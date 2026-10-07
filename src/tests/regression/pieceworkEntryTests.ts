import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, pieceworkPersonnelRates, pieceworkTasks, productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { PieceworkService } from '../../services/piecework.service.js';
import { newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Package 12 payroll, PR «ب»: work logs, piecework rates and their audit on real Express routes and PostgreSQL. Each
 * scenario runs in its own isolated schema and is red on the version before its fix.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-6)}${++seq}`;
const brief = (body: unknown) => JSON.stringify(body).slice(0, 200);
const codeOf = (err: unknown) => String((err as { code?: string } | undefined)?.code ?? '');
const statusOf = (err: unknown) => Number((err as { statusCode?: number } | undefined)?.statusCode ?? 0);

async function logCount(personnelId: number): Promise<number> {
  const res = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [personnelId]);
  return Number(res.rows[0]?.n ?? 0);
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'accepted';
  } catch (err) {
    return `${statusOf(err)} ${codeOf(err)}`;
  }
}

/** A project whose workshop schedule (stage 1, product «prod-main») holds the given rows */
async function scheduledProject(rows: Array<{ id: string; taskId: number; personnelId: number; quantity: number }>): Promise<number> {
  const tasks = rows.map(r => ({ id: r.id, taskId: r.taskId, taskTitle: 'schedule row', assignedPersonnelId: r.personnelId, quantity: r.quantity, status: 'pending' }));
  const [row] = await orm.insert(productionProjects).values({
    projectCode: tag('PRJ-PW'), title: tag('piecework schedule project '),
    stageSchedules: { 1: { 'prod-main': { productId: 'prod-main', assignedPersonnel: [], tasks } } },
  }).returning({ id: productionProjects.id });
  return row.id;
}

async function rateTask(rate: number): Promise<number> {
  const [row] = await orm.insert(pieceworkTasks).values({ code: tag('PTR'), title: tag('rated task '), defaultRate: money(rate) }).returning({ id: pieceworkTasks.id });
  return row.id;
}

async function taskByTitle(title: string) {
  const [row] = await orm.select().from(pieceworkTasks).where(and(eq(pieceworkTasks.title, title), eq(pieceworkTasks.isDeleted, 0)));
  return row;
}

export async function runPieceworkEntryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const rateId = 'reg_piecework_task_rate_non_negative_td_813';
  if (shouldRun(rateId, 'td813', 'piecework', 'package12')) {
    await runCase(results, rateId, 'v9.0.235: a piecework task base rate is a non-negative number in the form, the API, the service and the Excel import; a text or negative rate is refused (400 / 422 PIECEWORK_RATE_INVALID) and an Excel row with one is listed in the import errors (TD-813)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();

      // 1) create: «abc» was saved as 0 and «-1000» as −1,000
      for (const defaultRate of ['abc', '-1000', -1]) {
        const title = tag('TD-813 refused ');
        const res = await admin.post('/api/piecework/tasks', { title, defaultRate });
        if (res.status !== 400) problems.push(`create with rate ${JSON.stringify(defaultRate)} answered ${res.status} ${brief(res.body)}, expected 400`);
        if (await taskByTitle(title)) problems.push(`a task with rate ${JSON.stringify(defaultRate)} was saved`);
      }
      const goodTitle = tag('TD-813 good ');
      const good = await admin.post('/api/piecework/tasks', { title: goodTitle, defaultRate: '۲۵۰٬۰۰۰' });
      const goodRow = await taskByTitle(goodTitle);
      if (good.status !== 201 || !goodRow || !fin(goodRow.defaultRate ?? 0).equals(250000)) {
        problems.push(`create with 250,000 in Persian digits answered ${good.status}, stored ${goodRow?.defaultRate}, expected 201 and 250000`);
      }

      // 2) edit: a negative rate is refused and the stored rate stays
      if (goodRow) {
        const res = await admin.put(`/api/piecework/tasks/${goodRow.id}`, { defaultRate: '-1000' });
        if (res.status !== 400) problems.push(`edit with rate -1000 answered ${res.status} ${brief(res.body)}, expected 400`);
        const after = await taskByTitle(goodTitle);
        if (!after || !fin(after.defaultRate ?? 0).equals(250000)) problems.push(`the rate became ${after?.defaultRate} after a refused edit`);
      }

      // 3) the service refuses a negative rate without the route schema
      try {
        await PieceworkService.createTask({ title: tag('TD-813 service '), defaultRate: '-5' });
        problems.push('the service accepted a negative base rate');
      } catch (err) {
        if (statusOf(err) !== 422 || codeOf(err) !== 'PIECEWORK_RATE_INVALID') problems.push(`the service refused a negative rate with ${statusOf(err)} ${codeOf(err)}, expected 422 PIECEWORK_RATE_INVALID`);
      }

      // 4) the Excel import: rows with a text or negative rate are not written and come back in `errors`
      const [negTitle, textTitle, okTitle] = [tag('TD-813 xl neg '), tag('TD-813 xl text '), tag('TD-813 xl ok ')];
      const imp = await admin.post('/api/piecework/tasks/import-excel', {
        rows: [{ title: negTitle, defaultRate: '-1000' }, { title: textTitle, 'نرخ پایه': 'abc' }, { title: okTitle, defaultRate: '5000' }],
      });
      const errors = Array.isArray(imp.body?.errors) ? imp.body.errors as Array<{ row: number }> : [];
      if (imp.status !== 200 || imp.body?.createdCount !== 1) problems.push(`import answered ${imp.status} ${brief(imp.body)}, expected 200 with one created task`);
      if (errors.map(e => e.row).join(',') !== '1,2') problems.push(`import errors listed rows ${errors.map(e => e.row).join(',') || 'none'}, expected 1,2`);
      if (await taskByTitle(negTitle)) problems.push('the Excel row with rate -1000 was saved');
      if (await taskByTitle(textTitle)) problems.push('the Excel row with rate «abc» was saved');
      const okRow = await taskByTitle(okTitle);
      if (!okRow || !fin(okRow.defaultRate ?? 0).equals(5000)) problems.push(`the valid Excel row stored ${okRow?.defaultRate}, expected 5000`);

      assertNoProblems(problems);
      return 'text and negative base rates are refused in the form, the service and the Excel import; valid rows are written';
    }));
  }

  const entryId = 'reg_piecework_log_entry_checked_td_812';
  if (shouldRun(entryId, 'td812', 'piecework', 'worklog', 'package12')) {
    await runCase(results, entryId, 'v9.0.236: a work log needs positive ids, a quantity above zero or hh:mm, a non-negative manual rate and live personnel, task and project, and a batch is saved whole or not at all (400 / 422 PIECEWORK_LOG_*) (TD-812)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const worker = await newWorker('TD-812 worker');
      const task = await newTask();
      const base = { personnelId: worker, taskId: task, date: '1405/06/10' };

      // 1) quantity: «-5» was saved with a negative amount shown as «۰», «abc» as 0
      for (const quantity of ['-5', 'abc', 0, '']) {
        const res = await admin.post('/api/piecework/logs', { ...base, quantity });
        if (res.status !== 400) problems.push(`quantity ${JSON.stringify(quantity)} answered ${res.status} ${brief(res.body)}, expected 400`);
      }
      const negativeRate = await admin.post('/api/piecework/logs', { ...base, quantity: 1, unitRate: '-100' });
      if (negativeRate.status !== 400) problems.push(`manual rate -100 answered ${negativeRate.status}, expected 400`);
      if (await logCount(worker) !== 0) problems.push(`${await logCount(worker)} logs were saved for refused rows`);
      const time = await admin.post('/api/piecework/logs', { ...base, quantity: '۱:۳۰', unitRate: 100000 });
      const [timeRow] = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.personnelId, worker), eq(pieceworkLogs.isDeleted, 0)));
      if (time.status !== 201 || !timeRow || timeRow.quantity !== 1.5 || !fin(timeRow.totalAmount).equals(150000)) {
        problems.push(`quantity 1:30 in Persian digits answered ${time.status}, stored ${timeRow?.quantity} / ${timeRow?.totalAmount}, expected 1.5 / 150000`);
      }

      // 2) personnel, task and project must exist and be live (a deleted personnel and id 987654 were accepted)
      const [gone] = await orm.insert(personnel).values({ fullName: tag('TD-812 deleted '), isDeleted: 1 }).returning({ id: personnel.id });
      const [goneTask] = await orm.insert(pieceworkTasks).values({ code: tag('PT812'), title: tag('TD-812 deleted task '), defaultRate: money(1), isDeleted: 1 }).returning({ id: pieceworkTasks.id });
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ['a deleted personnel', { ...base, personnelId: gone.id }, 'PIECEWORK_LOG_PERSONNEL_INVALID'],
        ['personnel 987654', { ...base, personnelId: 987654 }, 'PIECEWORK_LOG_PERSONNEL_INVALID'],
        ['a deleted task', { ...base, taskId: goneTask.id }, 'PIECEWORK_LOG_TASK_INVALID'],
        ['project 987654', { ...base, projectId: 987654 }, 'PIECEWORK_LOG_PROJECT_INVALID'],
      ];
      for (const [label, body, code] of cases) {
        const res = await admin.post('/api/piecework/logs', { ...body, quantity: 1 });
        if (res.status !== 422 || res.body?.code !== code) problems.push(`${label} answered ${res.status} ${brief(res.body)}, expected 422 ${code}`);
      }
      const [orphans] = (await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM piecework_logs WHERE personnel_id IN ($1, 987654) OR task_id = $2 OR project_id = 987654', [gone.id, goneTask.id])).rows;
      if (Number(orphans?.n ?? 0) !== 0) problems.push(`${orphans?.n} logs were saved for missing or deleted parents`);

      // 3) a batch of three whose third row has an invalid date: nothing is saved (two rows used to stay)
      const before = await logCount(worker);
      const batch = await admin.post('/api/piecework/logs', { items: [{ ...base, quantity: 1 }, { ...base, quantity: 2 }, { ...base, quantity: 3, date: '1405/07/31' }] });
      if (batch.status !== 422) problems.push(`the batch with a bad third date answered ${batch.status}, expected 422`);
      if (await logCount(worker) !== before) problems.push(`the refused batch saved ${await logCount(worker) - before} rows`);

      // 4) the service checks the same without the route schema, and so does editing a log
      const direct = await refusal(() => PieceworkService.logWorkEntries([{ ...base, quantity: -5 }]));
      if (direct !== '422 PIECEWORK_LOG_INVALID') problems.push(`the service answered a quantity of -5 with ${direct}, expected 422 PIECEWORK_LOG_INVALID`);
      if (timeRow) {
        const edit = await admin.put(`/api/piecework/logs/${timeRow.id}`, { quantity: '-5' });
        if (edit.status !== 400) problems.push(`editing a log to quantity -5 answered ${edit.status}, expected 400`);
        const editDirect = await refusal(() => PieceworkService.updateWorkLog(timeRow.id, { quantity: 0 }));
        if (editDirect !== '422 PIECEWORK_LOG_INVALID') problems.push(`the service edited a log to quantity 0 with ${editDirect}, expected 422 PIECEWORK_LOG_INVALID`);
        const editProject = await refusal(() => PieceworkService.updateWorkLog(timeRow.id, { projectId: 987654 }));
        if (editProject !== '422 PIECEWORK_LOG_PROJECT_INVALID') problems.push(`editing a log to project 987654 answered ${editProject}, expected 422 PIECEWORK_LOG_PROJECT_INVALID`);
      }

      assertNoProblems(problems);
      return 'bad quantities, rates, ids and dead parents are refused, a bad row refuses its whole batch, and edits follow the same rules';
    }));
  }

  const scheduleRateId = 'reg_schedule_log_rate_from_server_td_735';
  if (shouldRun(scheduleRateId, 'td735', 'piecework', 'schedule', 'package11', 'package12')) {
    await runCase(results, scheduleRateId, 'v9.0.237: a work log posted from the project workshop schedule takes its rate from the server (the personnel custom rate, else the task base rate) and ignores the rate it sends, even for a user who may set rates (TD-735)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const task = await rateTask(50_000);
      const [plain, special] = [await newWorker('TD-735 plain'), await newWorker('TD-735 special')];
      await orm.insert(pieceworkPersonnelRates).values({ personnelId: special, taskId: task, customRate: money(60_000) });
      const project = await scheduledProject([
        { id: 'row-plain', taskId: task, personnelId: plain, quantity: 10 },
        { id: 'row-special', taskId: task, personnelId: special, quantity: 10 },
      ]);
      const item = (personnelId: number, rowId: string) => ({
        personnelId, taskId: task, projectId: project, date: '1405/06/10', quantity: 10, unitRate: 0,
        scheduleRef: { stageId: 1, productId: 'prod-main', rowId },
      });

      // the schedule tab sent rate 0 (it read `default_rate`, which the server never sends) and the admin's rate was kept
      const res = await admin.post('/api/piecework/logs', { items: [item(plain, 'row-plain'), item(special, 'row-special')] });
      if (res.status !== 201) problems.push(`the schedule logs answered ${res.status} ${brief(res.body)}`);
      for (const [personnelId, rate] of [[plain, 50_000], [special, 60_000]] as const) {
        const [log] = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.personnelId, personnelId), eq(pieceworkLogs.isDeleted, 0)));
        if (!log || !fin(log.unitRate).equals(rate) || !fin(log.totalAmount).equals(rate * 10)) {
          problems.push(`a schedule log stored rate ${log?.unitRate} and amount ${log?.totalAmount}, expected ${rate} and ${rate * 10}`);
        }
      }

      // a manual log outside the schedule still takes the rate a rate manager gives (TD-300)
      const manual = await newWorker('TD-735 manual');
      const man = await admin.post('/api/piecework/logs', { personnelId: manual, taskId: task, date: '1405/06/10', quantity: 2, unitRate: 70_000 });
      const [manLog] = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.personnelId, manual), eq(pieceworkLogs.isDeleted, 0)));
      if (man.status !== 201 || !manLog || !fin(manLog.unitRate).equals(70_000)) problems.push(`a manual log with rate 70,000 answered ${man.status} and stored ${manLog?.unitRate}`);

      assertNoProblems(problems);
      return 'schedule logs take the custom or base rate from the server; manual logs keep a rate manager\'s rate';
    }));
  }

  const scheduleOnceId = 'reg_schedule_row_logged_once_td_736';
  if (shouldRun(scheduleOnceId, 'td736', 'piecework', 'schedule', 'package11', 'package12')) {
    await runCase(results, scheduleOnceId, 'v9.0.238: a workshop schedule row is logged to piecework once; the server writes the log id into the row, refuses a second or concurrent log of it with 409, refuses a missing or mismatched row with 422, keeps the link when the browser saves the schedule, and frees the row when its log is deleted or moved (TD-736)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const task = await rateTask(40_000);
      const [w1, w2, w3, w4] = [await newWorker('TD-736 one'), await newWorker('TD-736 two'), await newWorker('TD-736 three'), await newWorker('TD-736 four')];
      const project = await scheduledProject([
        { id: 'row-a', taskId: task, personnelId: w1, quantity: 5 },
        { id: 'row-b', taskId: task, personnelId: w2, quantity: 5 },
        { id: 'row-c', taskId: task, personnelId: w3, quantity: 5 },
      ]);
      const item = (personnelId: number, rowId: string) => ({
        personnelId, taskId: task, projectId: project, date: '1405/06/12', quantity: 5,
        scheduleRef: { stageId: 1, productId: 'prod-main', rowId },
      });
      const rowOf = async (rowId: string) => {
        const [p] = await orm.select({ s: productionProjects.stageSchedules }).from(productionProjects).where(eq(productionProjects.id, project));
        const tasks = ((p?.s as Record<string, Record<string, { tasks?: Array<Record<string, unknown>> }>> | null)?.['1']?.['prod-main']?.tasks) ?? [];
        return tasks.find(t => t.id === rowId);
      };

      // 1) the first log of row A is saved and its id is written into the row (the flag used to live only in the browser)
      const first = await admin.post('/api/piecework/logs', { items: [item(w1, 'row-a')] });
      const firstId = Number(first.body?.insertedIds?.[0]);
      if (first.status !== 201 || !Number.isInteger(firstId)) problems.push(`the first log of row A answered ${first.status} ${brief(first.body)}, expected 201 with insertedIds`);
      const linked = await rowOf('row-a');
      if (Number(linked?.pieceworkLogId) !== firstId) problems.push(`row A holds log id ${String(linked?.pieceworkLogId)}, expected ${firstId}`);

      // 2) logging row A again (the tab reopened) is refused and pays nothing twice
      const again = await admin.post('/api/piecework/logs', { items: [item(w1, 'row-a')] });
      if (again.status !== 409 || again.body?.code !== 'PIECEWORK_SCHEDULE_ROW_LOGGED') problems.push(`a second log of row A answered ${again.status} ${brief(again.body)}, expected 409 PIECEWORK_SCHEDULE_ROW_LOGGED`);
      if (await logCount(w1) !== 1) problems.push(`row A has ${await logCount(w1)} logs, expected 1`);

      // 3) two concurrent logs of row B: exactly one is saved
      const outcomes = await Promise.allSettled([PieceworkService.logWorkEntries([item(w2, 'row-b')]), PieceworkService.logWorkEntries([item(w2, 'row-b')])]);
      const saved = outcomes.filter(o => o.status === 'fulfilled').length;
      const refused = outcomes.filter(o => o.status === 'rejected' && codeOf(o.reason) === 'PIECEWORK_SCHEDULE_ROW_LOGGED').length;
      if (saved !== 1 || refused !== 1 || await logCount(w2) !== 1) problems.push(`two concurrent logs of row B: ${saved} saved, ${refused} refused, ${await logCount(w2)} logs, expected 1 / 1 / 1`);

      // 4) a row the saved schedule does not hold, or one with another personnel, is refused (422) and saves nothing
      const missing = await admin.post('/api/piecework/logs', { items: [item(w4, 'row-z')] });
      if (missing.status !== 422 || missing.body?.code !== 'PIECEWORK_SCHEDULE_ROW_NOT_FOUND') problems.push(`a missing row answered ${missing.status} ${brief(missing.body)}, expected 422 PIECEWORK_SCHEDULE_ROW_NOT_FOUND`);
      const mismatch = await admin.post('/api/piecework/logs', { items: [item(w4, 'row-c')] });
      if (mismatch.status !== 422 || mismatch.body?.code !== 'PIECEWORK_SCHEDULE_ROW_MISMATCH') problems.push(`row C with another personnel answered ${mismatch.status} ${brief(mismatch.body)}, expected 422 PIECEWORK_SCHEDULE_ROW_MISMATCH`);
      if (await logCount(w4) !== 0) problems.push(`refused schedule rows saved ${await logCount(w4)} logs`);

      // 5) saving the schedule from the browser neither drops nor forges a link
      const [before] = await orm.select({ s: productionProjects.stageSchedules }).from(productionProjects).where(eq(productionProjects.id, project));
      const sent = JSON.parse(JSON.stringify(before?.s ?? {})) as Record<string, Record<string, { tasks: Array<Record<string, unknown>> }>>;
      for (const t of sent['1']['prod-main'].tasks) {
        if (t.id === 'row-a') delete t.pieceworkLogId;
        if (t.id === 'row-c') t.pieceworkLogId = firstId;
      }
      sent['1']['prod-main'].tasks.push({ id: 'row-d', taskId: task, taskTitle: 'schedule row', assignedPersonnelId: w4, quantity: 1, isLoggedToPiecework: true });
      const put = await admin.put(`/api/projects/${project}`, { stage_schedules: sent });
      if (put.status !== 200) problems.push(`saving the schedule answered ${put.status} ${brief(put.body)}`);
      const [rowA, rowC, rowD] = [await rowOf('row-a'), await rowOf('row-c'), await rowOf('row-d')];
      if (Number(rowA?.pieceworkLogId) !== firstId) problems.push(`saving the schedule without row A's link left ${String(rowA?.pieceworkLogId)}, expected ${firstId}`);
      if (rowC?.pieceworkLogId !== undefined || rowD?.isLoggedToPiecework !== undefined) problems.push(`the browser forged links: row C ${String(rowC?.pieceworkLogId)}, row D ${String(rowD?.isLoggedToPiecework)}`);
      const rowCLog = await admin.post('/api/piecework/logs', { items: [item(w3, 'row-c')] });
      if (rowCLog.status !== 201) problems.push(`row C after a forged link answered ${rowCLog.status} ${brief(rowCLog.body)}, expected 201`);

      // 6) deleting row A's log frees the row; moving row C's log to another project frees row C
      const del = await admin.del(`/api/piecework/logs/${firstId}`);
      if (del.status !== 200) problems.push(`deleting row A's log answered ${del.status} ${brief(del.body)}`);
      if ((await rowOf('row-a'))?.pieceworkLogId !== undefined) problems.push('row A kept the link of its deleted log');
      const relog = await admin.post('/api/piecework/logs', { items: [item(w1, 'row-a')] });
      if (relog.status !== 201) problems.push(`row A after its log was deleted answered ${relog.status} ${brief(relog.body)}, expected 201`);
      const rowCLogId = Number(rowCLog.body?.insertedIds?.[0]);
      if (Number.isInteger(rowCLogId)) {
        const other = await scheduledProject([]);
        await PieceworkService.updateWorkLog(rowCLogId, { projectId: other });
        if ((await rowOf('row-c'))?.pieceworkLogId !== undefined) problems.push('row C kept the link of a log moved to another project');
      }

      assertNoProblems(problems);
      return 'each schedule row holds its log id from the server, is logged once (also concurrently), and is free again when its log is deleted or moved';
    }));
  }

  return results;
}
