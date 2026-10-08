import { orm } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { eq } from 'drizzle-orm';

/**
 * Package 12 payroll, PR «د»: the work log list is filtered, paged and summed in SQL (B12P-08). Runs on real Express
 * routes and PostgreSQL in an isolated schema and is red on the version before the fix.
 */

const brief = (body: unknown) => String(JSON.stringify(body)).slice(0, 240);

interface LogSeed { personnelId: number; taskId: number; projectId: number | null; date: string; amount: number; status?: string; isDeleted?: number }

async function seedLog(log: LogSeed): Promise<void> {
  await orm.insert(pieceworkLogs).values({
    personnelId: log.personnelId, taskId: log.taskId, projectId: log.projectId, date: log.date, dateIso: log.date,
    quantity: 1, unitRate: money(log.amount), totalAmount: money(log.amount), status: log.status ?? 'pending', isDeleted: log.isDeleted ?? 0,
  });
}

export async function runWorkLogListTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const listId = 'reg_piecework_log_list_in_sql_td_811';
  if (shouldRun(listId, 'td811', 'piecework', 'package12')) {
    await runCase(results, listId, 'v9.0.330: GET /piecework/logs filters by personnel, project («none» included), settled state, Jalali range and search in SQL and returns one page with the count and sum of every match; /piecework/logs/summary sums the cards and project costs in SQL (TD-811)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const [w1, w2, task] = [await newWorker('TD-811 first'), await newWorker('TD-811 second'), await newTask()];
      const [w2Row] = await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, w2));
      const [project] = await orm.insert(productionProjects).values({ projectCode: `TD811-${Date.now()}`, title: 'TD-811 project' }).returning({ id: productionProjects.id });

      // 1405/06/10 = 2026-09-01; 1405/06/31 = 2026-09-22; 2026-08-10 is in Mordad
      await seedLog({ personnelId: w1, taskId: task, projectId: project.id, date: '2026-09-01', amount: 100 });
      await seedLog({ personnelId: w1, taskId: task, projectId: null, date: '2026-09-15', amount: 200 });
      await seedLog({ personnelId: w2, taskId: task, projectId: null, date: '2026-09-20', amount: 300, status: 'approved' });
      await seedLog({ personnelId: w2, taskId: task, projectId: project.id, date: '2026-08-10', amount: 400 });
      await seedLog({ personnelId: w2, taskId: task, projectId: project.id, date: '2026-09-02', amount: 999, isDeleted: 1 });

      // 1) one page with the count and the sum of every match (the page used to receive every log ever recorded)
      const page = await admin.get('/api/piecework/logs?page=1&limit=2');
      if (page.status !== 200 || Array.isArray(page.body) || page.body?.data?.length !== 2 || page.body?.total !== 4
        || page.body?.page !== 1 || page.body?.limit !== 2 || page.body?.totalAmount !== 1000) {
        problems.push(`page 1 of 2 answered ${page.status} ${brief(page.body)}, expected two rows, total 4, totalAmount 1000`);
      }
      const second = await admin.get('/api/piecework/logs?page=2&limit=2');
      const pageIds = [...(page.body?.data ?? []), ...(second.body?.data ?? [])].map((r: { id: number }) => r.id);
      if (new Set(pageIds).size !== 4) problems.push(`pages 1 and 2 held ${pageIds.length} rows (${new Set(pageIds).size} distinct), expected 4 distinct`);

      // 2) the filters the page sends, each in SQL
      const cases: Array<[string, number[]]> = [
        // «processed» means the log is on a payslip; it used to match no row at all
        ['status=processed', [300]],
        ['status=pending', [100, 200, 400]],
        // «none» means without a project; it used to match no row
        ['projectId=none', [200, 300]],
        [`projectId=${project.id}`, [100, 400]],
        [`personnelId=${w1}`, [100, 200]],
        // the search box used to be applied only in the browser over the full list
        [`search=${encodeURIComponent(w2Row.fullName.slice(-8))}`, [300, 400]],
        ['startDate=1405/06/10&endDate=1405/06/31', [100, 200, 300]],
        [`personnelId=${w2}&startDate=1405/06/01&endDate=1405/06/31&status=processed`, [300]],
      ];
      for (const [query, amounts] of cases) {
        const res = await admin.get(`/api/piecework/logs?${query}`);
        const got = Array.isArray(res.body) ? res.body.map((r: { totalAmount: number }) => Number(r.totalAmount)).sort((a, b) => a - b) : null;
        if (res.status !== 200 || JSON.stringify(got) !== JSON.stringify(amounts)) {
          problems.push(`?${query} answered ${res.status} with amounts ${JSON.stringify(got) ?? brief(res.body)}, expected ${JSON.stringify(amounts)}`);
        }
      }
      const ranged = await admin.get('/api/piecework/logs?startDate=1405/06/10&endDate=1405/06/31&page=1');
      if (ranged.body?.total !== 3 || ranged.body?.totalAmount !== 600) problems.push(`the Shahrivar page answered ${brief(ranged.body)}, expected total 3 and totalAmount 600`);

      // 3) a malformed filter is a 400, not an empty list
      for (const query of ['personnelId=abc', 'projectId=x1', 'startDate=1405/13/40', 'page=0']) {
        const res = await admin.get(`/api/piecework/logs?${query}`);
        if (res.status !== 400) problems.push(`?${query} answered ${res.status} ${brief(res.body)}, expected 400`);
      }

      // 4) the cards and «هزینه پروژه‌ها» are summed in SQL over every live log
      const summary = await admin.get('/api/piecework/logs/summary');
      const projects = Array.isArray(summary.body?.projects) ? summary.body.projects as Array<{ projectId: number | null; totalCost: number; logCount: number; personnelCount: number }> : [];
      const withProject = projects.find(p => p.projectId === project.id);
      const withoutProject = projects.find(p => p.projectId === null);
      if (summary.status !== 200 || summary.body?.logCount !== 4 || summary.body?.totalAmount !== 1000 || summary.body?.pendingAmount !== 700) {
        problems.push(`summary answered ${summary.status} ${brief(summary.body)}, expected 4 logs, 1000 in total and 700 pending`);
      }
      if (withProject?.totalCost !== 500 || withProject?.logCount !== 2 || withProject?.personnelCount !== 2) problems.push(`the project cost row was ${brief(withProject)}, expected 500 from 2 logs of 2 personnel`);
      if (withoutProject?.totalCost !== 500 || withoutProject?.logCount !== 2 || withoutProject?.personnelCount !== 2) problems.push(`the no-project row was ${brief(withoutProject)}, expected 500 from 2 logs of 2 personnel`);

      assertNoProblems(problems);
      return 'filters, paging, totals and project costs come from SQL; «processed» and «none» match their rows; malformed filters are 400';
    }));
  }

  return results;
}
