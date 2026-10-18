import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * 10.2 package 8 (TD-1297, review of #320): the «تراکنش خزانه تأیید شد» event of the treasury form (receipt, payment,
 * void, bank transfer), the petty cash statement and the monthly insurance or tax payment (`statutoryRemittanceTests`)
 * carries no amount, description or void reason, which reached every «*» webhook and rule; and `PayrollPaid` /
 * `PayrollPaymentVoided` carry no personnel name or amount (backlog guard).
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const PRIVATE_TREASURY_KEYS = ['amount', 'description', 'reason'];
/** the party name and the text written on the treasury rows, which must not reach the event */
const PARTY_NAME = 'گیرنده محرمانه رویداد خزانه';
const ROW_TEXT = 'شرح محرمانه رویداد خزانه';
const VOID_REASON = 'دلیل محرمانه ابطال';
const PAYROLL_ALLOWED_KEYS = ['payrollId', 'payrollNumber', 'personnelId', 'startDate', 'endDate', 'status', 'transactionId', 'isFullyPaid', 'voidedTransactionId'];

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
  };
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;

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

async function eventPayloads(eventType: string, aggregateIds: number[]): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
  const rows = (await pool.query<{ aggregate_id: string; payload: Record<string, unknown> }>(
    'SELECT aggregate_id, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = ANY($2::text[]) ORDER BY id',
    [eventType, aggregateIds.map(String)],
  )).rows;
  return rows.map(r => ({ id: r.aggregate_id, payload: r.payload }));
}

/** the problems of the treasury events of these rows: a missing event, a private key, or private text */
export async function treasuryEventLeaks(transactionIds: number[], privateTexts: string[] = []): Promise<string[]> {
  const problems: string[] = [];
  const events = await eventPayloads('TreasuryTransactionApproved', transactionIds);
  for (const id of transactionIds) {
    if (!events.some(e => e.id === String(id))) problems.push(`treasury row ${id} wrote no TreasuryTransactionApproved event`);
  }
  for (const { id, payload } of events) {
    const leaked = PRIVATE_TREASURY_KEYS.filter(key => key in payload);
    if (leaked.length > 0) problems.push(`the event of treasury row ${id} carries ${leaked.join(', ')}`);
    const text = JSON.stringify(payload);
    for (const secret of privateTexts) if (text.includes(secret)) problems.push(`the event of treasury row ${id} carries the private text "${secret.slice(0, 20)}"`);
  }
  return problems;
}

const reversalOf = async (transactionId: number) =>
  Number((await pool.query<{ id: number }>('SELECT id FROM treasury_transactions WHERE reversal_of_id = $1', [transactionId])).rows[0]?.id ?? 0);

export async function runTreasuryEventPrivacyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const formId = 'reg_treasury_form_event_without_amount_td_1297';
  if (shouldRun(formId, 'td1297', 'treasury', 'event', 'outbox', 'privacy', 'package8')) {
    await runCase(results, formId, 'v10.2.7: a treasury form receipt and payment, their void and a bank transfer write their event without amount, description or void reason (TD-1297)', async () => {
      const api = await adminClient();
      const bankId = await fundedBank();
      const otherBank = await fundedBank();
      const contraAccountId = await miscContraAccountId();
      const receipt = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 734_519, bankAccountId: bankId, partyType: 'other',
        contraAccountId, partyName: PARTY_NAME, description: ROW_TEXT,
      });
      const payment = await api.post('/api/accounting/treasury', {
        type: 'payment', method: 'cash', amount: 211_207, bankAccountId: bankId, partyType: 'other',
        contraAccountId, partyName: PARTY_NAME, description: ROW_TEXT,
      });
      const receiptId = Number((receipt.body as { id?: unknown })?.id);
      const paymentId = Number((payment.body as { id?: unknown })?.id);
      if (!receiptId || !paymentId) throw new Error(`setup: receipt ${brief(receipt)}, payment ${brief(payment)}`);
      const voided = await api.post(`/api/accounting/treasury/${paymentId}/void`, { reason: VOID_REASON });
      if (voided.status !== 200) throw new Error(`setup: void ${brief(voided)}`);
      const transfer = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: bankId, toBankAccountId: otherBank, amount: 98_765, description: ROW_TEXT });
      const pair = transfer.body as { payment?: { id?: number }; receipt?: { id?: number } };
      if (transfer.status !== 201 || !pair.receipt?.id) throw new Error(`setup: transfer ${brief(transfer)}`);

      const ids = [receiptId, paymentId, await reversalOf(paymentId), Number(pair.receipt.id)];
      const problems = await treasuryEventLeaks(ids, [PARTY_NAME, ROW_TEXT, VOID_REASON, '734519', '211207', '98765']);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `${ids.length} treasury events without amount, description or reason`;
    });
  }

  const pettyId = 'reg_petty_cash_event_without_amount_td_1297';
  if (shouldRun(pettyId, 'td1297', 'treasury', 'petty_cash', 'event', 'privacy', 'package8')) {
    await runCase(results, pettyId, 'v10.2.7: a petty cash statement writes its treasury event without amount or description (TD-1297)', async () => {
      const api = await adminClient();
      const pettyLedger = Number((await pool.query<{ id: number }>(`SELECT id FROM accounts WHERE code = '1006' AND is_deleted = 0`)).rows[0]?.id ?? 0);
      if (!pettyLedger) throw new Error('setup: standard account 1006 is missing');
      const fund = await BankAccountService.createBankAccount({ title: `تنخواه رویداد ${tagOf()}`, type: 'petty_cash', accountId: pettyLedger, initialBalance: 0, currency: 'IRR' });
      const charge = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: await fundedBank(), toBankAccountId: fund.id, amount: 2_000_000 });
      if (charge.status !== 201) throw new Error(`setup: charge ${brief(charge)}`);
      const options = await api.get('/api/accounting/treasury/petty-cash/expense-accounts');
      const expense = ((options.body as { data?: Array<{ id: number }> }).data ?? [])[0];
      if (!expense) throw new Error(`setup: no expense account (${brief(options)})`);
      const statement = await api.post(`/api/accounting/treasury/petty-cash/${fund.id}/expenses`, {
        description: ROW_TEXT, lines: [{ accountId: expense.id, amount: 456_789, description: ROW_TEXT, sellerName: PARTY_NAME }],
      });
      const statementId = Number((statement.body as { id?: unknown; transactionId?: unknown })?.transactionId ?? (statement.body as { id?: unknown })?.id);
      if (statement.status !== 201 || !statementId) throw new Error(`setup: statement ${brief(statement)}`);
      const problems = await treasuryEventLeaks([statementId], [PARTY_NAME, ROW_TEXT, '456789']);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the petty cash statement event carries no amount or description';
    });
  }

  const payrollId = 'reg_payroll_paid_event_without_name_or_amount_td_1297';
  if (shouldRun(payrollId, 'td1297', 'payroll', 'event', 'privacy', 'package8')) {
    await runCase(results, payrollId, 'v10.2.7: PayrollPaid and PayrollPaymentVoided carry only the payslip ids, dates and status, never the personnel name or an amount (guard, TD-1297)', async () => {
      const api = await adminClient();
      const workerName = `ERP-TEST-MARKER کارکن محرمانه ${tagOf()}`;
      const workerId = await newWorker(workerName);
      const storedName = String((await pool.query<{ n: string }>('SELECT full_name AS n FROM personnel WHERE id = $1', [workerId])).rows[0]?.n);
      await addLog(workerId, await newTask(), '2026-04-05', 1_234_567);
      const issued = await issueApproved({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'td1297' });
      if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
      const bankId = await fundedBank();
      const paid = await api.post(`/api/piecework/payrolls/${issued.payroll.id}/register-payment`, { bankAccountId: bankId, method: 'cash', amount: 345_678 });
      const transactionId = Number((paid.body as { transactionId?: unknown })?.transactionId);
      if (paid.status !== 200 || !transactionId) throw new Error(`setup: payment ${brief(paid)}`);
      const voided = await api.post(`/api/piecework/payrolls/${issued.payroll.id}/payments/${transactionId}/void`, { reason: VOID_REASON });
      if (voided.status !== 200) throw new Error(`setup: payment void ${brief(voided)}`);

      const problems: string[] = [];
      for (const type of ['PayrollPaid', 'PayrollPaymentVoided']) {
        const events = await eventPayloads(type, [issued.payroll.id]);
        if (events.length === 0) problems.push(`the payslip wrote no ${type}`);
        for (const { payload } of events) {
          const extra = Object.keys(payload).filter(key => !PAYROLL_ALLOWED_KEYS.includes(key));
          if (extra.length > 0) problems.push(`${type} carries ${extra.join(', ')}`);
          const text = JSON.stringify(payload);
          for (const secret of [storedName, '1234567', '345678', VOID_REASON]) if (text.includes(secret)) problems.push(`${type} carries "${secret.slice(0, 20)}"`);
        }
      }
      problems.push(...await treasuryEventLeaks([transactionId, await reversalOf(transactionId)], [storedName, '345678', VOID_REASON]));
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'PayrollPaid, PayrollPaymentVoided and their treasury events carry no name or amount';
    });
  }

  const healthId = 'reg_treasury_amount_rule_health_td_1297';
  if (shouldRun(healthId, 'td1297', 'treasury', 'event', 'rule', 'health', 'package8')) {
    await runCase(results, healthId, 'v10.2.7: the financial health check lists the automatic rules of the treasury event that read its amount, description or reason, which it no longer carries, and leaves them as saved (TD-1297)', async () => {
      const { findTreasuryPrivateFieldRules, buildTreasuryPrivateFieldRuleHealthTest } = await import('../../services/accounting/treasuryRuleFieldHealth.js');
      const tag = tagOf();
      const inserted = await orm.insert(eventActionRules).values([
        { name: `TD1297 amount ${tag}`, eventType: 'TreasuryTransactionApproved', actionType: 'audit_log', conditionsJson: [{ field: 'payload.amount', operator: 'gte', value: 500000000 }], actionConfigJson: { descriptionTemplate: 'x' }, isActive: 1 },
        { name: `TD1297 text ${tag}`, eventType: '*', actionType: 'audit_log', conditionsJson: [], actionConfigJson: { descriptionTemplate: 'شرح {{payload.description}}' }, isActive: 0 },
        { name: `TD1297 currency ${tag}`, eventType: 'TreasuryTransactionApproved', actionType: 'audit_log', conditionsJson: [{ field: 'payload.currency', operator: 'eq', value: 'IRR' }], actionConfigJson: {}, isActive: 1 },
        { name: `TD1297 invoice ${tag}`, eventType: 'InvoiceApproved', actionType: 'audit_log', conditionsJson: [{ field: 'payload.amount', operator: 'gt', value: 0 }], actionConfigJson: {}, isActive: 1 },
      ]).returning({ id: eventActionRules.id, name: eventActionRules.name });
      try {
        const listed = (await findTreasuryPrivateFieldRules()).filter(r => r.name.endsWith(tag));
        const names = listed.map(r => `${r.name.split(' ')[1]}:${r.fields.join('+')}`).sort().join(',');
        if (names !== 'amount:payload.amount,text:payload.description') throw new Error(`the health check listed "${names}", expected the amount and the description rules only`);
        const test = buildTreasuryPrivateFieldRuleHealthTest(listed);
        if (test.status !== 'warning' || test.count !== 2) throw new Error(`the health test is ${test.status} with ${test.count}`);
        const kept = await orm.select({ c: eventActionRules.conditionsJson }).from(eventActionRules).where(inArray(eventActionRules.id, inserted.map(r => r.id)));
        if (JSON.stringify(kept[0]?.c).indexOf('payload.amount') < 0) throw new Error('the listed rule was rewritten');
        return 'amount and description rules listed, currency and invoice rules not';
      } finally {
        await orm.delete(eventActionRules).where(inArray(eventActionRules.id, inserted.map(r => r.id)));
      }
    });
  }

  return results;
}
