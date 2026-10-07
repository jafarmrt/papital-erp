import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel, pieceworkPayrolls } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { findPayrollVoucherMismatches } from '../../services/piecework/payrollVoucherHealth.js';
import { addLog, fundedBank, newTask, newWorker, payrollCount, personNet } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Package 12 payroll, PR «الف»: payslip integrity on real Express routes and PostgreSQL. Each scenario runs in its own
 * isolated schema with the standard chart of accounts and is red on the version before its fix.
 */

const PERIOD = { startDate: '2026-04-01', endDate: '2026-04-30' };
let seq = 0;

/** A payslip row written straight to the table, the way versions before v9.0.231 could leave one */
async function legacyPayslip(personnelId: number, amounts: { piecework: number; deductions: number; net: number }): Promise<number> {
  const [row] = await orm.insert(pieceworkPayrolls).values({
    payrollNumber: `PAY-L${Date.now().toString().slice(-6)}${++seq}`, personnelId, ...PERIOD, title: 'TD-804 legacy payslip',
    totalPieceworkAmount: money(amounts.piecework), totalFixedAmount: money(0), totalBonuses: money(0),
    totalDeductions: money(amounts.deductions), advanceDeduction: money(0), netPayable: money(amounts.net), status: 'approved', isDeleted: 0,
  }).returning({ id: pieceworkPayrolls.id });
  return row.id;
}

/** A mixed-salary personnel with 30,000,000 a month */
async function salariedWorker(name: string, extra: { employmentStatus?: string; endDate?: string } = {}): Promise<number> {
  const [row] = await orm.insert(personnel).values({
    fullName: `${name} ${Date.now().toString().slice(-6)}${++seq}`, salaryType: 'mixed', monthlySalary: money(30_000_000), ...extra,
  }).returning({ id: personnel.id });
  return row.id;
}

const isoPlusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const codeOf = (body: unknown) => String((body as { code?: string } | undefined)?.code ?? '');
const brief = (body: unknown) => JSON.stringify(body).slice(0, 200);

