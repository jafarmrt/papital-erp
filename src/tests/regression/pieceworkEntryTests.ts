import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkTasks } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { PieceworkService } from '../../services/piecework.service.js';
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
        problems.push(`create with «۲۵۰٬۰۰۰» answered ${good.status}, stored ${goodRow?.defaultRate}, expected 201 and 250000`);
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

  return results;
}
