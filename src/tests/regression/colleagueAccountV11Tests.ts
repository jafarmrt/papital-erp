import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import type { ColleagueExpense, ColleagueExpenseList } from '../../lib/treasury/colleagueExpense.js';
import type { TreasuryImportResult, TreasuryImportRow } from '../../lib/historyImport/treasuryHistoryImport.js';
import { fundedBank, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 (the 1405 replay, tool 4; owner's decisions 7 Aban 1405): each colleague's running account («حساب جاری همکاران», 3208,
 * on their personnel detail). An expense a colleague paid from their own pocket credits it; a treasury payment of the
 * personnel type «حساب جاری همکار» (petty cash given, a payback) debits it, a receipt of it credits it, with no cap, so it
 * may stand on either side. Real routes and services on PostgreSQL, each scenario in its own schema with the standard chart.
 * Red before this change: the routes, the account and the purpose did not exist.
 */

const EXPENSES_URL = '/api/accounting/treasury/colleague-expenses';
const IMPORT_URL = '/api/accounting/treasury/history-import';

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const accountId = async (code: string) => {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`setup: account ${code} is missing from the standard chart`);
  return row.id;
};
/** debit minus credit of a voucher's lines on one account (and detail) */
const net = async (voucherId: number, account: number, personnelId?: number) => count(sql`
  SELECT coalesce(sum(debit - credit), 0)::numeric AS n FROM journal_voucher_items
   WHERE voucher_id = ${voucherId} AND account_id = ${account} AND is_deleted = 0
     ${personnelId ? sql`AND detailed_type = 'personnel' AND detailed_id = ${personnelId}` : sql``}`);
/** the colleague's running account: credit minus debit on 3208 with their detail, over live vouchers */
const runningAccount = async (account: number, personnelId: number) => count(sql`
  SELECT coalesce(sum(i.credit - i.debit), 0)::numeric AS n FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
   WHERE i.account_id = ${account} AND i.detailed_type = 'personnel' AND i.detailed_id = ${personnelId} AND i.is_deleted = 0 AND v.is_deleted = 0`);

export async function runColleagueAccountV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const hand = 'reg_colleague_account_v11';
  if (shouldRun(hand, 'v11', 'colleague_account', 'treasury', 'petty_cash')) {
    await runCase(results, hand, 'v11 tool 4: an expense a colleague paid from their own pocket records a draft voucher (expense debit, 3208 credit on the colleague) that only its void changes; a treasury payment and receipt of the type «colleague running account» move 3208 on the colleague either way with no cap; a miscellaneous counter account cannot take it; a void soft-deletes the draft voucher', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const bank = await fundedBank();
      const colleague = await newWorker('همکار حساب جاری');
      const expenseAccount = await accountId('7009');
      const running = await accountId('3208');

      const created = await admin.post(EXPENSES_URL, {
        personnelId: colleague, date: '2026-04-10', description: 'خرید از جیب',
        lines: [{ accountId: expenseAccount, amount: '300000', sellerName: 'فروشگاه', invoiceNumber: '۱۲' }, { accountId: expenseAccount, amount: '50000' }],
      });
      if (created.status !== 201) throw new Error(`the colleague expense returned ${brief(created)}`);
      const expense = created.body as ColleagueExpense;
      const voucherId = Number(expense.voucherId);
      if (expense.total !== 350000 || expense.lines.length !== 2) problems.push(`the expense reads ${JSON.stringify(expense).slice(0, 200)}, expected 350,000 in two lines`);
      const [voucher] = (await orm.execute(sql`SELECT status, reference_module, date::text AS date FROM journal_vouchers WHERE id = ${voucherId}`)).rows as Array<{ status: string; reference_module: string; date: string }>;
      if (voucher?.status !== 'draft' || voucher.reference_module !== 'colleague_expense' || !voucher.date.startsWith('2026-04-10')) problems.push(`the voucher reads ${JSON.stringify(voucher)}, expected a draft colleague_expense voucher of 2026-04-10`);
      if (await net(voucherId, expenseAccount) !== 350000) problems.push(`the expense account takes ${await net(voucherId, expenseAccount)}, expected a 350,000 debit`);
      if (await net(voucherId, running, colleague) !== -350000) problems.push(`3208 on the colleague takes ${await net(voucherId, running, colleague)}, expected a 350,000 credit`);
      const deleted = await admin.del(`/api/accounting/vouchers/${voucherId}`);
      if (deleted.status !== 409 || deleted.body?.code !== 'VOUCHER_HAS_SOURCE') problems.push(`deleting its voucher returned ${brief(deleted)}, expected 409 VOUCHER_HAS_SOURCE`);

      const move = (type: 'payment' | 'receipt', amount: number, extra: Record<string, unknown> = {}) => admin.post('/api/accounting/treasury', {
        type, method: 'bank_transfer', amount, bankAccountId: bank, partyType: 'personnel', partyId: colleague, partyName: 'همکار',
        purpose: 'colleague_account', date: '2026-04-12', ...extra,
      });
      // petty cash handed over beyond what is owed: the account goes to the other side, as the owner decided
      const paid = await move('payment', 500000);
      if (!ok(paid)) problems.push(`a payment of the running account returned ${brief(paid)}, expected success with no cap`);
      if (await runningAccount(running, colleague) !== -150000) problems.push(`the running account is ${await runningAccount(running, colleague)} after the payment, expected -150,000 (the colleague holds 150,000)`);
      const handedBack = await move('receipt', 150000);
      if (!ok(handedBack)) problems.push(`a receipt of the running account returned ${brief(handedBack)}`);
      if (await runningAccount(running, colleague) !== 0) problems.push(`the running account is ${await runningAccount(running, colleague)} after the receipt, expected 0`);
      const other = await admin.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 1000, bankAccountId: bank, partyType: 'personnel', partyId: colleague, partyName: 'همکار',
        purpose: 'other', contraAccountId: running, date: '2026-04-12',
      });
      if (other.status !== 422) problems.push(`a «other» payment against 3208 returned ${brief(other)}, expected 422 (a control account)`);

      const list = await admin.get(EXPENSES_URL);
      const data = list.body?.data as ColleagueExpenseList | undefined;
      if (!ok(list) || data?.rows[0]?.id !== expense.id || data.owed.find(o => o.personnelId === colleague)?.owed !== 0) problems.push(`the list returned ${brief(list)}, expected the expense and a balance of 0`);

      const voidRes = await admin.post(`${EXPENSES_URL}/${expense.id}/void`, { reason: 'ثبت تکراری' });
      if (!ok(voidRes) || voidRes.body?.voucherAction !== 'deleted') problems.push(`the void returned ${brief(voidRes)}, expected the draft voucher deleted`);
      if (await count(sql`SELECT is_deleted AS n FROM journal_vouchers WHERE id = ${voucherId}`) !== 1) problems.push('the draft voucher of the voided expense is still live');
      // the payment and the receipt stay: without the expense the colleague holds the 350,000 net they were given
      if (await runningAccount(running, colleague) !== -350000) problems.push(`the running account is ${await runningAccount(running, colleague)} after the void, expected -350,000`);
      const again = await admin.post(`${EXPENSES_URL}/${expense.id}/void`, { reason: 'دوباره' });
      if (again.status !== 409) problems.push(`a second void returned ${brief(again)}, expected 409`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the expense voucher credits the colleague, the running account moves both ways with no cap, a control account stays closed to «other», and the void takes the draft voucher off';
    }));
  }

  const imported = 'reg_colleague_account_import_v11';
  if (shouldRun(imported, 'v11', 'colleague_account', 'history_import', 'treasury')) {
    await runCase(results, imported, 'v11 tool 4: the treasury history import posts an expenses-sheet row paid by a colleague as a colleague expense on its day (nothing kept by the preview), and a payment of the running account; the same expense posted again waits as a duplicate until accepted', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const bank = await fundedBank();
      const colleague = await newWorker('همکار ورود هزینه');
      const expenseAccount = await accountId('7009');
      const running = await accountId('3208');
      const rows: TreasuryImportRow[] = [
        { rowNo: 2, sheet: 'هزینه‌ها', date: '1405-01-20', kind: 'colleague_expense', bankAccountId: 0, amount: '120000', personnelId: colleague, partyName: 'نانوایی', contraAccountId: expenseAccount, invoiceRef: '7', description: 'نان' },
        { rowNo: 3, sheet: 'دریافت و پرداخت', date: '1405-01-25', kind: 'payment', bankAccountId: bank, amount: '120000', partyType: 'personnel', partyId: colleague, partyName: 'همکار', purpose: 'colleague_account' },
      ];
      const expensesNow = () => count(sql`SELECT count(*)::int AS n FROM colleague_expenses`);
      const preview = await admin.post(IMPORT_URL, { commit: false, rows });
      if (!ok(preview) || (preview.body as TreasuryImportResult).okCount !== 2) problems.push(`the preview returned ${brief(preview)}, expected both rows ok`);
      if (await expensesNow() !== 0) problems.push('the preview kept a colleague expense');
      const posted = await admin.post(IMPORT_URL, { commit: true, rows });
      if (!ok(posted) || !(posted.body as TreasuryImportResult).committed) problems.push(`the post returned ${brief(posted)}, expected both rows posted`);
      const [row] = (await orm.execute(sql`SELECT date::text AS date, total::numeric AS total, voucher_id FROM colleague_expenses WHERE personnel_id = ${colleague}`)).rows as Array<{ date: string; total: string; voucher_id: number }>;
      if (!row || row.date !== '2026-04-09' || Number(row.total) !== 120000) problems.push(`the imported expense reads ${JSON.stringify(row)}, expected 120,000 on 2026-04-09 (1405-01-20)`);
      if (await runningAccount(running, colleague) !== 0) problems.push(`the running account is ${await runningAccount(running, colleague)}, expected 0 after the payback`);
      const twice = await admin.post(IMPORT_URL, { commit: false, rows: [{ ...rows[0], rowNo: 9 }] });
      const outcome = (twice.body as TreasuryImportResult | undefined)?.rows?.[0];
      if (outcome?.status !== 'duplicate') problems.push(`the same expense again returned ${brief(twice)}, expected a duplicate`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the import records the colleague expense on its day and the payback through the running account; a repeat waits as a duplicate';
    }));
  }
  return results;
}
