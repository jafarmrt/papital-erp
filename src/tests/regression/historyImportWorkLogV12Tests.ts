import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, pieceworkPayrolls, pieceworkTasks, productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import type { WorkLogImportResult, WorkLogImportRow } from '../../lib/historyImport/workLogImport.js';
import { closeHistoryImport } from '../../services/historyImport/historyImportClose.service.js';
import { WORK_LOG_AUDIT_ENTITY } from '../../services/piecework/pieceworkAudit.js';
import { addLog, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v12 work-log import (start plan V12_WORKLOG_IMPORT_START_PLAN.md): the colleagues' work of the sheet «کارکرد و پروژه»
 * posted at once through the service of the hand entry. Real Express routes and services on PostgreSQL, each scenario in
 * its own schema. Red before this change: the route did not exist (404).
 */

const URL = '/api/piecework/logs/history-import';
// 1405-02 runs from 2026-04-21 to its last day, 31 Ordibehesht = 2026-05-21; 1405-01 ends on 2026-04-20
const ORDIBEHESHT_LAST = '2026-05-21';

type Client = Awaited<ReturnType<typeof sandboxAdminClient>>;
type Res = { status: number; body?: unknown };
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 300)}`;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const footprint = async () => ({
  logs: await count(sql`SELECT count(*)::int AS n FROM piecework_logs`),
  audit: await count(sql`SELECT count(*)::int AS n FROM activity_logs`),
});
const sameFootprint = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k} ${a[k]} -> ${b[k]}`);

const post = async (client: Client, rows: WorkLogImportRow[], commit: boolean) => {
  const res = await client.post(URL, { commit, rows });
  if (commit && res.status === 409 && res.body?.code === 'HISTORY_IMPORT_NOT_POSTED') return res.body.details as WorkLogImportResult;
  if (res.status !== 200) throw new Error(`the import (${commit ? 'post' : 'preview'}) returned ${brief(res)}`);
  return res.body as WorkLogImportResult;
};
const rowOf = (result: WorkLogImportResult, rowNo: number) => result.rows.find(r => r.rowNo === rowNo);

async function taskWithRate(rate: number, unit = 'عدد'): Promise<number> {
  const id = await newTask();
  await orm.update(pieceworkTasks).set({ defaultRate: money(rate), unit }).where(eq(pieceworkTasks.id, id));
  return id;
}

async function newProject(): Promise<number> {
  const [row] = await orm.insert(productionProjects).values({ projectCode: `WLI${Date.now() % 1_000_000}`, title: 'پروژه آزمون ورود کارکرد' }).returning({ id: productionProjects.id });
  return row.id;
}

