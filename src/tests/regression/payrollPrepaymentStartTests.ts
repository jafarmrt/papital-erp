import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { jalaliMonthDays } from '../../lib/payroll/fixedSalaryProration.js';
import { isoToJalaliDate, toStorageDate } from '../../utils/calendarDate.js';
import { addLog, newTask, newWorker, payrollCount } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * Payroll duties plan PR 3 (D-02 parts 3 and 4, §3.4): a prepayment payslip for a period ending after today, with a
 * required reason and fixed salary only, and the personnel service start date where fixed salary begins. Real Express
 * routes on PostgreSQL in an isolated schema; each case is red on v10.0.182.
 */

type Res = { status: number; body?: unknown };

const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const field = (res: Res, key: string) => (res.body as Record<string, unknown> | undefined)?.[key];
let seq = 0;

/** Jalali date to its stored ISO day (the test's own dates are valid) */
const iso = (jalali: string): string => toStorageDate(jalali) ?? '';

async function salariedWorker(name: string, salary: number, extra: { startDate?: string } = {}): Promise<number> {
  const [row] = await orm.insert(personnel).values({
    fullName: `${name} ${Date.now().toString().slice(-6)}${++seq}`, salaryType: 'mixed', monthlySalary: money(salary), ...extra,
  }).returning({ id: personnel.id });
  return row.id;
}

/** The whole Jalali month after the business today, as Jalali dates (the form's input) and its first ISO day */
async function nextJalaliMonth(): Promise<{ start: string; end: string; days: number; firstIso: string }> {
  const [y, m] = isoToJalaliDate(await businessTodayIsoDate()).split('/').map(Number);
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  const month = `${ny}/${String(nm).padStart(2, '0')}`;
  const days = jalaliMonthDays(month);
  return { start: `${month}/01`, end: `${month}/${days}`, days, firstIso: iso(`${month}/01`) };
}

export async function runPayrollPrepaymentStartTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const prepaymentId = 'reg_payroll_prepayment_with_reason_td_1085';
  if (shouldRun(prepaymentId, 'td1085', 'payroll', 'payslip', 'prepayment', 'duties')) {
    await runCase(results, prepaymentId, 'v10.0.183: a payslip for a period ending after today is issued only as a prepayment with a reason, pays fixed salary only and leaves the period\'s work logs free; a prepayment of a past period or of a worker without fixed salary is refused (TD-1085)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const next = await nextJalaliMonth();
      const worker = await salariedWorker('TD-1085 worker', 30_000_000);
      await addLog(worker, await newTask(), next.firstIso, 400_000);
      const generate = (personnelId: number, extra: Record<string, unknown>, period = { startDate: next.start, endDate: next.end }) =>
        admin.post('/api/piecework/payrolls/generate', { personnelId, ...period, ...extra });

      const plain = await generate(worker, {});
      if (plain.status !== 422 || codeOf(plain) !== 'PAYROLL_PERIOD_IN_FUTURE') problems.push(`a future period without the prepayment tick answered ${brief(plain)}, expected 422 PAYROLL_PERIOD_IN_FUTURE`);
      const noReason = await generate(worker, { isPrepayment: true, prepaymentReason: '  ' });
      if (noReason.status !== 422 || codeOf(noReason) !== 'PAYROLL_PREPAYMENT_REASON_REQUIRED') problems.push(`a prepayment without a reason answered ${brief(noReason)}, expected 422 PAYROLL_PREPAYMENT_REASON_REQUIRED`);
      const past = await generate(worker, { isPrepayment: true, prepaymentReason: 'TD-1085 past' }, { startDate: '2026-04-01', endDate: '2026-04-30' });
      if (past.status !== 422 || codeOf(past) !== 'PAYROLL_PREPAYMENT_NOT_FUTURE') problems.push(`a prepayment of a past period answered ${brief(past)}, expected 422 PAYROLL_PREPAYMENT_NOT_FUTURE`);
      const pieceworkOnly = await newWorker('TD-1085 piecework only');
      const noFixed = await generate(pieceworkOnly, { isPrepayment: true, prepaymentReason: 'TD-1085 no fixed' });
      if (noFixed.status !== 422 || codeOf(noFixed) !== 'PAYROLL_PREPAYMENT_FIXED_SALARY_ONLY') problems.push(`a prepayment for a worker without fixed salary answered ${brief(noFixed)}, expected 422 PAYROLL_PREPAYMENT_FIXED_SALARY_ONLY`);
      if (await payrollCount(worker) + await payrollCount(pieceworkOnly) !== 0) problems.push('a refused payslip was written');

      const reason = 'TD-1085 پرداخت پیش از تعطیلات';
      const issued = await generate(worker, { isPrepayment: true, prepaymentReason: reason });
      const payrollId = Number(field(issued, 'id'));
      if (issued.status !== 201 || !payrollId) problems.push(`the prepayment with a reason answered ${brief(issued)}, expected 201`);
      else {
        const [row] = await q('SELECT is_prepayment, prepayment_reason, notes, status, total_fixed_amount::text AS fixed, total_piecework_amount::text AS piece FROM piecework_payrolls WHERE id = $1', [payrollId]);
        if (Number(row?.is_prepayment) !== 1 || row?.prepayment_reason !== reason) problems.push(`the prepayment is stored as ${row?.is_prepayment} «${String(row?.prepayment_reason)}»`);
        if (!String(row?.notes ?? '').includes(reason)) problems.push(`the payslip notes do not carry the reason: ${String(row?.notes)}`);
        if (row?.status !== 'draft') problems.push(`the prepayment is ${String(row?.status)}, expected a draft`);
        if (!fin(String(row?.fixed)).equals(30_000_000) || !fin(String(row?.piece)).isZero()) problems.push(`the prepayment pays fixed ${String(row?.fixed)} and piecework ${String(row?.piece)}, expected 30,000,000 and 0`);
        const [log] = await q('SELECT payroll_id FROM piecework_logs WHERE personnel_id = $1', [worker]);
        if (log?.payroll_id !== null) problems.push(`the period's work log was linked to the prepayment (${String(log?.payroll_id)}), expected it to stay free`);
        const [audit] = await q("SELECT description FROM activity_logs WHERE entity_id = $1 AND action = 'CREATE' AND description LIKE '%پیش‌پرداخت%' ORDER BY id DESC LIMIT 1", [String(payrollId)]);
        if (!String(audit?.description ?? '').includes(reason)) problems.push(`the issue audit row does not name the prepayment reason: ${String(audit?.description)}`);
      }

      assertNoProblems(problems);
      return 'Future period without the tick 422, without a reason 422, a past prepayment 422 and a worker without fixed salary 422; the prepayment with a reason stored as a draft with fixed 30,000,000 only, the reason in its notes and audit row, and the work log left free.';
    }));
  }

  const startId = 'reg_payroll_fixed_salary_service_start_td_1086';
  if (shouldRun(startId, 'td1086', 'payroll', 'payslip', 'fixed', 'personnel', 'duties')) {
    await runCase(results, startId, 'v10.0.183: fixed salary starts on the personnel service start date, the first month pro rata by days, and none before it; the personnel form stores the start date in ISO and refuses an invalid one (TD-1086)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const fixedOf = (res: Res) => String(field(res, 'totalFixedAmount') ?? '-');

      // hired on 1405/01/26: Farvardin has 31 days, so days 26..31 earn 6 of 31 of 31,000,000
      const hired = await salariedWorker('TD-1086 hired', 31_000_000, { startDate: iso('1405/01/26') });
      const first = await admin.post('/api/piecework/payrolls/generate', { personnelId: hired, startDate: '1405/01/01', endDate: '1405/01/31' });
      if (first.status !== 201) problems.push(`the first payslip answered ${brief(first)}`);
      else if (!fin(fixedOf(first)).equals(6_000_000)) problems.push(`fixed salary of the hiring month is ${fixedOf(first)}, expected 6,000,000 (6 of 31 days)`);

      // a period wholly before the start date earns no fixed salary: with a work log piecework only, without one no payslip
      const later = await salariedWorker('TD-1086 later', 31_000_000, { startDate: iso('1405/03/01') });
      const empty = await admin.post('/api/piecework/payrolls/generate', { personnelId: later, startDate: '1405/01/01', endDate: '1405/01/31' });
      if (empty.status !== 400) problems.push(`a period before the service start without work logs answered ${brief(empty)}, expected 400`);
      await addLog(later, await newTask(), iso('1405/01/10'), 500_000);
      const pieceOnly = await admin.post('/api/piecework/payrolls/generate', { personnelId: later, startDate: '1405/01/01', endDate: '1405/01/31' });
      if (pieceOnly.status !== 201 || !fin(fixedOf(pieceOnly)).isZero()) problems.push(`a period before the service start with a work log answered ${brief(pieceOnly)}, expected 201 with fixed salary 0`);

      // the personnel form stores the start date in ISO and refuses an impossible day
      const created = await admin.post('/api/personnel', { firstName: 'TD-1086', lastName: `form ${Date.now()}`, startDate: '1405/02/10' });
      const createdId = Number(field(created, 'id'));
      const [stored] = createdId ? await q('SELECT start_date FROM personnel WHERE id = $1', [createdId]) : [];
      if (created.status !== 201 || stored?.start_date !== iso('1405/02/10')) problems.push(`the personnel form answered ${brief(created)} and stored start date ${String(stored?.start_date)}, expected ${iso('1405/02/10')}`);
      const invalid = await admin.post('/api/personnel', { firstName: 'TD-1086', lastName: `bad ${Date.now()}`, startDate: '1404/12/30' });
      if (invalid.status !== 422) problems.push(`an impossible start date answered ${brief(invalid)}, expected 422`);

      assertNoProblems(problems);
      return 'Fixed salary 6,000,000 for 6 of 31 days of the hiring month; none for a period before the start date; the form stores the start date in ISO and refuses 1404/12/30.';
    }));
  }

  return results;
}
