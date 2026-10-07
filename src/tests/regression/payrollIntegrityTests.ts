import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkPayrolls } from '../../db/schema.js';
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

  return results;
}
