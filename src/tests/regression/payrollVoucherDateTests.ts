import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * v10.0.273 (L1, work map W1:337): a payslip voucher is dated the earlier of the payslip's period end and its issue day.
 * Before, an eidi payslip issued during the year (period to the year's last day) got a voucher dated in the future, so
 * its payment, dated today, emptied «عیدی پرداختنی» below zero and the expense was missing from every report up to the
 * year's end.
 */
type Res = { status: number; body?: unknown };
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;

export async function runPayrollVoucherDateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_eidi_payslip_voucher_not_future_td_1244';
  if (!shouldRun(id, 'td1244', 'td1089', 'payroll', 'eidi', 'voucher', 'date')) return results;
  await runCase(results, id, 'v10.0.273: an eidi payslip issued before the year ends gets a voucher dated its issue day, never a future day; its period still ends on the year\'s last day', async () => inFiscalSandbox(async () => {
    const problems: string[] = [];
    const admin = await sandboxAdminClient();
    const today = await businessTodayIsoDate();
    const year = Number(isoToJalaliDate(today).slice(0, 4));
    const saved = await admin.put(`/api/piecework/eidi-rates/${year}`, { method: 'fixed_amount', fixedAmount: '60000000' });
    if (saved.status !== 200) throw new Error(`setup: rates ${brief(saved)}`);
    const worker = await newWorker('eidi voucher date');
    const issued = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year });
    if (issued.status !== 201) throw new Error(`setup: eidi payslip ${brief(issued)}`);
    const payslipId = Number((issued.body as { id?: unknown }).id);
    const [row] = await q(`SELECT p.end_date AS end_date, v.date AS voucher_date FROM piecework_payrolls p
      JOIN journal_vouchers v ON v.source_payroll_id = p.id AND v.is_deleted = 0 WHERE p.id = $1`, [payslipId]);
    if (!row) throw new Error('the eidi payslip has no voucher');
    const voucherDate = String(row.voucher_date).slice(0, 10);
    const endDate = String(row.end_date).slice(0, 10);
    const expected = endDate < today ? endDate : today;
    if (voucherDate !== expected) problems.push(`the eidi payslip voucher is dated ${voucherDate} (period end ${endDate}, today ${today}), expected ${expected}`);
    assertNoProblems(problems);
    return `voucher dated ${voucherDate}; period ends ${endDate}`;
  }));
  return results;
}
