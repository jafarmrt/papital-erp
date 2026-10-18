import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * 10.2 package 4 (OBS-R2-52): a payslip payment and its void go through the shared treasury path
 * (`postTreasuryRow` / `reverseTreasuryRow`), so they take the same checks as a treasury form payment. A refused
 * payment for want of balance carries the shared code on both paths, and a legacy payslip payment recorded with the
 * cheque label (before TD-411) still gives its money back to the bank when voided.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const BALANCE_CODE = 'TREASURY_BALANCE_INSUFFICIENT';
/** the payslip payment's own wording, kept by the shared path */
const PAYROLL_BALANCE_TEXT = 'برای این پرداخت کافی نیست';

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
  };
}

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const messageOf = (res: { body?: unknown }) => String((res.body as { error?: unknown; message?: unknown } | undefined)?.error
  ?? (res.body as { message?: unknown } | undefined)?.message ?? '');

/** A rial bank account with a ledger account and no money in it */
async function emptyBank(): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: 'بانک آزمون راه خزانه', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `بانک آزمون راه خزانه ${tagOf()}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
  return bank.id;
}

/** An approved payslip of 1,000,000 */
async function approvedPayslip(label: string): Promise<number> {
  const workerId = await newWorker(`ERP-TEST-MARKER R252 ${label}`);
  await addLog(workerId, await newTask(), '2026-04-05', 1_000_000);
  const issued = await issueApproved({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'r252' });
  if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
  return issued.payroll.id;
}

const bankBalance = async (bankId: number) =>
  String((await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId])).rows[0]?.b ?? '');
const treasuryRowCount = async (bankId: number) =>
  Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1', [bankId])).rows[0]?.n ?? 0);

export async function runTreasuryOnePathObsR252Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const balanceId = 'reg_payroll_payment_shared_treasury_balance_obs_r2_52';
  if (shouldRun(balanceId, 'obsr252', 'obs_r2_52', 'payroll', 'treasury', 'balance')) {
    await runCase(results, balanceId, 'v10.2.1: a payslip payment above the bank balance is refused by the shared treasury check with code TREASURY_BALANCE_INSUFFICIENT and its own wording, like a treasury form payment, and writes nothing (OBS-R2-52)', async () => {
      const problems: string[] = [];
      const payrollId = await approvedPayslip('balance');
      const bankId = await emptyBank();
      const api = await adminClient();

      const paid = await api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 400_000 });
      if (paid.status !== 422) problems.push(`payslip payment from an empty account answered ${brief(paid)}, expected 422`);
      if (codeOf(paid) !== BALANCE_CODE) problems.push(`payslip payment refusal code is "${codeOf(paid)}", expected ${BALANCE_CODE}`);
      if (!messageOf(paid).includes(PAYROLL_BALANCE_TEXT)) problems.push('payslip payment refusal lost its own wording');

      const form = await api.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 400_000, bankAccountId: bankId, partyType: 'other',
        contraAccountId: await miscContraAccountId(), partyName: 'پرداخت آزمون راه خزانه', date: '2026-04-10',
      });
      if (form.status !== 422) problems.push(`treasury form payment from an empty account answered ${brief(form)}, expected 422`);
      if (codeOf(form) !== BALANCE_CODE) problems.push(`treasury form payment refusal code is "${codeOf(form)}", expected ${BALANCE_CODE}`);

      const balanceAfter = await bankBalance(bankId);
      if (Number(balanceAfter) !== 0) problems.push(`the bank balance moved to ${balanceAfter}`);
      if (await treasuryRowCount(bankId) !== 0) problems.push('a refused payment left a treasury row');
      const paidAmount = (await pool.query<{ p: string }>('SELECT coalesce(paid_amount, 0)::text AS p FROM piecework_payrolls WHERE id = $1', [payrollId])).rows[0]?.p;
      if (Number(paidAmount) !== 0) problems.push(`the payslip shows ${paidAmount} paid after a refused payment`);
      assertNoProblems(problems);
      return `payslip ${codeOf(paid)}, treasury form ${codeOf(form)}, nothing written`;
    });
  }

  const chequeId = 'reg_payroll_cheque_payment_void_restores_balance_obs_r2_52';
  if (shouldRun(chequeId, 'obsr252', 'obs_r2_52', 'payroll', 'treasury', 'void', 'cheque', 'td411')) {
    await runCase(results, chequeId, 'v10.2.1: voiding a legacy payslip payment labelled «cheque» (before TD-411) through the shared reversal gives its money back to the bank and keeps the payslip link on the reversal row (OBS-R2-52, guard)', async () => {
      const problems: string[] = [];
      const payrollId = await approvedPayslip('cheque void');
      const bankId = await fundedBank();
      const api = await adminClient();
      const before = Number(await bankBalance(bankId));

      const paid = await api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      const transactionId = Number((paid.body as { transactionId?: unknown } | undefined)?.transactionId);
      if (paid.status !== 200 || !transactionId) throw new Error(`setup: payment ${brief(paid)}`);
      if (Number(await bankBalance(bankId)) !== before - 300_000) problems.push(`the payment left the bank at ${await bankBalance(bankId)}, expected ${before - 300_000}`);
      // a payslip payment recorded before v8.0.120 could carry the cheque label; the bank was credited that day
      await pool.query(`UPDATE treasury_transactions SET method = 'cheque' WHERE id = $1`, [transactionId]);

      const voided = await api.post(`/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, { reason: 'R252 legacy cheque void' });
      if (voided.status !== 200) throw new Error(`setup: void ${brief(voided)}`);
      if (Number(await bankBalance(bankId)) !== before) problems.push(`the void left the bank at ${await bankBalance(bankId)}, expected ${before}`);
      const reversal = (await pool.query<{ payroll_id: number | null; method: string; type: string; status: string }>(
        'SELECT payroll_id, method, type, status FROM treasury_transactions WHERE reversal_of_id = $1', [transactionId])).rows;
      if (reversal.length !== 1) problems.push(`the void wrote ${reversal.length} reversal rows, expected 1`);
      else {
        if (reversal[0].payroll_id !== payrollId) problems.push(`the reversal row links payslip ${reversal[0].payroll_id}, expected ${payrollId}`);
        if (reversal[0].type !== 'receipt' || reversal[0].method !== 'cheque') problems.push(`the reversal row is ${reversal[0].type} / ${reversal[0].method}, expected receipt / cheque`);
      }
      const original = (await pool.query<{ status: string }>('SELECT status FROM treasury_transactions WHERE id = $1', [transactionId])).rows[0];
      if (original?.status !== 'voided') problems.push(`the payment is "${original?.status}", expected voided`);
      assertNoProblems(problems);
      return `bank back to ${before}, one reversal row linked to the payslip`;
    });
  }

  return results;
}
