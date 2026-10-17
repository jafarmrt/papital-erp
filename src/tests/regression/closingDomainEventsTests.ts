import request from 'supertest';
import { pool } from '../../db/drizzle.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { addLog, fundedBank, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * v10.1.62 closing sweep, decision ت۴۰ item 11 (OBS-R2-13 / OBS-R1-64): a cheque status change, a payslip approval and
 * each payslip payment write their domain event to the outbox in their own transaction, so rules and webhooks see them.
 * Red on v10.1.61, which wrote none of the three.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

interface OutboxRow { event_type: string; payload: Record<string, unknown> }

async function eventsOf(aggregateType: string, aggregateId: number): Promise<OutboxRow[]> {
  return (await pool.query<OutboxRow>(
    'SELECT event_type, payload FROM outbox_events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY id',
    [aggregateType, String(aggregateId)],
  )).rows;
}

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

export async function runClosingDomainEventsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const chequeId = 'reg_cheque_status_changed_event_obs_r2_13';
  if (shouldRun(chequeId, 'obs-r2-13', 'obs-r1-64', 'cheque', 'event', 'outbox')) {
    await runCase(results, chequeId, 'v10.1.62: a cheque status change writes ChequeStatusChanged with the old and new status in its transaction, and a refused change writes none (OBS-R2-13)', async () => {
      const problems: string[] = [];
      const cheque = await ChequeLifecycleService.createCheque({
        type: 'received', chequeNumber: `EVC${tagOf()}`, amount: 250000, partyName: 'Event sweep customer',
        bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', username: 'inv',
      });
      await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'in_collection', username: 'inv' });
      const events = await eventsOf('Cheque', cheque.id);
      const changed = events.filter(e => e.event_type === 'ChequeStatusChanged');
      if (changed.length !== 1) problems.push(`expected 1 ChequeStatusChanged, got ${changed.length}`);
      const p = changed[0]?.payload ?? {};
      if (p.previousStatus !== 'received' || p.newStatus !== 'in_collection') problems.push(`statuses ${String(p.previousStatus)} -> ${String(p.newStatus)}`);
      if (Number(p.amount) !== 250000 || p.chequeType !== 'received' || !p.newStatusLabel) problems.push(`payload ${JSON.stringify(p).slice(0, 200)}`);

      const refused = await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'spent', username: 'inv' }).then(() => false, () => true);
      if (!refused) problems.push('in_collection -> spent was accepted');
      const after = (await eventsOf('Cheque', cheque.id)).filter(e => e.event_type === 'ChequeStatusChanged').length;
      if (after !== 1) problems.push(`a refused change left ${after - 1} extra events`);
      if (problems.length) throw new Error(problems.join(' | '));
      return 'one ChequeStatusChanged with both statuses; the refused change wrote none';
    });
  }

  const payrollId = 'reg_payroll_approved_paid_events_obs_r2_13';
  if (shouldRun(payrollId, 'obs-r2-13', 'obs-r1-64', 'payroll', 'event', 'outbox')) {
    await runCase(results, payrollId, 'v10.1.62: approving a payslip writes PayrollApproved and each payment PayrollPaid with its treasury row and whether it settled the payslip, never a name or an amount (OBS-R2-13)', async () => {
      const problems: string[] = [];
      const workerId = await newWorker(`ERP-TEST-MARKER events ${tagOf()}`);
      await addLog(workerId, await newTask(), '2026-04-05', 1_000_000);
      const issued = await PieceworkPayrollService.generatePayroll({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' });
      if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
      const id = issued.payroll.id;
      if ((await eventsOf('Payroll', id)).length !== 0) problems.push('issuing a draft wrote a payroll event');

      await PieceworkPayrollService.updatePayrollStatus(id, { status: 'approved', username: 'inv' });
      const approved = (await eventsOf('Payroll', id)).filter(e => e.event_type === 'PayrollApproved');
      if (approved.length !== 1) problems.push(`expected 1 PayrollApproved, got ${approved.length}`);
      if (approved[0] && (approved[0].payload.status !== 'approved' || approved[0].payload.personnelId !== workerId)) problems.push(`approved payload ${JSON.stringify(approved[0].payload).slice(0, 200)}`);
      // no name and no amount in a payslip event (review of #306): they reach every «*» webhook and the event screens
      const leaks = (payload: Record<string, unknown>) => ['personnelName', 'netPayable', 'paidAmount', 'remainingAmount', 'paymentAmount', 'currency']
        .filter(key => key in payload);

      const bankId = await fundedBank();
      const api = await adminClient();
      const net = Number((await pool.query<{ n: string }>('SELECT net_payable::text AS n FROM piecework_payrolls WHERE id = $1', [id])).rows[0]?.n ?? 0);
      if (approved[0] && leaks(approved[0].payload).length > 0) problems.push(`PayrollApproved carries ${leaks(approved[0].payload).join(', ')}`);
      const first = await api.post(`/api/piecework/payrolls/${id}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: 400_000 });
      const second = await api.post(`/api/piecework/payrolls/${id}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', amount: net - 400_000 });
      if (first.status !== 200 || second.status !== 200) throw new Error(`setup: payments ${first.status} ${second.status}`);
      const paid = (await eventsOf('Payroll', id)).filter(e => e.event_type === 'PayrollPaid');
      if (paid.length !== 2) problems.push(`expected 2 PayrollPaid, got ${paid.length}`);
      for (const event of paid) if (leaks(event.payload).length > 0) problems.push(`PayrollPaid carries ${leaks(event.payload).join(', ')}`);
      if (paid[0] && (!Number(paid[0].payload.transactionId) || paid[0].payload.isFullyPaid !== false || paid[0].payload.status !== 'partially_paid')) {
        problems.push(`first payment payload ${JSON.stringify(paid[0].payload).slice(0, 200)}`);
      }
      if (paid[1] && (paid[1].payload.isFullyPaid !== true || paid[1].payload.status !== 'paid')) {
        problems.push(`second payment payload ${JSON.stringify(paid[1].payload).slice(0, 200)}`);
      }
      if (problems.length) throw new Error(problems.join(' | '));
      return 'PayrollApproved once, PayrollPaid per payment with its settlement, no name or amount';
    });
  }

  const privacyId = 'reg_payroll_treasury_event_privacy_and_void_events';
  if (shouldRun(privacyId, 'obs-r2-13', 'payroll', 'event', 'outbox', 'privacy')) {
    await runCase(results, privacyId, 'v10.1.66: a payslip payment and its void send their treasury event without amount, name or text, the void writes PayrollPaymentVoided and deleting the payslip PayrollDeleted (review of #306)', async () => {
      const problems: string[] = [];
      const name = `ERP-TEST-MARKER privacy ${tagOf()}`;
      const workerId = await newWorker(name);
      await addLog(workerId, await newTask(), '2026-04-06', 900_000);
      const issued = await PieceworkPayrollService.generatePayroll({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' });
      if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
      const id = issued.payroll.id;
      await PieceworkPayrollService.updatePayrollStatus(id, { status: 'approved', username: 'inv' });
      const api = await adminClient();
      const paid = await api.post(`/api/piecework/payrolls/${id}/register-payment`, { bankAccountId: await fundedBank(), method: 'bank_transfer', amount: 300_000 });
      if (paid.status !== 200) throw new Error(`setup: payment ${paid.status}`);
      const rows = async () => (await pool.query<{ id: number; reversal_of_id: number | null }>(
        'SELECT id, reversal_of_id FROM treasury_transactions WHERE payroll_id = $1 ORDER BY id', [id])).rows;
      const payment = (await rows())[0];
      if (!payment) throw new Error('setup: no treasury row for the payment');
      const leaks = (payload: Record<string, unknown>) => {
        const found = ['amount', 'remainingAmount', 'description', 'reason', 'partyName'].filter(key => key in payload);
        if (JSON.stringify(payload).includes(name)) found.push('the employee name');
        return found;
      };
      const paidEvent = (await eventsOf('Treasury', payment.id)).find(e => e.event_type === 'TreasuryTransactionApproved');
      if (!paidEvent) problems.push('the payment wrote no TreasuryTransactionApproved');
      else if (leaks(paidEvent.payload).length > 0) problems.push(`the payment event carries ${leaks(paidEvent.payload).join(', ')}`);
      else if (paidEvent.payload.payrollId !== id || paidEvent.payload.isFullyPaid !== false) problems.push(`payment event ${JSON.stringify(paidEvent.payload).slice(0, 200)}`);

      const voided = await api.post(`/api/piecework/payrolls/${id}/payments/${payment.id}/void`, { reason: `voided for ${name}` });
      if (voided.status !== 200) throw new Error(`setup: void ${voided.status} ${JSON.stringify(voided.body).slice(0, 200)}`);
      const reversal = (await rows()).find(r => r.reversal_of_id === payment.id);
      const voidEvent = reversal ? (await eventsOf('Treasury', reversal.id)).find(e => e.event_type === 'TreasuryTransactionApproved') : undefined;
      if (!voidEvent) problems.push('the void wrote no TreasuryTransactionApproved');
      else if (leaks(voidEvent.payload).length > 0) problems.push(`the void event carries ${leaks(voidEvent.payload).join(', ')}`);
      const payrollVoided = (await eventsOf('Payroll', id)).filter(e => e.event_type === 'PayrollPaymentVoided');
      if (payrollVoided.length !== 1) problems.push(`expected 1 PayrollPaymentVoided, got ${payrollVoided.length}`);
      else if (payrollVoided[0].payload.voidedTransactionId !== payment.id || payrollVoided[0].payload.status !== 'approved' || leaks(payrollVoided[0].payload).length > 0) {
        problems.push(`PayrollPaymentVoided ${JSON.stringify(payrollVoided[0].payload).slice(0, 200)}`);
      }

      await PieceworkPayrollService.deletePayroll(id, { username: 'inv' });
      const deleted = (await eventsOf('Payroll', id)).filter(e => e.event_type === 'PayrollDeleted');
      if (deleted.length !== 1) problems.push(`expected 1 PayrollDeleted, got ${deleted.length}`);

      const draft = await PieceworkPayrollService.generatePayroll({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' });
      if (draft.payroll) {
        await PieceworkPayrollService.deletePayroll(draft.payroll.id, { username: 'inv' });
        if ((await eventsOf('Payroll', draft.payroll.id)).length !== 0) problems.push('deleting a draft payslip wrote a payroll event');
      }
      if (problems.length) throw new Error(problems.join(' | '));
      return 'payment and void treasury events without amount, name or text; PayrollPaymentVoided and PayrollDeleted once; nothing for a draft';
    });
  }

  return results;
}
