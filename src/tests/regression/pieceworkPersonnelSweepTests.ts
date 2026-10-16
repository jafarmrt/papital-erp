import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, personnel, pieceworkTaskRateHistory, pieceworkTasks } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../../services/accounting/payrollPaymentVoid.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v10.1.x closing sweep, piecework and personnel observations of package 12 (OBS-R2-50, OBS-R2-51, OBS-R2-53): each test is
 * red on v10.1.45. The failures are forced with a trigger that exists only in the test's isolated schema.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-6)}${++seq}`;
const brief = (body: unknown) => JSON.stringify(body).slice(0, 200);

/** A BEFORE INSERT trigger on `table` that refuses a row whose `column` holds `marker` (dropped with the sandbox schema) */
async function failInsertsHolding(table: string, column: string, marker: string): Promise<void> {
  const fn = `obs_sweep_fail_${table}`;
  await pool.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
    BEGIN
      IF NEW.${column} LIKE '%${marker}%' THEN RAISE EXCEPTION 'forced test failure on ${table}'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON ${table}`);
  await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
}

async function newTask(title: string, rate: number) {
  const [row] = await orm.insert(pieceworkTasks).values({ code: tag('PTS'), title, defaultRate: money(rate) }).returning();
  return row;
}

async function taskRow(id: number) {
  const [row] = await orm.select().from(pieceworkTasks).where(eq(pieceworkTasks.id, id));
  return row;
}

async function taskAuditRows(id: number) {
  return orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'عنوان پرکیسی'), eq(activityLogs.entityId, String(id)), eq(activityLogs.action, 'UPDATE')));
}

async function historyRows(taskId: number) {
  return orm.select().from(pieceworkTaskRateHistory).where(eq(pieceworkTaskRateHistory.taskId, taskId));
}

export async function runPieceworkPersonnelSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const taskId = 'reg_piecework_task_edit_tx_obs_r2_50';
  if (shouldRun(taskId, 'obs-r2-50', 'piecework', 'task', 'audit', 'history')) {
    await runCase(results, taskId, 'v10.1.50: a piecework task edit, its rate history row and its audit row are one transaction; a history or audit error refuses the edit (OBS-R2-50)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await failInsertsHolding('piecework_task_rate_history', 'task_title', 'HISTFAIL');
      await failInsertsHolding('activity_logs', 'description', 'AUDITFAIL');

      // 1) a successful edit writes its history and audit rows (the audit row with before / after of the changed fields)
      const ok = await newTask(tag('OBS-R2-50 ok '), 1000);
      const okRes = await admin.put(`/api/piecework/tasks/${ok.id}`, { defaultRate: '2500' });
      const okAudit = await taskAuditRows(ok.id);
      if (okRes.status !== 200) problems.push(`a valid edit answered ${okRes.status} ${brief(okRes.body)}`);
      if ((await historyRows(ok.id)).length !== 1) problems.push('a valid rate edit wrote no history row');
      const changes = (okAudit[0]?.details as { changes?: Record<string, unknown> } | undefined)?.changes ?? {};
      if (okAudit.length !== 1 || !('defaultRate' in changes)) problems.push(`a valid edit wrote ${okAudit.length} audit rows with changes ${brief(changes)}, expected one with defaultRate`);

      // 2) a history row that cannot be written refuses the edit (it was swallowed and the title still changed)
      const hist = await newTask(tag('OBS-R2-50 hist '), 1000);
      const histTitle = tag('OBS-R2-50 HISTFAIL ');
      const histRes = await admin.put(`/api/piecework/tasks/${hist.id}`, { title: histTitle });
      const histAfter = await taskRow(hist.id);
      if (histRes.status < 400) problems.push(`an edit whose history row failed answered ${histRes.status}, expected a refusal`);
      if (histAfter?.title !== hist.title) problems.push(`the title became «${histAfter?.title}» although its history row failed`);
      if ((await taskAuditRows(hist.id)).length !== 0) problems.push('a refused edit left an audit row');

      // 3) an audit row that cannot be written refuses the edit (the route wrote it after commit and the error was only logged)
      const audit = await newTask(tag('OBS-R2-50 AUDITFAIL '), 1000);
      const auditRes = await admin.put(`/api/piecework/tasks/${audit.id}`, { defaultRate: '9000' });
      const auditAfter = await taskRow(audit.id);
      if (auditRes.status < 400) problems.push(`an edit whose audit row failed answered ${auditRes.status}, expected a refusal`);
      if (!fin(auditAfter?.defaultRate ?? 0).equals(1000)) problems.push(`the rate became ${auditAfter?.defaultRate} although its audit row failed`);
      if ((await historyRows(audit.id)).length !== 0) problems.push('a refused edit left a rate history row');

      assertNoProblems(problems);
      return 'the edit commits with its history and audit rows; a failing history or audit row refuses it and changes nothing';
    }));
  }

  const amountId = 'reg_payroll_payment_exact_amount_currency_obs_r2_51';
  if (shouldRun(amountId, 'obs-r2-51', 'payroll', 'payment', 'currency')) {
    await runCase(results, amountId, 'v10.1.50: a payroll payment reaches the service with the exact decimal sent, and the payment and void answers name the payment currency instead of a fixed rial label (OBS-R2-51)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const register = PayrollPaymentService.registerPayrollPayment;
      const voidPayment = PayrollPaymentVoidService.voidPayrollPayment;
      const seen: unknown[] = [];
      const payroll = { payrollNumber: 'PAY-OBS51' } as Awaited<ReturnType<typeof register>>['payroll'];
      PayrollPaymentService.registerPayrollPayment = async (input) => {
        seen.push(input.amount);
        return { payroll, transactionNumber: 'T-OBS51', transactionId: 1, voucherId: null, voucherNumber: null, paidAmount: 10, remainingAmount: 2500, isFullyPaid: false, currency: 'USD' };
      };
      PayrollPaymentVoidService.voidPayrollPayment = async () => ({
        payroll, transactionNumber: 'T-OBS51', reversalTransactionNumber: 'R-OBS51', reversalVoucherId: null, paidAmount: 2500, currency: 'USD',
      });
      try {
        const exact = '12345678901234.5678';
        const pay = await admin.post('/api/piecework/payrolls/1/register-payment', { bankAccountId: 1, amount: exact });
        if (pay.status !== 200) problems.push(`the payment answered ${pay.status} ${brief(pay.body)}`);
        if (String(seen[0]) !== exact) problems.push(`the service got the amount ${String(seen[0])}, expected exactly ${exact}`);
        const payMessage = String(pay.body?.message ?? '');
        if (!payMessage.includes('دلار') || payMessage.includes('ریال')) problems.push(`the payment message does not name the payment currency: ${payMessage}`);
        const voided = await admin.post('/api/piecework/payrolls/1/payments/1/void', { reason: 'OBS-R2-51 test void' });
        const voidMessage = String(voided.body?.message ?? '');
        if (voided.status !== 200 || !voidMessage.includes('دلار') || voidMessage.includes('ریال')) problems.push(`the void answered ${voided.status} with a message that does not name the payment currency: ${voidMessage}`);
      } finally {
        PayrollPaymentService.registerPayrollPayment = register;
        PayrollPaymentVoidService.voidPayrollPayment = voidPayment;
      }
      assertNoProblems(problems);
      return 'the exact decimal string reaches the service and both answers name the currency the service returned';
    }));
  }

  const importId = 'reg_personnel_bulk_import_row_tx_obs_r2_53';
  if (shouldRun(importId, 'obs-r2-53', 'personnel', 'import', 'excel')) {
    await runCase(results, importId, 'v10.1.50: each personnel Excel import row is written with its audit row in its own transaction; a row whose audit fails leaves no personnel and the other rows still go in (OBS-R2-53)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await failInsertsHolding('activity_logs', 'description', 'AUDITFAIL');
      const good = tag('OBS-R2-53 good ');
      const broken = tag('OBS-R2-53 AUDITFAIL ');
      const res = await admin.post('/api/personnel/bulk-import', { rows: [{ fullName: good }, { fullName: broken }] });
      const errors = Array.isArray(res.body?.errors) ? res.body.errors as Array<{ row: number }> : [];
      const live = async (fullName: string) => (await orm.select({ id: personnel.id }).from(personnel)
        .where(and(eq(personnel.fullName, fullName), eq(personnel.isDeleted, 0)))).length;
      if (res.status !== 200 || res.body?.createdCount !== 1) problems.push(`the import answered ${res.status} ${brief(res.body)}, expected 200 with one created personnel`);
      if (!errors.some(e => e.row === 2)) problems.push(`the import errors list rows ${errors.map(e => e.row).join(',') || 'none'}, expected row 2`);
      if (await live(good) !== 1) problems.push('the good row was not saved');
      if (await live(broken) !== 0) problems.push('the row whose audit row failed was saved without its audit row');
      assertNoProblems(problems);
      return 'the good row is saved with its audit row; the row whose audit row failed is reported and leaves no personnel';
    }));
  }

  return results;
}