export async function runPayrollIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const negativeId = 'reg_payroll_negative_components_td_804';
  if (shouldRun(negativeId, 'td804', 'payroll', 'payslip', 'package12')) {
    await runCase(results, negativeId, 'v9.0.231: negative bonuses, deductions or advance deductions are refused (400 / 422 PAYROLL_NEGATIVE_COMPONENT), a payslip voucher that would not credit wages payable with the net is refused, a payslip without a voucher is not paid (409 PAYROLL_WITHOUT_VOUCHER), and the health check lists such payslips (TD-804)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const task = await newTask();

      // 1) the payslip form: each negative part is a 400 and nothing is written (deductions -100,000 used to raise the net)
      const worker = await newWorker('TD-804 worker');
      await addLog(worker, task, '2026-04-05', 1_000_000);
      for (const extra of [{ deductions: '-100000' }, { totalDeductions: -100000 }, { bonuses: '-100000' }, { advanceDeduction: '-1' }]) {
        const res = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...PERIOD, ...extra });
        if (res.status !== 400) problems.push(`generate with ${JSON.stringify(extra)} answered ${res.status} ${brief(res.body)}, expected 400`);
      }
      if (await payrollCount(worker) !== 0) problems.push(`${await payrollCount(worker)} payslips were written for refused negative parts`);

      // 2) the service refuses a negative part too (a caller without the route schema)
      try {
        await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD, deductions: -100000, username: 'reg' });
        problems.push('the service accepted negative deductions');
      } catch (err) {
        const e = err as { statusCode?: number; code?: string };
        if (e.statusCode !== 422 || e.code !== 'PAYROLL_NEGATIVE_COMPONENT') problems.push(`the service refused negative deductions with ${e.statusCode} ${e.code}, expected 422 PAYROLL_NEGATIVE_COMPONENT`);
      }

      // 3) a valid payslip with bonuses and deductions: its voucher credits wages payable with exactly the net
      const valid = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...PERIOD, bonuses: 50000, deductions: 150000 });
      if (valid.status !== 200 && valid.status !== 201) problems.push(`a valid payslip answered ${valid.status} ${brief(valid.body)}`);
      else {
        const payable = await personNet('3201', worker);
        if (!fin(payable).equals(-900000)) problems.push(`wages payable of the valid payslip is ${payable}, expected credit 900,000 (the net)`);
      }

      // 4) payslips older versions could leave: their voucher is refused with a reason instead of a voucher that misses the net
      const legacyWorker = await newWorker('TD-804 legacy');
      const negative = await legacyPayslip(legacyWorker, { piecework: 1_000_000, deductions: -100_000, net: 1_100_000 });
      const corrupt = await legacyPayslip(legacyWorker, { piecework: 0, deductions: 0, net: 300_000 });
      const unvouchered = await legacyPayslip(legacyWorker, { piecework: 400_000, deductions: 0, net: 400_000 });
      for (const [id, code] of [[negative, 'PAYROLL_NEGATIVE_COMPONENT'], [corrupt, 'PAYROLL_VOUCHER_NET_MISMATCH']] as const) {
        const res = await admin.post(`/api/piecework/payrolls/${id}/sync-voucher`, {});
        if (res.status !== 422 || codeOf(res.body) !== code) problems.push(`voucher sync of legacy payslip ${id} answered ${res.status} ${brief(res.body)}, expected 422 ${code}`);
      }
      if (!fin(await personNet('3201', legacyWorker)).isZero()) problems.push('a refused legacy voucher still posted to wages payable');

      // 5) the health check lists all three
      const listedBefore = (await findPayrollVoucherMismatches()).map(e => e.id).sort((a, b) => a - b);
      const expectedBefore = [negative, corrupt, unvouchered].sort((a, b) => a - b);
      if (JSON.stringify(listedBefore) !== JSON.stringify(expectedBefore)) problems.push(`payslip mismatches listed ${JSON.stringify(listedBefore)}, expected ${JSON.stringify(expectedBefore)}`);
      const health = (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'payroll_voucher_mismatch');
      if (!health || health.status !== 'warning' || health.count !== 3) problems.push(`health check payroll_voucher_mismatch: ${health?.status} count ${health?.count}, expected warning with 3`);

      // 6) a payslip without a voucher is paid only after its voucher is issued
      const bankId = await fundedBank();
      const refused = await admin.post(`/api/piecework/payrolls/${unvouchered}/register-payment`, { bankAccountId: bankId, paymentDate: '2026-05-01' });
      if (refused.status !== 409 || codeOf(refused.body) !== 'PAYROLL_WITHOUT_VOUCHER') problems.push(`paying a payslip without a voucher answered ${refused.status} ${brief(refused.body)}, expected 409 PAYROLL_WITHOUT_VOUCHER`);
      const [afterRefusal] = await orm.select({ status: pieceworkPayrolls.status }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, unvouchered));
      if (afterRefusal?.status !== 'approved') problems.push(`the refused payslip is now ${afterRefusal?.status}`);
      const synced = await admin.post(`/api/piecework/payrolls/${unvouchered}/sync-voucher`, {});
      if (synced.status !== 200) problems.push(`voucher sync of the unvouchered payslip answered ${synced.status} ${brief(synced.body)}`);
      const paid = await admin.post(`/api/piecework/payrolls/${unvouchered}/register-payment`, { bankAccountId: bankId, paymentDate: '2026-05-01' });
      if (paid.status !== 200 && paid.status !== 201) problems.push(`paying the payslip after its voucher answered ${paid.status} ${brief(paid.body)}`);
      const listedAfter = (await findPayrollVoucherMismatches()).map(e => e.id);
      if (listedAfter.includes(unvouchered)) problems.push('the repaired payslip is still listed by the health check');

      assertNoProblems(problems);
      return 'Four negative parts refused with 400 and the service with 422, the valid payslip credited wages payable with its net 900,000, two legacy vouchers refused with their codes, three payslips listed by the health check, and the unvouchered payslip paid only after its voucher was issued.';
    }));
  }

  const serviceEndId = 'reg_payroll_fixed_salary_service_end_td_808';
  if (shouldRun(serviceEndId, 'td808', 'payroll', 'payslip', 'fixed', 'package12')) {
    await runCase(results, serviceEndId, 'v9.0.233: fixed salary is granted only up to the end of service (pro rata by days), a period after it gets none, a terminated personnel without an end date is 422 PAYROLL_SERVICE_END_DATE_REQUIRED and a period ending after today is 422 PAYROLL_PERIOD_IN_FUTURE (TD-808)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const generate = (personnelId: number, startDate: string, endDate: string) => admin.post('/api/piecework/payrolls/generate', { personnelId, startDate, endDate });
      const fixedOf = (body: unknown) => String((body as { totalFixedAmount?: unknown } | undefined)?.totalFixedAmount ?? '-');

      // 1) terminated on 2026-08-22 (1405/05/31): Mordad 16..31 is 16 of 31 days of 30,000,000; Shahrivar 1..15 earns nothing
      const leaver = await salariedWorker('TD-808 leaver', { employmentStatus: 'قطع همکاری', endDate: '2026-08-22' });
      const straddling = await generate(leaver, '1405/05/16', '1405/06/15');
      if (straddling.status !== 201 && straddling.status !== 200) problems.push(`the payslip across the end of service answered ${straddling.status} ${brief(straddling.body)}`);
      else if (!fin(fixedOf(straddling.body)).equals(15_483_871)) problems.push(`fixed salary across the end of service is ${fixedOf(straddling.body)}, expected 15,483,871 (16 of 31 days of Mordad)`);

      // 2) a period after the end of service: piecework only, and without work logs no payslip at all
      const task = await newTask();
      await addLog(leaver, task, '2026-09-10', 500_000);
      const after = await generate(leaver, '1405/06/16', '1405/06/31');
      if (after.status !== 201 && after.status !== 200) problems.push(`the payslip after the end of service answered ${after.status} ${brief(after.body)}`);
      else if (!fin(fixedOf(after.body)).isZero()) problems.push(`the payslip after the end of service has fixed salary ${fixedOf(after.body)}, expected 0`);
      const empty = await generate(leaver, '1405/07/01', '1405/07/10');
      if (empty.status !== 400) problems.push(`a period after the end of service without work logs answered ${empty.status} ${brief(empty.body)}, expected 400`);

      // 3) a terminated personnel without an end date gets no fixed-salary payslip until the date is recorded
      const undated = await salariedWorker('TD-808 undated', { employmentStatus: 'قطع همکاری', endDate: '' });
      const refusedUndated = await generate(undated, '1405/06/01', '1405/06/31');
      if (refusedUndated.status !== 422 || codeOf(refusedUndated.body) !== 'PAYROLL_SERVICE_END_DATE_REQUIRED') problems.push(`a terminated personnel without an end date answered ${refusedUndated.status} ${brief(refusedUndated.body)}, expected 422 PAYROLL_SERVICE_END_DATE_REQUIRED`);

      // 4) a period ending after the business today is refused, for any personnel
      const today = await businessTodayIsoDate();
      const active = await salariedWorker('TD-808 active');
      const future = await generate(active, today, isoPlusDays(today, 30));
      if (future.status !== 422 || codeOf(future.body) !== 'PAYROLL_PERIOD_IN_FUTURE') problems.push(`a period ending after today answered ${future.status} ${brief(future.body)}, expected 422 PAYROLL_PERIOD_IN_FUTURE`);
      if (await payrollCount(undated) + await payrollCount(active) !== 0) problems.push('a refused payslip was written');

      assertNoProblems(problems);
      return 'Fixed salary 15,483,871 up to the end of service, none after it, the undated leaver refused with 422 and a period ending after today refused with 422.';
    }));
  }

  const draftId = 'reg_payroll_pay_only_approved_td_816';
  if (shouldRun(draftId, 'td816', 'payroll', 'payslip', 'payment', 'package12')) {
    await runCase(results, draftId, 'v9.0.234: a draft payslip is not paid (409 PAYROLL_NOT_APPROVED) and the status route no longer writes the payment date, method or reference (400) (TD-816)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const worker = await newWorker('TD-816 worker');
      await addLog(worker, await newTask(), '2026-04-08', 800_000);
      const issued = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...PERIOD });
      const payrollId = Number((issued.body as { id?: number })?.id);
      if (issued.status !== 201 || !payrollId) throw new Error(`issuing the payslip answered ${issued.status} ${brief(issued.body)}`);
      const bankId = await fundedBank();
      const row = async () => (await orm.select({ status: pieceworkPayrolls.status, paidAmount: pieceworkPayrolls.paidAmount, paymentMethod: pieceworkPayrolls.paymentMethod, paymentDate: pieceworkPayrolls.paymentDate })
        .from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId)))[0];

      // 1) a draft is not paid; approving it makes it payable
      const toDraft = await admin.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'draft' });
      if (toDraft.status !== 200) problems.push(`moving the payslip to draft answered ${toDraft.status} ${brief(toDraft.body)}`);
      const refused = await admin.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, paymentDate: '2026-05-01' });
      if (refused.status !== 409 || codeOf(refused.body) !== 'PAYROLL_NOT_APPROVED') problems.push(`paying a draft payslip answered ${refused.status} ${brief(refused.body)}, expected 409 PAYROLL_NOT_APPROVED`);
      const afterRefusal = await row();
      if (afterRefusal?.status !== 'draft' || !fin(afterRefusal?.paidAmount ?? 0).isZero()) problems.push(`the draft payslip is ${afterRefusal?.status} with ${afterRefusal?.paidAmount} paid after the refusal`);
      const approved = await admin.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved', notes: 'approved for payment' });
      if (approved.status !== 200) problems.push(`approving the payslip answered ${approved.status} ${brief(approved.body)}`);
      const paid = await admin.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, paymentDate: '2026-05-01' });
      if (paid.status !== 200 && paid.status !== 201) problems.push(`paying the approved payslip answered ${paid.status} ${brief(paid.body)}`);

      // 2) the status route does not rewrite the payment details of a paid payslip (it used to take «cheque» and any date)
      const before = await row();
      const rewrite = await admin.put(`/api/piecework/payrolls/${payrollId}/status`, { paymentMethod: 'cheque', paymentDate: '2026-01-01' });
      if (rewrite.status !== 400) problems.push(`rewriting the payment details answered ${rewrite.status} ${brief(rewrite.body)}, expected 400`);
      const after = await row();
      if (after?.paymentMethod !== before?.paymentMethod || after?.paymentDate !== before?.paymentDate || after?.status !== 'paid') {
        problems.push(`payment details changed from ${before?.paymentMethod} ${before?.paymentDate} to ${after?.paymentMethod} ${after?.paymentDate} (status ${after?.status})`);
      }

      assertNoProblems(problems);
      return 'The draft payslip refused with 409 and left unpaid, paid after approval, and the payment details of the paid payslip kept against a status request (400).';
    }));
  }

  return results;
}