export async function runHistoryImportWorkLogV12Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const posting = 'reg_history_import_work_logs_v12';
  if (shouldRun(posting, 'v12', 'history_import', 'piecework', 'payroll')) {
    await runCase(results, posting, 'v12 work-log import: a preview of a month\'s work from Excel runs every row through the hand entry and keeps nothing (no log, no audit row); the post records free work logs dated on the month\'s last day with the sheet\'s rate, its notes and project (none for the no-project name), sums each colleague\'s month, warns on another rate than the program\'s or a total unlike the sheet\'s, and the month\'s payslip takes them', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const worker = await newWorker('همکار آزمون ورود کارکرد');
      const other = await newWorker('همکار دوم آزمون ورود کارکرد');
      const piece = await taskWithRate(100_000);
      const hourly = await taskWithRate(500_000, 'ساعت');
      const project = await newProject();
      // the second colleague's work of 5 Ordibehesht is already in the books by hand
      await addLog(other, piece, '2026-04-25', 450_000);
      const rows: WorkLogImportRow[] = [
        { rowNo: 2, month: '1405-02', personnelId: worker, taskId: piece, projectId: project, quantity: '103', unitRate: '100000', excelTotal: '10300000', notes: 'سفارش الف (ورود از اکسل، ردیف حقوق 41)' },
        // another rate than the program's: recorded at the sheet's rate, with a warning
        { rowNo: 3, month: '1405-02', personnelId: worker, taskId: hourly, projectId: null, quantity: '2.5', unitRate: '600000', excelTotal: '1500000' },
        // 80 minutes as Excel holds them: quantity × rate is the sheet's «جمع», not a figure cut to four decimals
        { rowNo: 5, month: '1405-02', personnelId: other, taskId: hourly, projectId: null, quantity: '1.3333333333', unitRate: '600000', excelTotal: '800000' },
        // a typo in «جمع» (1031 × rate): a warning, quantity × rate is recorded
        { rowNo: 4, month: '1405-02', personnelId: other, taskId: piece, projectId: null, quantity: '3', unitRate: '100000', excelTotal: '3100000' },
      ];

      const before = await footprint();
      const preview = await post(admin, rows, false);
      const moved = sameFootprint(before, await footprint());
      if (preview.committed || preview.okCount !== 4) problems.push(`the preview read ${JSON.stringify(preview).slice(0, 600)}, expected four rows ok and nothing committed`);
      if (moved.length > 0) problems.push(`the preview left a trace: ${moved.join(', ')}`);
      if (rowOf(preview, 2)?.date !== ORDIBEHESHT_LAST) problems.push(`the preview dates row 2 on ${rowOf(preview, 2)?.date}, expected ${ORDIBEHESHT_LAST} (31 Ordibehesht)`);
      if (!rowOf(preview, 3)?.warnings?.some(w => w.includes('نرخ کنونی برنامه'))) problems.push(`row 3 (another rate) reads ${JSON.stringify(rowOf(preview, 3))}, expected a rate warning`);
      if (!rowOf(preview, 4)?.warnings?.some(w => w.includes('جمع اکسل'))) problems.push(`row 4 (a total unlike the sheet's) reads ${JSON.stringify(rowOf(preview, 4))}, expected a total warning`);
      if (rowOf(preview, 2)?.warnings?.length) problems.push(`row 2 (the program's rate, the right total) warns: ${JSON.stringify(rowOf(preview, 2)?.warnings)}`);
      const total = preview.totals.find(t => t.personnelId === worker && t.month === '1405-02');
      if (!total || total.rows !== 2 || !fin(total.amount).equals(11_800_000) || total.bookedRows !== 0) problems.push(`the colleague's month sums to ${JSON.stringify(total)}, expected two rows, 11,800,000 and nothing booked before`);
      const otherTotal = preview.totals.find(t => t.personnelId === other);
      if (otherTotal?.bookedRows !== 1 || !fin(otherTotal.bookedAmount).equals(450_000)) problems.push(`the second colleague's month reads ${JSON.stringify(otherTotal)}, expected his hand log of 5 Ordibehesht (450,000) named as booked in the month`);

      const posted = await post(admin, rows, true);
      if (!posted.committed || posted.okCount !== 4) problems.push(`the post read ${JSON.stringify(posted).slice(0, 600)}, expected four rows committed`);
      const logs = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.isDeleted, 0), sql`${pieceworkLogs.personnelId} IN (${worker}, ${other})`, eq(pieceworkLogs.date, ORDIBEHESHT_LAST)));
      if (logs.length !== 4) problems.push(`the post made ${logs.length} work logs, expected 4`);
      for (const log of logs) {
        if (log.status !== 'pending' || log.payrollId !== null || log.date !== ORDIBEHESHT_LAST || log.dateIso !== ORDIBEHESHT_LAST) problems.push(`log ${log.id} reads status ${log.status}, payslip ${log.payrollId}, date ${log.date}/${log.dateIso}; expected a free log on ${ORDIBEHESHT_LAST}`);
      }
      if (rowOf(preview, 5)?.warnings?.some(w => w.includes('جمع اکسل'))) problems.push(`row 5 (80 minutes, the sheet's total) warns on its total: ${JSON.stringify(rowOf(preview, 5)?.warnings)}`);
      const minutesLog = logs.find(l => l.personnelId === other && l.taskId === hourly);
      if (!minutesLog || !fin(minutesLog.totalAmount).round(0).equals(800_000)) problems.push(`the 80-minute log reads ${JSON.stringify(minutesLog)}, expected 800,000 as in the sheet`);
      const hourLog = logs.find(l => l.taskId === hourly && l.personnelId === worker);
      if (!hourLog || !fin(hourLog.unitRate).equals(600_000) || !fin(hourLog.totalAmount).equals(1_500_000) || hourLog.projectId !== null) problems.push(`the hourly log reads ${JSON.stringify(hourLog)}, expected the sheet's rate 600,000, 1,500,000 and no project`);
      const pieceLog = logs.find(l => l.personnelId === worker && l.taskId === piece);
      if (pieceLog?.projectId !== project || !String(pieceLog?.notes).includes('ردیف حقوق 41')) problems.push(`the piece log reads ${JSON.stringify(pieceLog)}, expected its project and notes`);
      const audits = await count(sql`SELECT count(*)::int AS n FROM activity_logs WHERE entity = ${WORK_LOG_AUDIT_ENTITY} AND action = 'CREATE'`);
      if (audits < 4) problems.push(`the post wrote ${audits} work-log audit rows, expected one per log`);

      // the month's payslip takes the imported work
      const slip = await issueApproved({ personnelId: worker, startDate: '2026-04-21', endDate: ORDIBEHESHT_LAST, username: 'inv' });
      if (!slip.payroll) problems.push(`the month's payslip was refused: ${slip.refusal?.message}`);
      else {
        const [issued] = await orm.select({ piece: pieceworkPayrolls.totalPieceworkAmount }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, slip.payroll.id));
        if (!fin(issued?.piece ?? 0).equals(11_800_000)) problems.push(`the month's payslip counts ${issued?.piece} of work, expected 11,800,000 (the imported rows)`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a preview keeps nothing; the post records free logs on the month\'s last day at the sheet\'s rate, and the payslip takes them';
    }));
  }

  const refusing = 'reg_history_import_work_logs_refusals_v12';
  if (shouldRun(refusing, 'v12', 'history_import', 'piecework', 'payroll')) {
    await runCase(results, refusing, 'v12 work-log import: a colleague with a payslip for the month gets none of its rows, an unreadable quantity or rate is refused, one refused row posts nothing; a row like one in the file or the books waits until accepted; a colleague who left in the month is dated on the last day of service; the import needs its own key and the hand entry\'s, another rate than the program\'s needs the rates key; the history-import close does not close it', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const worker = await newWorker('همکار آزمون رد ورود کارکرد');
      const piece = await taskWithRate(100_000);
      // Farvardin is already on an approved payslip
      await addLog(worker, piece, '2026-04-05', 900_000);
      const farvardin = await issueApproved({ personnelId: worker, startDate: '2026-03-21', endDate: '2026-04-20', username: 'inv' });
      if (!farvardin.payroll) throw new Error(`setup: the Farvardin payslip was refused (${farvardin.refusal?.message})`);
      const row = (rowNo: number, extra: Partial<WorkLogImportRow> = {}): WorkLogImportRow => ({
        rowNo, month: '1405-02', personnelId: worker, taskId: piece, projectId: null, quantity: '1', unitRate: '100000', ...extra,
      });

      const before = await footprint();
      const refused = await post(admin, [row(2), row(3, { month: '1405-01' }), row(4, { quantity: 'abc' }), row(5, { unitRate: '' }), row(6, { quantity: '-2' })], true);
      if (refused.committed) problems.push('a file with refused rows was posted');
      const refusedWith = (rowNo: number, label: string, part: string) => {
        const r = rowOf(refused, rowNo);
        if (r?.status !== 'error' || !String(r?.message).includes(part)) problems.push(`${label}: row ${rowNo} reads ${JSON.stringify(r)}, expected an error naming «${part}»`);
      };
      if (rowOf(refused, 2)?.status !== 'ok') problems.push(`the good row reads ${JSON.stringify(rowOf(refused, 2))}`);
      refusedWith(3, 'a month already on a payslip', 'فیش حقوق');
      refusedWith(4, 'an unreadable quantity', 'تعداد یا ساعت');
      refusedWith(5, 'an empty rate', 'فی');
      refusedWith(6, 'a negative quantity', 'تعداد یا ساعت');
      const moved = sameFootprint(before, await footprint());
      if (moved.length > 0) problems.push(`a refused post left a trace: ${moved.join(', ')}`);

      // duplicates: two equal rows of the file, then the same file again after it was posted
      const held = await post(admin, [row(7), row(8)], true);
      if (held.committed || rowOf(held, 8)?.status !== 'duplicate' || rowOf(held, 7)?.status !== 'ok') problems.push(`duplicates in the file read ${JSON.stringify(held.rows)}, expected row 8 held`);
      const accepted = await post(admin, [row(7), row(8, { duplicateAccepted: true })], true);
      if (!accepted.committed) problems.push(`an accepted duplicate was not posted: ${JSON.stringify(accepted.rows)}`);
      const again = await post(admin, [row(7)], false);
      if (rowOf(again, 7)?.status !== 'duplicate' || !String(rowOf(again, 7)?.message).includes('پیش‌تر در برنامه')) problems.push(`the same row after the post reads ${JSON.stringify(again.rows)}, expected held as already in the books`);

      // a colleague who left on 10 Ordibehesht (2026-04-30): the row is dated on that day, with a warning
      const leaver = await newWorker('همکار رفته آزمون ورود کارکرد');
      await orm.update(personnel).set({ employmentStatus: 'قطع همکاری', endDate: '2026-04-30' }).where(eq(personnel.id, leaver));
      const left = await post(admin, [row(9, { personnelId: leaver })], false);
      if (rowOf(left, 9)?.status !== 'ok' || rowOf(left, 9)?.date !== '2026-04-30' || !rowOf(left, 9)?.warnings?.some(w => w.includes('همکاری'))) problems.push(`a leaver's row reads ${JSON.stringify(left.rows)}, expected ok on 2026-04-30 with a warning`);

      // keys: the hand entry alone does not import; the import key without the hand entry's does not either
      const logger = await sandboxClientWith(['piecework.view', 'piecework.log']);
      const noImport = await logger.post(URL, { commit: false, rows: [row(10)] });
      if (noImport.status !== 403) problems.push(`a holder of piecework.log alone got ${brief(noImport)}, expected 403`);
      const importOnly = await sandboxClientWith(['piecework.view', 'piecework.log_import']);
      const noLog = await importOnly.post(URL, { commit: false, rows: [row(10)] });
      if (noLog.status !== 403) problems.push(`a holder of piecework.log_import without piecework.log got ${brief(noLog)}, expected 403`);
      const importer = await sandboxClientWith(['piecework.view', 'piecework.log', 'piecework.log_import']);
      const own = await importer.post(URL, { commit: false, rows: [row(10, { quantity: '4' }), row(11, { quantity: '5', unitRate: '120000' })] });
      const ownBody = own.body as WorkLogImportResult;
      if (own.status !== 200 || rowOf(ownBody, 10)?.status !== 'ok') problems.push(`an importer's row at the program's rate reads ${brief(own)}, expected ok`);
      if (rowOf(ownBody, 11)?.status !== 'error' || !String(rowOf(ownBody, 11)?.message).includes('مدیریت عناوین کاری')) problems.push(`an importer's row at another rate reads ${JSON.stringify(rowOf(ownBody, 11))}, expected refused for the rates key`);

      // «پایان ورود سابقه» closes the 1405 replay tools, not this one
      await closeHistoryImport({ username: 'inv' });
      const afterClose = await post(admin, [row(12, { quantity: '6' })], false);
      if (rowOf(afterClose, 12)?.status !== 'ok') problems.push(`after the close the import reads ${JSON.stringify(afterClose.rows)}, expected ok`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'refused rows post nothing, duplicates wait for acceptance, leavers are dated on their last day, keys hold, the close leaves the tool open';
    }));
  }

  return results;
}
