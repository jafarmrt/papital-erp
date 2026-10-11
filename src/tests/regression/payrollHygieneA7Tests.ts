import request from 'supertest';
import { eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { PayrollReadService } from '../../services/piecework/payrollRead.service.js';
import { createTestUser } from '../fixtures/factories.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Series 10 phase 3 lane L1, package A7 (v10.0.259): payroll payment hygiene from the phase 5 review. Voiding a payslip
 * payment writes its reversal event, payment and void audit rows are written in the payment transaction with the user,
 * address and amount, «my payslips» carries the paid amount, and a personnel treasury row or cheque needs the personnel
 * id. Each test is red on the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const PAYMENT_AUDIT_ENTITY = 'پرداخت حقوق';

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

/** An approved payslip of 1,000,000 and a funded bank account */
async function approvedPayslip(label: string): Promise<{ payrollId: number; bankId: number; workerId: number }> {
  const workerId = await newWorker(`ERP-TEST-MARKER A7 ${label}`);
  await addLog(workerId, await newTask(), '2026-04-05', 1_000_000);
  const issued = await issueApproved({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'a7' });
  if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
  return { payrollId: issued.payroll.id, bankId: await fundedBank(), workerId };
}

export async function runPayrollHygieneA7Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const eventId = 'reg_payroll_payment_void_event_and_audit_td_949_950';
  if (shouldRun(eventId, 'td949', 'td950', 'payroll', 'treasury', 'audit', 'outbox', 'a7')) {
    await runCase(results, eventId, 'v10.0.259: voiding a payslip payment writes the reversal row\'s treasury event, and the payment and its void each write one audit row in their transaction with the amount and the client address (TD-949 / TD-950)', async () => {
      const problems: string[] = [];
      const { payrollId, bankId } = await approvedPayslip('void event');
      const api = await adminClient();
      const paid = await api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 400_000 });
      const transactionId = Number((paid.body as { transactionId?: unknown } | undefined)?.transactionId);
      if (paid.status !== 200 || !transactionId) throw new Error(`setup: payment ${brief(paid)}`);

      const outboxCount = async () => Number((await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox_events WHERE aggregate_type = 'Treasury'`)).rows[0]?.n ?? 0);
      const before = await outboxCount();
      const voided = await api.post(`/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, { reason: 'A7 void' });
      if (voided.status !== 200) throw new Error(`setup: void ${brief(voided)}`);
      const after = await outboxCount();
      if (after !== before + 1) problems.push(`the void wrote ${after - before} treasury events, expected 1 (the reversal row)`);
      const reversal = (await pool.query<{ id: number }>('SELECT id FROM treasury_transactions WHERE reversal_of_id = $1', [transactionId])).rows[0];
      const event = (await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events WHERE aggregate_type = 'Treasury' AND aggregate_id = $1`, [String(reversal?.id ?? 0)])).rows[0];
      if (!event) problems.push('no outbox event carries the reversal row id');
      else if (event.payload.isReversal !== true || Number(event.payload.voidedTransactionId) !== transactionId || Number(event.payload.amount) !== 400_000) {
        problems.push(`the reversal event payload is ${JSON.stringify(event.payload).slice(0, 200)}`);
      }

      const audits = (await pool.query<{ action: string; ip_address: string; details: Record<string, unknown> }>(
        'SELECT action, ip_address, details FROM activity_logs WHERE entity = $1 AND entity_id = $2 ORDER BY id', [PAYMENT_AUDIT_ENTITY, String(payrollId)])).rows;
      const actions = audits.map(a => a.action).join(',');
      if (actions !== 'CREATE,DELETE') problems.push(`payment audit rows are ${actions || 'none'}, expected CREATE,DELETE`);
      for (const row of audits) {
        if (String(row.details?.amount ?? '') !== '400000') problems.push(`${row.action} audit row amount is ${String(row.details?.amount)}, expected 400000`);
        if (!row.ip_address) problems.push(`${row.action} audit row has no client address`);
      }
      assertNoProblems(problems);
      return 'the void wrote one reversal treasury event; the payment and its void each have an audit row with amount 400,000 and the client address';
    });
  }

  const mineId = 'reg_my_payslips_paid_amount_td_951';
  if (shouldRun(mineId, 'td951', 'payroll', 'payslip', 'a7')) {
    await runCase(results, mineId, 'v10.0.259: «my payslips» carries the payslip\'s paid amount, so its remaining amount matches the manager page (TD-951)', async () => {
      const { payrollId, bankId, workerId } = await approvedPayslip('mine');
      const user = await createTestUser({ username: `a7_mine_${tagOf()}` });
      await orm.update(personnel).set({ userId: user.id }).where(eq(personnel.id, workerId));
      const api = await adminClient();
      const paid = await api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 });
      if (paid.status !== 200) throw new Error(`setup: payment ${brief(paid)}`);
      const rows = await PayrollReadService.listPayrollsForUser(user.id) as Array<Record<string, unknown>>;
      const row = rows.find(r => Number(r.id) === payrollId);
      if (!row) throw new Error('the payslip is not in «my payslips»');
      if (Number(row.paidAmount) !== 300_000) throw new Error(`«my payslips» paidAmount is ${String(row.paidAmount)}, expected 300000`);
      return '«my payslips» carries paidAmount 300,000';
    });
  }

  const personnelId = 'reg_personnel_treasury_requires_id_td_954';
  if (shouldRun(personnelId, 'td954', 'treasury', 'cheque', 'personnel', 'a7')) {
    await runCase(results, personnelId, 'v10.0.259: a treasury payment or a cheque for personnel without the personnel id is refused with 422 TREASURY_PERSONNEL_REQUIRED and writes nothing (TD-954)', async () => {
      const problems: string[] = [];
      const bankId = await fundedBank();
      const api = await adminClient();
      const count = async (table: string) => Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n ?? 0);
      const treasuryBefore = await count('treasury_transactions');
      const payment = await api.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 2_000_000, bankAccountId: bankId, partyType: 'personnel', partyName: `A7 worker ${tagOf()}`, purpose: 'advance',
      });
      const code = String((payment.body as { code?: unknown } | undefined)?.code ?? '');
      if (payment.status !== 422 || code !== 'TREASURY_PERSONNEL_REQUIRED') problems.push(`a personnel payment without an id answered ${brief(payment)}, expected 422 TREASURY_PERSONNEL_REQUIRED`);
      if (await count('treasury_transactions') !== treasuryBefore) problems.push('the refused payment wrote a treasury row');

      const chequesBefore = await count('cheques');
      const cheque = await api.post('/api/accounting/cheques', {
        type: 'paid', chequeNumber: `A7${tagOf()}`, bankName: 'A7 bank', amount: 500_000, issueDate: '2026-04-01', dueDate: '2026-05-01',
        bankAccountId: bankId, partyType: 'personnel', partyName: `A7 worker ${tagOf()}`, purpose: 'advance',
      });
      const chequeCode = String((cheque.body as { code?: unknown } | undefined)?.code ?? '');
      if (cheque.status !== 422 || chequeCode !== 'TREASURY_PERSONNEL_REQUIRED') problems.push(`a personnel cheque without an id answered ${brief(cheque)}, expected 422 TREASURY_PERSONNEL_REQUIRED`);
      if (await count('cheques') !== chequesBefore) problems.push('the refused cheque was written');
      assertNoProblems(problems);
      return 'a personnel payment and a personnel cheque without the personnel id were refused with 422 and wrote nothing';
    });
  }

  return results;
}
