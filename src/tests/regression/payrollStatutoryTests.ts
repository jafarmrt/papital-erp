import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { addLog, newTask, newWorker, personNet } from '../invariants/payrollScenarios.js';
import { checkPayrollInvariants } from '../invariants/payrollInvariants.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * Payroll duties plan PR 4 (§3.3, decisions t4..t7 «الف»): yearly insurance and payroll tax rates, the coverage flags of a
 * personnel, the statutory deductions of a payslip on their own accounts, the override reason, the monthly report and
 * the health check of payslips issued before the split. Real Express routes on PostgreSQL in an isolated schema; each
 * case is red on v10.0.200.
 */

type Res = { status: number; body?: unknown };

const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const field = (res: Res, key: string) => (res.body as Record<string, unknown> | undefined)?.[key];

/** Farvardin 1405, a whole Jalali month (month fraction 1) */
const MONTH = { startDate: '1405/01/01', endDate: '1405/01/31' };
const LOG_DATE = '2026-03-25';

/** employee 7 %, employer 23 %, no wage cap, tax 0 % up to 10,000,000 then 10 %, employee insurance off the tax base */
const RATES_1405 = {
  employeeInsurancePercent: '7',
  employerInsurancePercent: '23',
  insuranceWageCap: '0',
  taxBrackets: [{ from: '0', to: '10000000', rate: '0' }, { from: '10000000', to: null, rate: '10' }],
  deductInsuranceFromTax: true,
};

async function coveredWorker(name: string, flags = { insurance: true, tax: true }): Promise<number> {
  const id = await newWorker(name);
  await orm.update(personnel).set({ isInsuranceCovered: flags.insurance ? 1 : 0, isTaxCovered: flags.tax ? 1 : 0 }).where(eq(personnel.id, id));
  return id;
}

async function payslip(id: number) {
  const [row] = await q(`SELECT net_payable::text AS net, employee_insurance::text AS ee, employer_insurance::text AS er, income_tax::text AS tax,
                                statutory_override_reason AS reason, is_statutory_split AS split FROM piecework_payrolls WHERE id = $1`, [id]);
  return row ?? {};
}

