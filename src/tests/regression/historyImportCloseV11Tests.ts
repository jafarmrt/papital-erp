import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v11 history import, tool 9 («پایان ورود سابقه»): the system admin closes the Excel history imports for good, after
 * confirming; then every import call, preview included, is refused with 409 HISTORY_IMPORT_CLOSED and the status says
 * closed. Real Express routes on PostgreSQL, in its own schema. Red before this change: the routes did not exist.
 */

type Res = { status: number; body?: unknown };
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

export async function runHistoryImportCloseV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_history_import_close_v11';
  if (shouldRun(id, 'v11', 'history_import', 'close', 'settings')) {
    await runCase(results, id, 'v11 history import (tool 9): only the system admin closes the history imports, only with the confirmation, once; then the status reads closed and every import call (treasury and stock preview, old openings) is refused with 409 HISTORY_IMPORT_CLOSED; the close is audited', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const importer = await sandboxClientWith(['accounting.history_import', 'warehouse.history_import', 'warehouse.in', 'warehouse.out']);
      const STATUS = '/api/history-import/status';
      const CLOSE = '/api/history-import/close';
      const OLD = '/api/inventory/history-import/old-openings';
      const row = { rowNo: 2, sheet: 'دریافت و پرداخت', date: '1405-02-01', kind: 'receipt', bankAccountId: 1, amount: '1000' };

      const open = await importer.get(STATUS);
      if (open.status !== 200 || (open.body as { closed?: unknown })?.closed !== false) problems.push(`the status before the close read ${brief(open)}, expected open`);
      const oldBefore = await importer.get(OLD);
      if (oldBefore.status !== 200) problems.push(`the old openings before the close answered ${brief(oldBefore)}, expected 200`);

      const byImporter = await importer.post(CLOSE, { confirm: true });
      if (byImporter.status !== 403) problems.push(`a non-admin closing answered ${brief(byImporter)}, expected 403`);
      const unconfirmed = await admin.post(CLOSE, {});
      if (unconfirmed.status !== 400) problems.push(`a close without the confirmation answered ${brief(unconfirmed)}, expected 400`);
      const stillOpen = await importer.get(STATUS);
      if ((stillOpen.body as { closed?: unknown })?.closed !== false) problems.push(`a refused close left ${brief(stillOpen)}`);

      const closed = await admin.post(CLOSE, { confirm: true });
      if (closed.status !== 200 || (closed.body as { closed?: unknown })?.closed !== true) problems.push(`the admin closing answered ${brief(closed)}, expected 200 closed`);
      const status = await importer.get(STATUS);
      const s = status.body as { closed?: unknown; closedAt?: unknown };
      if (status.status !== 200 || s?.closed !== true || typeof s?.closedAt !== 'string') problems.push(`the status after the close read ${brief(status)}, expected closed with its time`);
      const audit = await orm.execute(sql`SELECT count(*)::int AS n FROM activity_logs WHERE entity = 'تنظیمات سیستم' AND entity_id = 'history_import_closed'`);
      if (Number((audit.rows[0] as { n: number }).n) !== 1) problems.push('the close wrote no audit row');

      const calls: Array<[string, Res]> = [
        ['treasury preview', await importer.post('/api/accounting/treasury/history-import', { commit: false, rows: [row] })],
        ['stock preview', await importer.post('/api/inventory/history-import', { commit: false, rows: [{ rowNo: 2, sheet: 'ورود به انبار', date: '1405-02-01', kind: 'waste', itemCode: 'X', quantity: '1' }] })],
        ['old openings', await importer.get(OLD)],
        ['old openings withdraw', await importer.post(`${OLD}/withdraw`, { itemIds: [1] })],
        ['a second close', await admin.post(CLOSE, { confirm: true })],
      ];
      for (const [name, res] of calls) {
        if (res.status !== 409 || codeOf(res) !== 'HISTORY_IMPORT_CLOSED') problems.push(`${name} after the close answered ${brief(res)}, expected 409 HISTORY_IMPORT_CLOSED`);
      }

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the admin closed the imports once, with the confirmation; then every import call was refused with 409';
    }));
  }

  return results;
}
