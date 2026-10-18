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
 * cheque label (before TD-411) still gives its money back to the bank when voided. Review of #320: the shared currency
 * check ignores letter case (a legacy petty cash fund stored as «irr» still takes a statement), a treasury void refuses
 * a payslip row on either side of a transfer before writing anything, a treasury form row on an account without a
 * ledger account carries BANK_LEDGER_ACCOUNT_INVALID, and the payslip payment keeps its voucher rows and event keys.
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
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
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

/** A rial treasury account without a ledger account (allowed since v10.0.254 until its first movement) */
async function bankWithoutLedger(): Promise<number> {
  const bank = await BankAccountService.createBankAccount({ title: `بانک بی سرفصل ${tagOf()}`, type: 'bank', initialBalance: 0, currency: 'IRR' });
  return bank.id;
}

const accountIdOf = async (code: string) =>
  Number((await pool.query<{ id: number }>('SELECT id FROM accounts WHERE code = $1 AND is_deleted = 0', [code])).rows[0]?.id ?? 0);

const bankBalance = async (bankId: number) =>
  String((await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId])).rows[0]?.b ?? '');
const treasuryRowCount = async (bankId: number) =>
  Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1', [bankId])).rows[0]?.n ?? 0);

export async function runTreasuryOnePathObsR252Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const balanceId = 'reg_payroll_payment_shared_treasury_balance_obs_r2_52';
  if (shouldRun(balanceId, 'obsr252', 'obs_r2_52', 'payroll', 'treasury', 'balance')) {
    await runCase(results, balanceId, 'v10.2.2: a payslip payment above the bank balance is refused by the shared treasury check with code TREASURY_BALANCE_INSUFFICIENT and its own wording, like a treasury form payment, and writes nothing (OBS-R2-52)', async () => {
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
    await runCase(results, chequeId, 'v10.2.2: voiding a legacy payslip payment labelled «cheque» (before TD-411) through the shared reversal gives its money back to the bank and keeps the payslip link on the reversal row (OBS-R2-52, guard)', async () => {
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

  const pettyId = 'reg_petty_cash_lowercase_rial_fund_obs_r2_52';
  if (shouldRun(pettyId, 'obsr252', 'obs_r2_52', 'petty_cash', 'treasury', 'currency')) {
    await runCase(results, pettyId, 'v10.2.2: a legacy petty cash fund whose currency is stored as «irr» still takes an expense statement through the shared treasury path, whose currency check ignores letter case (review of #320)', async () => {
      const problems: string[] = [];
      const pettyLedger = await accountIdOf('1006');
      if (!pettyLedger) throw new Error('setup: standard account 1006 is missing from the test chart of accounts');
      const fund = await BankAccountService.createBankAccount({ title: `تنخواه حروف کوچک ${tagOf()}`, type: 'petty_cash', accountId: pettyLedger, initialBalance: 0, currency: 'IRR' });
      const api = await adminClient();
      const charge = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: await fundedBank(), toBankAccountId: fund.id, amount: 2_000_000 });
      if (charge.status !== 201) throw new Error(`setup: charge ${brief(charge)}`);
      // a fund saved before the treasury currency list (v9.0.99) may hold the code in lower case
      await pool.query(`UPDATE bank_accounts SET currency = 'irr' WHERE id = $1`, [fund.id]);

      const options = await api.get('/api/accounting/treasury/petty-cash/expense-accounts');
      const expense = ((options.body as { data?: Array<{ id: number; code: string }> }).data ?? []).find(o => o.code === '7009')
        ?? ((options.body as { data?: Array<{ id: number }> }).data ?? [])[0];
      if (!expense) throw new Error(`setup: no expense account (${brief(options)})`);
      const statement = await api.post(`/api/accounting/treasury/petty-cash/${fund.id}/expenses`, {
        description: 'صورت‌هزینه آزمون حروف کوچک', lines: [{ accountId: expense.id, amount: 500_000 }],
      });
      if (statement.status !== 201) problems.push(`statement on a fund stored as «irr» answered ${brief(statement)}, expected 201`);
      const balanceAfter = Number(await bankBalance(fund.id));
      if (balanceAfter !== (statement.status === 201 ? 1_500_000 : 2_000_000)) problems.push(`the fund balance is ${balanceAfter}`);
      assertNoProblems(problems);
      return `statement ${statement.status}, fund balance ${balanceAfter}`;
    });
  }

  const sideId = 'reg_treasury_void_refuses_payslip_side_obs_r2_52';
  if (shouldRun(sideId, 'obsr252', 'obs_r2_52', 'payroll', 'treasury', 'void', 'transfer')) {
    await runCase(results, sideId, 'v10.2.2: voiding one side of a transfer whose other side is linked to a payslip is refused before anything is written, the same refusal as a payslip row voided from the treasury page (review of #320)', async () => {
      const problems: string[] = [];
      const payrollId = await approvedPayslip('transfer side');
      const fromId = await fundedBank();
      const toId = await emptyBank();
      const api = await adminClient();
      const transfer = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: fromId, toBankAccountId: toId, amount: 700_000 });
      if (transfer.status !== 201) throw new Error(`setup: transfer ${brief(transfer)}`);
      const pair = transfer.body as { payment?: { id?: number }; receipt?: { id?: number } };
      const payment = pair.payment?.id ? { id: pair.payment.id } : null;
      const receipt = pair.receipt?.id ? { id: pair.receipt.id } : null;
      if (!payment || !receipt) throw new Error(`setup: transfer rows ${brief(transfer)}`);
      // a link no screen makes; the void must still leave the payslip's money to the payslip window
      await pool.query('UPDATE treasury_transactions SET payroll_id = $1 WHERE id = $2', [payrollId, receipt.id]);
      const fromBefore = await bankBalance(fromId);
      const toBefore = await bankBalance(toId);

      const voided = await api.post(`/api/accounting/treasury/${payment.id}/void`, { reason: 'R252 payslip side' });
      if (voided.status !== 422 || codeOf(voided) !== 'BUSINESS_LOGIC') problems.push(`void answered ${brief(voided)}, expected 422 BUSINESS_LOGIC`);
      const statuses = (await pool.query<{ status: string }>(
        'SELECT status FROM treasury_transactions WHERE id = ANY($1::int[]) ORDER BY id', [[payment.id, receipt.id]])).rows.map(r => r.status);
      if (statuses.join(',') !== 'completed,completed') problems.push(`the transfer rows are ${statuses.join(',')}`);
      const reversals = Number((await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM treasury_transactions WHERE reversal_of_id = ANY($1::int[])', [[payment.id, receipt.id]])).rows[0]?.n ?? 0);
      if (reversals !== 0) problems.push(`the refused void wrote ${reversals} reversal rows`);
      if (await bankBalance(fromId) !== fromBefore || await bankBalance(toId) !== toBefore) problems.push('a bank balance moved');
      assertNoProblems(problems);
      return `void ${voided.status} ${codeOf(voided)}, nothing written`;
    });
  }

  const ledgerId = 'reg_treasury_form_bank_without_ledger_code_obs_r2_52';
  if (shouldRun(ledgerId, 'obsr252', 'obs_r2_52', 'treasury', 'ledger')) {
    await runCase(results, ledgerId, 'v10.2.2: a treasury form receipt into an account without a ledger account is refused with code BANK_LEDGER_ACCOUNT_INVALID, the shared path\'s check, and writes nothing (OBS-R2-52)', async () => {
      const problems: string[] = [];
      const bankId = await bankWithoutLedger();
      const api = await adminClient();
      const receipt = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'cash', amount: 250_000, bankAccountId: bankId, partyType: 'other',
        contraAccountId: await miscContraAccountId(), partyName: 'دریافت آزمون بی سرفصل', date: '2026-04-10',
      });
      if (receipt.status !== 422 || codeOf(receipt) !== 'BANK_LEDGER_ACCOUNT_INVALID') problems.push(`receipt answered ${brief(receipt)}, expected 422 BANK_LEDGER_ACCOUNT_INVALID`);
      if (await treasuryRowCount(bankId) !== 0) problems.push('a refused receipt left a treasury row');
      if (Number(await bankBalance(bankId)) !== 0) problems.push('the bank balance moved');
      assertNoProblems(problems);
      return `receipt ${receipt.status} ${codeOf(receipt)}`;
    });
  }

  const shapeId = 'reg_payroll_payment_voucher_and_event_shape_obs_r2_52';
  if (shouldRun(shapeId, 'obsr252', 'obs_r2_52', 'payroll', 'treasury', 'voucher', 'event')) {
    await runCase(results, shapeId, 'v10.2.2: a payslip payment through the shared path keeps its treasury row, its two voucher rows (wages payable with the personnel / the bank ledger account with the bank) and its event keys, with no name or amount (OBS-R2-52, guard)', async () => {
      const problems: string[] = [];
      const payrollId = await approvedPayslip('shape');
      const bankId = await fundedBank();
      const api = await adminClient();
      const paid = await api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'cash', amount: 350_000, paymentReference: 'R252-REF' });
      const transactionId = Number((paid.body as { transactionId?: unknown } | undefined)?.transactionId);
      if (paid.status !== 200 || !transactionId) throw new Error(`setup: payment ${brief(paid)}`);

      const [row] = (await pool.query<Record<string, unknown>>(
        `SELECT t.type, t.method, t.amount::text AS amount, t.currency, t.exchange_rate::text AS rate, t.party_type, t.purpose, t.contra_account_id,
                t.tracking_number, t.payroll_id, t.voucher_id, t.status, p.personnel_id = t.party_id AS party_is_personnel
           FROM treasury_transactions t JOIN piecework_payrolls p ON p.id = t.payroll_id WHERE t.id = $1`, [transactionId])).rows;
      const rowShape = row && `${row.type} ${row.method} ${Number(row.amount)} ${row.currency} ${Number(row.rate)} ${row.party_type} ${row.purpose} ${row.contra_account_id} ${row.tracking_number} ${row.payroll_id} ${row.status} ${row.party_is_personnel}`;
      const expectedRow = `payment cash 350000 IRR 1 personnel settlement null R252-REF ${payrollId} completed true`;
      if (rowShape !== expectedRow) problems.push(`treasury row "${rowShape}", expected "${expectedRow}"`);

      const voucherRows = (await pool.query<{ code: string; detailed_type: string; debit: string; credit: string; currency: string }>(
        `SELECT a.code, i.detailed_type, i.debit::text AS debit, i.credit::text AS credit, coalesce(i.currency, '') AS currency
           FROM journal_voucher_items i JOIN accounts a ON a.id = i.account_id
          WHERE i.voucher_id = $1 AND i.is_deleted = 0 ORDER BY i.id`, [row?.voucher_id])).rows;
      const [bankLedger] = (await pool.query<{ code: string }>('SELECT a.code FROM bank_accounts b JOIN accounts a ON a.id = b.account_id WHERE b.id = $1', [bankId])).rows;
      const voucherShape = voucherRows.map(v => `${v.code}/${v.detailed_type}/${Number(v.debit)}/${Number(v.credit)}/${v.currency}`).join(' ; ');
      const expectedVoucher = `3201/personnel/350000/0/IRR ; ${bankLedger?.code}/bank_account/0/350000/IRR`;
      if (voucherShape !== expectedVoucher) problems.push(`voucher rows "${voucherShape}", expected "${expectedVoucher}"`);

      const [event] = (await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events WHERE event_type = 'TreasuryTransactionApproved' AND aggregate_id = $1`, [String(transactionId)])).rows;
      const keys = Object.keys(event?.payload ?? {}).sort().join(',');
      const expectedKeys = 'accountId,accountName,currency,isFullyPaid,payrollId,payrollNumber,transactionId,type';
      if (keys !== expectedKeys) problems.push(`event keys "${keys}", expected "${expectedKeys}"`);
      assertNoProblems(problems);
      return 'treasury row, voucher rows and event keys as before';
    });
  }

  return results;
}