export async function runPayrollStatutoryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const ratesId = 'reg_payroll_statutory_rates_td_1087';
  if (shouldRun(ratesId, 'td1087', 'payroll', 'statutory', 'rates', 'duties')) {
    await runCase(results, ratesId, 'v10.0.210: yearly insurance and payroll tax rates are saved only with payroll.rates_manage, refused when invalid or stale, and audited (TD-1087)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const reader = await sandboxClientWith(['piecework.view', 'piecework.payroll']);
      const manager = await sandboxClientWith(['piecework.view', 'payroll.rates_manage']);

      const refused = await reader.put('/api/piecework/statutory-rates/1405', RATES_1405);
      if (refused.status !== 403) problems.push(`a payroll issuer saved rates: ${brief(refused)}, expected 403`);
      const gap = await manager.put('/api/piecework/statutory-rates/1405', { ...RATES_1405, taxBrackets: [{ from: '0', to: '10000000', rate: '0' }, { from: '12000000', to: null, rate: '10' }] });
      if (gap.status !== 422 || codeOf(gap) !== 'PAYROLL_RATES_INVALID') problems.push(`brackets with a gap answered ${brief(gap)}, expected 422 PAYROLL_RATES_INVALID`);
      const saved = await manager.put('/api/piecework/statutory-rates/1405', RATES_1405);
      if (saved.status !== 200) problems.push(`the rates answered ${brief(saved)}, expected 200`);
      const version = Number(field(saved, 'version'));
      const again = await manager.put('/api/piecework/statutory-rates/1405', { ...RATES_1405, employeeInsurancePercent: '8', version });
      if (again.status !== 200) problems.push(`an edit at the current version answered ${brief(again)}`);
      const stale = await manager.put('/api/piecework/statutory-rates/1405', { ...RATES_1405, version });
      if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') problems.push(`an edit at a stale version answered ${brief(stale)}, expected 409 OCC_CONFLICT`);
      const listed = await reader.get('/api/piecework/statutory-rates');
      const rows = (field(listed, 'data') as Array<{ jalaliYear: number; employeeInsurancePercent: string }> | undefined) ?? [];
      const row = rows.find(r => r.jalaliYear === 1405);
      if (listed.status !== 200 || !row || !fin(row.employeeInsurancePercent).equals(8)) problems.push(`the rates list answered ${brief(listed)}, expected 1405 at 8 %`);
      const [audit] = await q("SELECT COUNT(*)::int AS n FROM activity_logs WHERE entity = 'نرخ بیمه و مالیات حقوق'");
      if (Number(audit?.n) !== 2) problems.push(`${String(audit?.n)} audit rows for two saves, expected 2`);

      assertNoProblems(problems);
      return 'Issuer 403, gapped brackets 422, save 200, edit 200, stale 409 OCC_CONFLICT, list shows 8 %, two audit rows.';
    }));
  }

  const issueId = 'reg_payroll_statutory_issue_td_1087';
  if (shouldRun(issueId, 'td1087', 'payroll', 'statutory', 'payslip', 'voucher', 'duties')) {
    await runCase(results, issueId, 'v10.0.210: a covered worker\'s payslip takes employee and employer insurance and income tax from the year\'s rates, nets the employee share and the tax, posts them on 3204 / 7013 / 3206, needs a reason to differ, and a year without rates warns (TD-1087)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const task = await newTask();
      const generate = (personnelId: number, extra: Record<string, unknown> = {}) => admin.post('/api/piecework/payrolls/generate', { personnelId, ...MONTH, ...extra });

      // without rates: issued with a warning and no statutory deductions
      const early = await coveredWorker('TD-1087 no rates');
      await addLog(early, task, LOG_DATE, 20_000_000);
      const warned = await generate(early);
      const warnedId = Number(field(warned, 'id'));
      if (warned.status !== 201 || !String(field(warned, 'statutoryWarning') ?? '').includes('۱۴۰۵')) problems.push(`a payslip without rates answered ${brief(warned)}, expected 201 with a warning naming 1405`);
      else if (!fin(String((await payslip(warnedId)).ee)).isZero()) problems.push('a payslip without rates took insurance');

      const saved = await admin.put('/api/piecework/statutory-rates/1405', RATES_1405);
      if (saved.status !== 200) throw new Error(`setup: rates ${brief(saved)}`);

      // preview: 20,000,000 gross → employee 1,400,000, employer 4,600,000, tax (18,600,000 − 10,000,000) × 10 % = 860,000
      const worker = await coveredWorker('TD-1087 covered');
      await addLog(worker, task, LOG_DATE, 20_000_000);
      const preview = await admin.get(`/api/piecework/statutory-preview?personnelId=${worker}&startDate=${MONTH.startDate}&endDate=${MONTH.endDate}&gross=20000000`);
      const suggestion = field(preview, 'suggestion') as Record<string, string> | undefined;
      if (preview.status !== 200 || !suggestion || !fin(suggestion.employeeInsurance).equals(1_400_000) || !fin(suggestion.employerInsurance).equals(4_600_000) || !fin(suggestion.incomeTax).equals(860_000)) {
        problems.push(`the preview answered ${brief(preview)}, expected 1,400,000 / 4,600,000 / 860,000`);
      }

      // a different amount needs a reason
      const noReason = await generate(worker, { incomeTax: '500000' });
      if (noReason.status !== 422 || codeOf(noReason) !== 'PAYROLL_STATUTORY_OVERRIDE_REASON_REQUIRED') problems.push(`a changed tax without a reason answered ${brief(noReason)}, expected 422 PAYROLL_STATUTORY_OVERRIDE_REASON_REQUIRED`);

      const issued = await generate(worker, { deductions: 100_000, deductionsDescription: 'TD-1087 loan' });
      const payrollId = Number(field(issued, 'id'));
      if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
      const row = await payslip(payrollId);
      if (!fin(String(row.ee)).equals(1_400_000) || !fin(String(row.er)).equals(4_600_000) || !fin(String(row.tax)).equals(860_000)) problems.push(`the payslip stored ${String(row.ee)} / ${String(row.er)} / ${String(row.tax)}`);
      if (!fin(String(row.net)).equals(17_640_000)) problems.push(`the net is ${String(row.net)}, expected 20,000,000 − 1,400,000 − 860,000 − 100,000 = 17,640,000`);
      if (Number(row.split) !== 1) problems.push('a new payslip is not marked as split');
      const posted = { wages: await personNet('3201', worker), insurance: await personNet('3204', worker), employer: await personNet('7013', worker), tax: await personNet('3206', worker), other: await personNet('3205', worker) };
      if (!fin(posted.wages).equals(-17_640_000) || !fin(posted.insurance).equals(-6_000_000) || !fin(posted.employer).equals(4_600_000) || !fin(posted.tax).equals(-860_000) || !fin(posted.other).equals(-100_000)) {
        problems.push(`the voucher posted ${JSON.stringify(posted)}, expected wages −17,640,000, 3204 −6,000,000, 7013 +4,600,000, 3206 −860,000, 3205 −100,000`);
      }

      // with a reason a different amount is kept, and the reason is stored
      const other = await coveredWorker('TD-1087 override');
      await addLog(other, task, LOG_DATE, 20_000_000);
      const overridden = await generate(other, { incomeTax: '500000', statutoryOverrideReason: 'TD-1087 exemption letter' });
      const overriddenRow = overridden.status === 201 ? await payslip(Number(field(overridden, 'id'))) : {};
      if (overridden.status !== 201 || !fin(String(overriddenRow.tax)).equals(500_000) || overriddenRow.reason !== 'TD-1087 exemption letter') problems.push(`an override with a reason answered ${brief(overridden)} and stored ${JSON.stringify(overriddenRow)}`);

      // a worker covered by neither pays no statutory deduction
      const free = await coveredWorker('TD-1087 not covered', { insurance: false, tax: false });
      await addLog(free, task, LOG_DATE, 20_000_000);
      const freeRes = await generate(free);
      const freeRow = freeRes.status === 201 ? await payslip(Number(field(freeRes, 'id'))) : {};
      if (freeRes.status !== 201 || !fin(String(freeRow.net)).equals(20_000_000)) problems.push(`an uncovered worker answered ${brief(freeRes)} with net ${String(freeRow.net)}`);

      const violations = await checkPayrollInvariants(0);
      if (violations.length > 0) problems.push(`I10 reports ${JSON.stringify(violations).slice(0, 300)}`);

      assertNoProblems(problems);
      return 'No rates: warning and none; preview 1,400,000 / 4,600,000 / 860,000; changed tax without a reason 422; payslip net 17,640,000 with 3204 −6,000,000, 7013 +4,600,000, 3206 −860,000; override kept with its reason; uncovered worker net 20,000,000; I10 clean.';
    }));
  }

  const editId = 'reg_payroll_statutory_draft_edit_td_1087';
  if (shouldRun(editId, 'td1087', 'payroll', 'statutory', 'draft', 'duties')) {
    await runCase(results, editId, 'v10.0.210: editing a draft payslip recomputes its statutory deductions on the new gross and rebuilds the voucher, and I10 catches a net that ignores them (TD-1087)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await admin.put('/api/piecework/statutory-rates/1405', RATES_1405);
      const worker = await coveredWorker('TD-1087 edit');
      await addLog(worker, await newTask(), LOG_DATE, 20_000_000);
      const issued = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...MONTH });
      const payrollId = Number(field(issued, 'id'));
      if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);

      // bonus 10,000,000 → gross 30,000,000: employee 2,100,000, employer 6,900,000, tax (27,900,000 − 10,000,000) × 10 % = 1,790,000
      const edited = await admin.put(`/api/piecework/payrolls/${payrollId}`, { bonuses: 10_000_000 });
      const row = await payslip(payrollId);
      if (edited.status !== 200 || !fin(String(row.ee)).equals(2_100_000) || !fin(String(row.er)).equals(6_900_000) || !fin(String(row.tax)).equals(1_790_000)) {
        problems.push(`the edit answered ${brief(edited)} and stored ${String(row.ee)} / ${String(row.er)} / ${String(row.tax)}`);
      }
      if (!fin(String(row.net)).equals(26_110_000)) problems.push(`the edited net is ${String(row.net)}, expected 26,110,000`);
      if (!fin(await personNet('3204', worker)).equals(-9_000_000)) problems.push(`3204 after the edit is ${await personNet('3204', worker)}, expected −9,000,000`);

      await q('UPDATE piecework_payrolls SET net_payable = net_payable + income_tax WHERE id = $1', [payrollId]);
      const violations = await checkPayrollInvariants(0);
      if (!violations.some(v => v.key === `payroll:${payrollId}` && v.message.includes('insurance, tax'))) problems.push(`I10 missed a net that ignores the tax: ${JSON.stringify(violations).slice(0, 300)}`);

      assertNoProblems(problems);
      return 'Draft edit to gross 30,000,000: 2,100,000 / 6,900,000 / 1,790,000, net 26,110,000, 3204 −9,000,000; I10 flags a net that ignores the tax.';
    }));
  }

  const reportId = 'reg_payroll_statutory_report_td_1088';
  if (shouldRun(reportId, 'td1088', 'payroll', 'statutory', 'report', 'health', 'duties')) {
    await runCase(results, reportId, 'v10.0.211: the monthly insurance and tax list sums approved payslips per personnel, leaves drafts out and counts them; payslips issued before the split with deductions left on 3205 are listed by the health check (TD-1088)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await admin.put('/api/piecework/statutory-rates/1405', RATES_1405);
      const task = await newTask();
      const approvedWorker = await coveredWorker('TD-1088 approved');
      await addLog(approvedWorker, task, LOG_DATE, 20_000_000);
      const issued = await admin.post('/api/piecework/payrolls/generate', { personnelId: approvedWorker, ...MONTH });
      const approvedId = Number(field(issued, 'id'));
      const approve = await admin.put(`/api/piecework/payrolls/${approvedId}/status`, { status: 'approved' });
      if (approve.status !== 200) throw new Error(`setup: approve ${brief(approve)}`);
      const draftWorker = await coveredWorker('TD-1088 draft');
      await addLog(draftWorker, task, LOG_DATE, 5_000_000);
      await admin.post('/api/piecework/payrolls/generate', { personnelId: draftWorker, ...MONTH });

      const report = await admin.get('/api/piecework/reports/statutory?year=1405&month=1');
      const rows = (field(report, 'rows') as Array<{ personnelId: number; gross: string; employeeInsurance: string; employerInsurance: string; incomeTax: string }> | undefined) ?? [];
      if (report.status !== 200 || rows.length !== 1 || rows[0].personnelId !== approvedWorker) problems.push(`the report answered ${brief(report)}, expected only the approved payslip`);
      else if (!fin(rows[0].gross).equals(20_000_000) || !fin(rows[0].employeeInsurance).equals(1_400_000) || !fin(rows[0].employerInsurance).equals(4_600_000) || !fin(rows[0].incomeTax).equals(860_000)) problems.push(`the report row is ${JSON.stringify(rows[0])}`);
      if (Number(field(report, 'draftPayslips')) !== 1) problems.push(`the report counts ${String(field(report, 'draftPayslips'))} drafts, expected 1`);
      const badMonth = await admin.get('/api/piecework/reports/statutory?year=1405&month=13');
      if (badMonth.status !== 400) problems.push(`month 13 answered ${brief(badMonth)}, expected 400`);

      const health = async () => (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'payroll_deductions_before_statutory_split');
      const clean = await health();
      if (!clean || clean.status !== 'healthy') problems.push(`the health check is ${clean?.status} before any legacy payslip`);
      const legacyWorker = await newWorker('TD-1088 legacy');
      await addLog(legacyWorker, task, LOG_DATE, 3_000_000);
      const legacy = await admin.post('/api/piecework/payrolls/generate', { personnelId: legacyWorker, ...MONTH, deductions: 250_000, deductionsDescription: 'TD-1088 insurance before the split' });
      await q('UPDATE piecework_payrolls SET is_statutory_split = 0 WHERE id = $1', [Number(field(legacy, 'id'))]);
      const listed = await health();
      if (!listed || listed.status !== 'warning' || listed.items?.length !== 1 || Number(listed.items[0]?.id) !== legacyWorker) problems.push(`the health check is ${listed?.status} ${JSON.stringify(listed?.items ?? []).slice(0, 200)}, expected the legacy worker`);

      assertNoProblems(problems);
      return 'Report lists the approved payslip only (20,000,000 / 1,400,000 / 4,600,000 / 860,000) and counts one draft; month 13 is 400; the legacy payslip with 250,000 on 3205 is listed by the health check.';
    }));
  }

  const optionalId = 'reg_payroll_statutory_report_optional_td_1269';
  if (shouldRun(optionalId, 'td1269', 'payroll', 'statutory', 'report', 'optional')) {
    await runCase(results, optionalId, 'v10.1.19: insurance and payroll tax are optional per person, so the monthly list leaves out approved payslips without them (not covered, or zeroed with a reason) and only counts them; the payslip and its voucher post nothing to 3204 or 3206 (TD-1269)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await admin.put('/api/piecework/statutory-rates/1405', RATES_1405);
      const task = await newTask();
      const issueApproved = async (worker: number, amount: number, extra: Record<string, unknown> = {}) => {
        await addLog(worker, task, LOG_DATE, amount);
        const issued = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...MONTH, ...extra });
        const id = Number(field(issued, 'id'));
        if (issued.status !== 201 || !id) throw new Error(`setup: payslip ${brief(issued)}`);
        const approve = await admin.put(`/api/piecework/payrolls/${id}/status`, { status: 'approved' });
        if (approve.status !== 200) throw new Error(`setup: approve ${brief(approve)}`);
        return id;
      };
      const insured = await coveredWorker('TD-1269 insured');
      await issueApproved(insured, 20_000_000);
      const informal = await newWorker('TD-1269 informal');
      const informalPayslip = await issueApproved(informal, 8_000_000);
      const zeroed = await coveredWorker('TD-1269 zeroed this month');
      await issueApproved(zeroed, 6_000_000, { employeeInsurance: '0', employerInsurance: '0', incomeTax: '0', statutoryOverrideReason: 'TD-1269 informal this month' });

      const row = await payslip(informalPayslip);
      if (!fin(String(row.ee)).isZero() || !fin(String(row.er)).isZero() || !fin(String(row.tax)).isZero() || !fin(String(row.net)).equals(8_000_000)) {
        problems.push(`the informal payslip stored ${String(row.ee)} / ${String(row.er)} / ${String(row.tax)}, net ${String(row.net)}`);
      }
      for (const code of ['3204', '3206']) {
        const net = await personNet(code, informal);
        if (!fin(net).isZero()) problems.push(`the informal worker has ${net} on ${code}, expected nothing`);
      }

      const report = await admin.get('/api/piecework/reports/statutory?year=1405&month=1');
      const rows = (field(report, 'rows') as Array<{ personnelId: number }> | undefined) ?? [];
      const listed = rows.map(r => r.personnelId);
      if (report.status !== 200 || !listed.includes(insured)) problems.push(`the report answered ${brief(report)}, expected the insured worker`);
      if (listed.includes(informal) || listed.includes(zeroed)) problems.push(`the report lists ${JSON.stringify(listed)}, expected no worker without insurance or tax`);
      const without = field(report, 'withoutStatutory') as { personnel?: number; payslips?: number } | undefined;
      if (Number(without?.personnel) !== 2 || Number(without?.payslips) !== 2) problems.push(`the report counts ${JSON.stringify(without ?? null)} without insurance and tax, expected 2 personnel with 2 payslips`);

      assertNoProblems(problems);
      return 'An uncovered worker gets a payslip with no insurance or tax and nothing on 3204 / 3206; the monthly list shows only the insured worker and counts 2 personnel with 2 payslips left out.';
    }));
  }

  return results;
}
