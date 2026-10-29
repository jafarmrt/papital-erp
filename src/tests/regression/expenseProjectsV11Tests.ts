import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, productionProjects } from '../../db/schema.js';
import type { TreasuryImportResult, TreasuryImportRow } from '../../lib/historyImport/treasuryHistoryImport.js';
import { fundedBank, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 (the 1405 replay, tool 5; owner's decision 7 Aban 1405): an expense may name the production project it was spent on.
 * A miscellaneous treasury payment, a line of a petty cash statement and a line of a colleague's out-of-pocket expense carry
 * the project as their expense voucher line's detail, so the project summary report counts it; the treasury history import
 * maps each cost centre once. Real routes and services on PostgreSQL. Red before this change: the field was refused (400).
 */

const accountId = async (code: string) => {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`setup: account ${code} is missing from the standard chart`);
  return row.id;
};
/** the detail of the voucher lines on one account of a voucher */
const detailOn = async (voucherId: number, account: number) => (await orm.execute(sql`
  SELECT detailed_type AS type, detailed_id AS id FROM journal_voucher_items
   WHERE voucher_id = ${voucherId} AND account_id = ${account} AND is_deleted = 0 ORDER BY id`)).rows as Array<{ type: string; id: number | null }>;
const voucherOfTreasury = async (id: number) => Number(((await orm.execute(sql`SELECT voucher_id AS v FROM treasury_transactions WHERE id = ${id}`)).rows[0] as { v: number }).v);

export async function runExpenseProjectsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_expense_projects_v11';
  if (shouldRun(id, 'v11', 'projects', 'treasury', 'petty_cash', 'history_import')) {
    await runCase(results, id, 'v11 tool 5: a miscellaneous payment, a petty cash line and a colleague expense line naming a project carry it as the expense line\'s detail (kept on the lines); a project on a customer payment or a deleted project is refused; the treasury history import posts a cost centre mapped to a project with it', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const bank = await fundedBank();
      const expense = await accountId('7009');
      const tag = `${Date.now()}`;
      const [project] = await orm.insert(productionProjects).values({ projectCode: `EP-${tag}`, title: `پروژه هزینه ${tag}` }).returning({ id: productionProjects.id });
      const [gone] = await orm.insert(productionProjects).values({ projectCode: `EPX-${tag}`, title: 'حذف‌شده', isDeleted: 1 }).returning({ id: productionProjects.id });
      const isProject = (rows: Array<{ type: string; id: number | null }>) => rows.length > 0 && rows.every(r => r.type === 'project' && Number(r.id) === project.id);

      // 1. a miscellaneous payment
      const pay = (extra: Record<string, unknown>) => admin.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 20000, bankAccountId: bank, partyType: 'other', partyName: 'فروشگاه', contraAccountId: expense, date: '2026-04-05', ...extra,
      });
      const paid = await pay({ projectId: project.id });
      if (paid.status !== 201) problems.push(`a miscellaneous payment with a project returned ${brief(paid)}`);
      else if (!isProject(await detailOn(await voucherOfTreasury(paid.body.id), expense))) problems.push(`its expense line reads ${JSON.stringify(await detailOn(await voucherOfTreasury(paid.body.id), expense))}, expected the project`);
      const deleted = await pay({ projectId: gone.id });
      if (deleted.status !== 422 || deleted.body?.code !== 'EXPENSE_PROJECT_INVALID') problems.push(`a deleted project returned ${brief(deleted)}, expected 422 EXPENSE_PROJECT_INVALID`);
      const onCustomer = await admin.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 1000, bankAccountId: bank, partyType: 'personnel', partyId: await newWorker('همکار پروژه'), partyName: 'همکار', purpose: 'advance', projectId: project.id, date: '2026-04-05',
      });
      if (onCustomer.status !== 422 || onCustomer.body?.code !== 'TREASURY_PROJECT_NOT_ALLOWED') problems.push(`a project on a colleague's advance returned ${brief(onCustomer)}, expected 422 TREASURY_PROJECT_NOT_ALLOWED`);

      // 2. a petty cash statement line
      const fundRes = await admin.post('/api/accounting/bank-accounts', { title: `تنخواه پروژه ${tag}`, type: 'petty_cash', accountId: await accountId('1006') });
      const fund = Number(fundRes.body?.id);
      const charge = await admin.post('/api/accounting/treasury/transfer', { fromBankAccountId: bank, toBankAccountId: fund, amount: 100000, date: '2026-04-05' });
      if (charge.status !== 201) problems.push(`charging the fund returned ${brief(charge)}`);
      const statement = await admin.post(`/api/accounting/treasury/petty-cash/${fund}/expenses`, {
        date: '2026-04-06', lines: [{ accountId: expense, amount: 3000, projectId: project.id }, { accountId: expense, amount: 2000 }],
      });
      if (statement.status !== 201) problems.push(`a petty cash statement with a project line returned ${brief(statement)}`);
      else {
        const rows = await detailOn(Number(statement.body.voucherId ?? await voucherOfTreasury(statement.body.id)), expense);
        if (rows.length !== 2 || rows[0].type !== 'project' || Number(rows[0].id) !== project.id || rows[1].type !== 'none') problems.push(`the statement's expense lines read ${JSON.stringify(rows)}, expected the project then none`);
        if (statement.body.lines?.[0]?.projectId !== project.id || !String(statement.body.lines?.[0]?.projectTitle).includes(`EP-${tag}`)) problems.push(`the statement lines read ${JSON.stringify(statement.body.lines)}, expected the project on the first`);
        const kept = await admin.get(`/api/accounting/treasury/${statement.body.id}/petty-cash-lines`);
        const keptLines = (kept.body?.data ?? kept.body) as Array<{ projectId: number | null }> | undefined;
        if (ok(kept) && Array.isArray(keptLines) && keptLines[0]?.projectId !== project.id) problems.push(`the kept lines read ${JSON.stringify(keptLines)}, expected the project on the first`);
      }

      // 3. a colleague's out-of-pocket expense line
      const colleague = await newWorker('همکار هزینه پروژه');
      const own = await admin.post('/api/accounting/treasury/colleague-expenses', {
        personnelId: colleague, date: '2026-04-07', lines: [{ accountId: expense, amount: '7000', projectId: project.id }],
      });
      if (own.status !== 201) problems.push(`a colleague expense with a project returned ${brief(own)}`);
      else if (!isProject(await detailOn(Number(own.body.voucherId), expense))) problems.push('the colleague expense line does not carry the project');

      // 4. the treasury import: a cost centre mapped to the project
      const rows: TreasuryImportRow[] = [{
        rowNo: 2, sheet: 'هزینه‌ها', date: '1405-01-20', kind: 'payment', bankAccountId: bank, amount: '4000', partyType: 'other', partyName: 'ابزار',
        contraAccountId: expense, costCenter: 'پروژه آزمون', projectId: project.id,
      }];
      const imported = await admin.post('/api/accounting/treasury/history-import', { commit: true, rows });
      const result = imported.body as TreasuryImportResult;
      if (!ok(imported) || !result.committed) problems.push(`the import returned ${brief(imported)}`);
      else {
        const [tx] = (await orm.execute(sql`SELECT id FROM treasury_transactions WHERE bank_account_id = ${bank} AND amount = 4000 AND is_deleted = 0`)).rows as Array<{ id: number }>;
        if (!tx || !isProject(await detailOn(await voucherOfTreasury(Number(tx.id)), expense))) problems.push('the imported expense does not carry the project');
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a project named on an expense travels to its voucher line, from the forms and from the import';
    }));
  }
  return results;
}
