import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { addLog, newTask, newWorker, personNet } from '../invariants/payrollScenarios.js';
import { checkPayrollInvariants } from '../invariants/payrollInvariants.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * Payroll duties plan PR 6 (§3.8, decisions t14..t16 «الف»): yearly eidi rates, the eidi share of each payslip up to
 * the year's cap on its own accounts, the eidi payslip that pays the accrued eidi (or the labor-law entitlement), the
 * guard that keeps a paid-out share and the yearly report. Real Express routes on PostgreSQL in an isolated schema;
 * each case is red on v10.0.211.
 */

type Res = { status: number; body?: unknown };

const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const field = (res: Res, key: string) => (res.body as Record<string, unknown> | undefined)?.[key];

const FARVARDIN = { startDate: '1405/01/01', endDate: '1405/01/31' };
const ORDIBEHESHT = { startDate: '1405/02/01', endDate: '1405/02/31' };
/** 15 % of each payslip's work, at most 5,000,000 a year */
const PERCENT_1405 = { method: 'percent_of_work', percent: '15', yearlyCap: '5000000' };

async function eidiOf(id: number) {
  const [row] = await q(`SELECT net_payable::text AS net, eidi_amount::text AS eidi, eidi_from_accrual::text AS accrual, eidi_year AS year, is_eidi AS kind
                           FROM piecework_payrolls WHERE id = $1`, [id]);
  return row ?? {};
}

export async function runPayrollEidiTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const ratesId = 'reg_payroll_eidi_rates_td_1089';
  if (shouldRun(ratesId, 'td1089', 'payroll', 'eidi', 'rates', 'duties')) {
    await runCase(results, ratesId, 'v10.0.222: yearly eidi rates are saved only with payroll.rates_manage, refused when incomplete or stale, and audited (TD-1089)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const reader = await sandboxClientWith(['piecework.view', 'piecework.payroll']);
      const manager = await sandboxClientWith(['piecework.view', 'payroll.rates_manage']);

      const refused = await reader.put('/api/piecework/eidi-rates/1405', PERCENT_1405);
      if (refused.status !== 403) problems.push(`a payroll issuer saved eidi rates: ${brief(refused)}, expected 403`);
      const noCap = await manager.put('/api/piecework/eidi-rates/1405', { method: 'percent_of_work', percent: '15' });
      if (noCap.status !== 422 || codeOf(noCap) !== 'PAYROLL_EIDI_RATES_INVALID') problems.push(`a percent without a cap answered ${brief(noCap)}, expected 422 PAYROLL_EIDI_RATES_INVALID`);
      const badMethod = await manager.put('/api/piecework/eidi-rates/1405', { ...PERCENT_1405, method: 'bonus' });
      if (badMethod.status !== 400) problems.push(`an unknown method answered ${brief(badMethod)}, expected 400`);
      const saved = await manager.put('/api/piecework/eidi-rates/1405', PERCENT_1405);
      if (saved.status !== 200) problems.push(`the rates answered ${brief(saved)}, expected 200`);
      const version = Number(field(saved, 'version'));
      const again = await manager.put('/api/piecework/eidi-rates/1405', { ...PERCENT_1405, percent: '10', version });
      if (again.status !== 200) problems.push(`an edit at the current version answered ${brief(again)}`);
      const stale = await manager.put('/api/piecework/eidi-rates/1405', { ...PERCENT_1405, version });
      if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') problems.push(`an edit at a stale version answered ${brief(stale)}, expected 409 OCC_CONFLICT`);
      const listed = await reader.get('/api/piecework/eidi-rates');
      const row = ((field(listed, 'data') as Array<{ jalaliYear: number; percent: string }> | undefined) ?? []).find(r => r.jalaliYear === 1405);
      if (listed.status !== 200 || !row || !fin(row.percent).equals(10)) problems.push(`the rates list answered ${brief(listed)}, expected 1405 at 10 %`);
      const [audit] = await q("SELECT COUNT(*)::int AS n FROM activity_logs WHERE entity = 'نرخ عیدی سالانه'");
      if (Number(audit?.n) !== 2) problems.push(`${String(audit?.n)} audit rows for two saves, expected 2`);

      assertNoProblems(problems);
      return 'Issuer 403, no cap 422, unknown method 400, save 200, edit 200, stale 409 OCC_CONFLICT, list shows 10 %, two audit rows.';
    }));
  }

  const shareId = 'reg_payroll_eidi_share_td_1089';
  if (shouldRun(shareId, 'td1089', 'payroll', 'eidi', 'payslip', 'voucher', 'duties')) {
    await runCase(results, shareId, 'v10.0.222: each payslip accrues 15 % of its work and fixed salary as eidi up to the year cap, on 7014 / 3207, without touching its net; a year without eidi rates warns (TD-1089)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const task = await newTask();

      const early = await newWorker('TD-1089 no rates');
      await addLog(early, task, '2026-03-25', 10_000_000);
      const warned = await admin.post('/api/piecework/payrolls/generate', { personnelId: early, ...FARVARDIN });
      if (warned.status !== 201 || !String(field(warned, 'eidiWarning') ?? '').includes('۱۴۰۵')) problems.push(`a payslip without eidi rates answered ${brief(warned)}, expected 201 with a warning naming 1405`);
      else if (!fin(String((await eidiOf(Number(field(warned, 'id')))).eidi)).isZero()) problems.push('a payslip without eidi rates took a share');

      const saved = await admin.put('/api/piecework/eidi-rates/1405', PERCENT_1405);
      if (saved.status !== 200) throw new Error(`setup: rates ${brief(saved)}`);
      const worker = await newWorker('TD-1089 share');
      await addLog(worker, task, '2026-03-25', 20_000_000);
      await addLog(worker, task, '2026-04-25', 20_000_000);
      const first = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...FARVARDIN, bonuses: 4_000_000 });
      const second = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...ORDIBEHESHT });
      const a = await eidiOf(Number(field(first, 'id')));
      const b = await eidiOf(Number(field(second, 'id')));
      if (first.status !== 201 || !fin(String(a.eidi)).equals(3_000_000) || Number(a.year) !== 1405) problems.push(`the first payslip answered ${brief(first)} with share ${String(a.eidi)} for ${String(a.year)}, expected 3,000,000 (bonus left out) for 1405`);
      if (!fin(String(a.net)).equals(24_000_000)) problems.push(`the first payslip's net is ${String(a.net)}, expected 24,000,000 (the share is not taken from it)`);
      if (second.status !== 201 || !fin(String(b.eidi)).equals(2_000_000)) problems.push(`the second payslip took ${String(b.eidi)}, expected 2,000,000 (the rest of the 5,000,000 cap)`);
      const expense = await personNet('7014', worker);
      const payable = await personNet('3207', worker);
      if (!fin(expense).equals(5_000_000) || !fin(payable).equals(-5_000_000)) problems.push(`the vouchers posted 7014 ${expense} and 3207 ${payable}, expected +5,000,000 / −5,000,000`);

      const deleted = await admin.del(`/api/piecework/payrolls/${Number(field(second, 'id'))}`);
      if (deleted.status !== 200) problems.push(`deleting the draft payslip answered ${brief(deleted)}`);
      const reissued = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...ORDIBEHESHT });
      if (reissued.status !== 201 || !fin(String((await eidiOf(Number(field(reissued, 'id')))).eidi)).equals(2_000_000)) problems.push(`the reissued payslip answered ${brief(reissued)}, expected the freed 2,000,000 share`);

      const violations = await checkPayrollInvariants(0);
      if (violations.length > 0) problems.push(`I10 reports ${JSON.stringify(violations).slice(0, 300)}`);
      await q('UPDATE piecework_payrolls SET eidi_amount = eidi_amount + 1000 WHERE id = $1', [Number(field(first, 'id'))]);
      const broken = await checkPayrollInvariants(0);
      if (!broken.some(v => v.message.includes('eidi payable'))) problems.push(`I10 missed an eidi share that differs from its voucher: ${JSON.stringify(broken).slice(0, 300)}`);

      assertNoProblems(problems);
      return 'No rates: warning and no share; shares 3,000,000 then 2,000,000 (cap), net untouched, 7014 +5,000,000 / 3207 −5,000,000; a deleted draft frees its share; I10 clean and catches a tampered share.';
    }));
  }

  const payslipId = 'reg_payroll_eidi_payslip_td_1089';
  if (shouldRun(payslipId, 'td1089', 'payroll', 'eidi', 'payslip', 'report', 'duties')) {
    await runCase(results, payslipId, 'v10.0.222: the eidi payslip pays the approved accrual from 3207, takes another amount only with a reason (posted to 7014), is not edited, keeps its paid-out share, and the yearly report sums it (TD-1089)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      await admin.put('/api/piecework/eidi-rates/1405', PERCENT_1405);
      const task = await newTask();
      const worker = await newWorker('TD-1089 eidi payslip');
      await addLog(worker, task, '2026-03-25', 20_000_000);
      await addLog(worker, task, '2026-04-25', 20_000_000);
      const first = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...FARVARDIN });
      const firstId = Number(field(first, 'id'));
      await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...ORDIBEHESHT });
      const approve = await admin.put(`/api/piecework/payrolls/${firstId}/status`, { status: 'approved' });
      if (approve.status !== 200) throw new Error(`setup: approve ${brief(approve)}`);

      const preview = await admin.get(`/api/piecework/eidi-preview?personnelId=${worker}&year=1405`);
      const suggestion = field(preview, 'suggestion') as { amount?: string } | undefined;
      if (preview.status !== 200 || !fin(suggestion?.amount ?? 0).equals(3_000_000) || !field(preview, 'draftWarning')) problems.push(`the preview answered ${brief(preview)}, expected 3,000,000 with a draft warning`);

      const issued = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405 });
      const eidiId = Number(field(issued, 'id'));
      const row = await eidiOf(eidiId);
      if (issued.status !== 201 || Number(row.kind) !== 1 || !fin(String(row.net)).equals(3_000_000) || !fin(String(row.accrual)).equals(3_000_000)) problems.push(`the eidi payslip answered ${brief(issued)} and stored ${JSON.stringify(row)}`);
      if (!fin(await personNet('3207', worker)).equals(-2_000_000)) problems.push(`3207 after the eidi payslip is ${await personNet('3207', worker)}, expected −2,000,000 (the draft's share)`);

      const noReason = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405, amount: '1000000' });
      if (noReason.status !== 422 || codeOf(noReason) !== 'PAYROLL_EIDI_OVERRIDE_REASON_REQUIRED') problems.push(`another amount without a reason answered ${brief(noReason)}, expected 422 PAYROLL_EIDI_OVERRIDE_REASON_REQUIRED`);
      const extra = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405, amount: '1000000', overrideReason: 'TD-1089 manager bonus' });
      const extraId = Number(field(extra, 'id'));
      if (extra.status !== 201 || !fin(await personNet('7014', worker)).equals(6_000_000)) problems.push(`the extra eidi answered ${brief(extra)} with 7014 ${await personNet('7014', worker)}, expected 6,000,000`);

      const edit = await admin.put(`/api/piecework/payrolls/${eidiId}`, { bonuses: 1 });
      if (edit.status !== 409 || codeOf(edit) !== 'PAYROLL_EIDI_NOT_EDITABLE') problems.push(`editing the eidi payslip answered ${brief(edit)}, expected 409 PAYROLL_EIDI_NOT_EDITABLE`);

      const report = await admin.get('/api/piecework/reports/eidi?year=1405');
      const line = ((field(report, 'rows') as Array<Record<string, string | number>> | undefined) ?? []).find(r => r.personnelId === worker);
      if (report.status !== 200 || !line || !fin(line.due).equals(3_000_000) || !fin(line.draftShares).equals(2_000_000) || !fin(line.issued).equals(4_000_000) || !fin(String(line.cap)).equals(5_000_000) || !fin(line.remaining).isZero()) {
        problems.push(`the report answered ${brief(report)} with ${JSON.stringify(line)}`);
      }

      const back = await admin.put(`/api/piecework/payrolls/${firstId}/status`, { status: 'draft' });
      if (back.status !== 409 || codeOf(back) !== 'PAYROLL_EIDI_ALREADY_SETTLED') problems.push(`back to draft of a paid-out share answered ${brief(back)}, expected 409 PAYROLL_EIDI_ALREADY_SETTLED`);
      await admin.del(`/api/piecework/payrolls/${eidiId}`);
      await admin.del(`/api/piecework/payrolls/${extraId}`);
      const freed = await admin.put(`/api/piecework/payrolls/${firstId}/status`, { status: 'draft' });
      if (freed.status !== 200) problems.push(`back to draft after voiding the eidi payslips answered ${brief(freed)}`);

      const violations = await checkPayrollInvariants(0);
      if (violations.length > 0) problems.push(`I10 reports ${JSON.stringify(violations).slice(0, 300)}`);

      assertNoProblems(problems);
      return 'Preview 3,000,000 with a draft warning; eidi payslip net 3,000,000 from the accrual, 3207 −2,000,000; another amount 422 without a reason, with one +1,000,000 on 7014; edit 409; report due 3,000,000 / drafts 2,000,000 / issued 4,000,000; back to draft 409 until the eidi payslips are voided; I10 clean.';
    }));
  }

  const laborId = 'reg_payroll_eidi_labor_law_td_1089';
  if (shouldRun(laborId, 'td1089', 'payroll', 'eidi', 'labor', 'duties')) {
    await runCase(results, laborId, 'v10.0.222: under the labor-law method payslips accrue nothing and the eidi payslip pays 60 days of wage, capped at 90 minimum days, for the days worked in the year, all on 7014 (TD-1089)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const saved = await admin.put('/api/piecework/eidi-rates/1405', { method: 'labor_law', laborDays: '60', laborCapDays: '90', minDailyWage: '1000000' });
      if (saved.status !== 200) throw new Error(`setup: rates ${brief(saved)}`);
      const worker = await newWorker('TD-1089 labor law', { salaryType: 'monthly_fixed', monthlySalary: 30_000_000 });
      // service from 1 Mehr 1405: 179 of the 365 days of 1405
      await orm.update(personnel).set({ startDate: '2026-09-23' }).where(eq(personnel.id, worker));
      await addLog(worker, await newTask(), '2026-09-25', 10_000_000);
      const regular = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, startDate: '1405/07/01', endDate: '1405/07/15' });
      if (regular.status !== 201 || !fin(String((await eidiOf(Number(field(regular, 'id')))).eidi)).isZero()) problems.push(`a labor-law payslip answered ${brief(regular)} with a share`);

      const expected = Math.round(60_000_000 * 179 / 365);
      const issued = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405 });
      const row = await eidiOf(Number(field(issued, 'id')));
      if (issued.status !== 201 || !fin(String(row.net)).equals(expected) || !fin(String(row.accrual)).isZero()) problems.push(`the eidi payslip answered ${brief(issued)} and stored ${JSON.stringify(row)}, expected ${expected}`);
      if (!fin(await personNet('7014', worker)).equals(expected) || !fin(await personNet('3207', worker)).isZero()) problems.push(`the voucher posted 7014 ${await personNet('7014', worker)} / 3207 ${await personNet('3207', worker)}`);
      const twice = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405 });
      if (twice.status !== 422 || codeOf(twice) !== 'PAYROLL_EIDI_AMOUNT_ZERO') problems.push(`a second eidi payslip answered ${brief(twice)}, expected 422 PAYROLL_EIDI_AMOUNT_ZERO`);

      assertNoProblems(problems);
      return `No share on a labor-law payslip; eidi payslip ${expected} (60 × 1,000,000 × 179 ÷ 365) all on 7014; a second one 422.`;
    }));
  }

  const taxId = 'reg_payroll_eidi_tax_td_1089';
  if (shouldRun(taxId, 'td1089', 'payroll', 'eidi', 'tax', 'duties')) {
    await runCase(results, taxId, 'v10.0.222: eidi above the yearly tax-exempt cap is taxed at the year\'s payroll tax brackets, posted to 3206 and taken from net; another tax needs a reason (TD-1089, t21)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const statutory = await admin.put('/api/piecework/statutory-rates/1405', {
        employeeInsurancePercent: '7', employerInsurancePercent: '23',
        taxBrackets: [{ from: '0', to: '10000000', rate: '0' }, { from: '10000000', to: null, rate: '10' }],
      });
      const saved = await admin.put('/api/piecework/eidi-rates/1405', { method: 'fixed_amount', fixedAmount: '60000000', taxExemptCap: '40000000' });
      if (statutory.status !== 200 || saved.status !== 200 || String(field(saved, 'taxExemptCap')) !== '40000000') throw new Error(`setup: ${brief(statutory)} / ${brief(saved)}`);
      const worker = await newWorker('TD-1089 eidi tax');
      await orm.update(personnel).set({ isTaxCovered: 1 }).where(eq(personnel.id, worker));

      // excess 20,000,000 over the cap: 0 % on the first 10,000,000 and 10 % on the rest
      const preview = await admin.get(`/api/piecework/eidi-preview?personnelId=${worker}&year=1405`);
      const taxPreview = field(preview, 'tax') as { suggestion?: { taxableExcess?: string; incomeTax?: string } } | undefined;
      if (preview.status !== 200 || taxPreview?.suggestion?.taxableExcess !== '20000000' || taxPreview?.suggestion?.incomeTax !== '1000000') problems.push(`the preview answered ${brief(preview)}, expected excess 20,000,000 and tax 1,000,000`);
      const noReason = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405, incomeTax: '0' });
      if (noReason.status !== 422 || codeOf(noReason) !== 'PAYROLL_EIDI_OVERRIDE_REASON_REQUIRED') problems.push(`a tax of 0 without a reason answered ${brief(noReason)}, expected 422`);
      const issued = await admin.post('/api/piecework/eidi-payslips', { personnelId: worker, year: 1405 });
      const id = Number(field(issued, 'id'));
      const [row] = await q('SELECT net_payable::text AS net, income_tax::text AS tax FROM piecework_payrolls WHERE id = $1', [id]);
      if (issued.status !== 201 || !fin(String(row?.net)).equals(59_000_000) || !fin(String(row?.tax)).equals(1_000_000)) problems.push(`the eidi payslip answered ${brief(issued)} and stored ${JSON.stringify(row)}, expected net 59,000,000 and tax 1,000,000`);
      const posted = { tax: await personNet('3206', worker), wages: await personNet('3201', worker), expense: await personNet('7014', worker) };
      if (!fin(posted.tax).equals(-1_000_000) || !fin(posted.wages).equals(-59_000_000) || !fin(posted.expense).equals(60_000_000)) problems.push(`the voucher posted ${JSON.stringify(posted)}`);

      const exempt = await newWorker('TD-1089 eidi not tax covered');
      const free = await admin.post('/api/piecework/eidi-payslips', { personnelId: exempt, year: 1405 });
      const [freeRow] = await q('SELECT net_payable::text AS net, income_tax::text AS tax FROM piecework_payrolls WHERE id = $1', [Number(field(free, 'id'))]);
      if (free.status !== 201 || !fin(String(freeRow?.tax)).isZero() || !fin(String(freeRow?.net)).equals(60_000_000)) problems.push(`a personnel not covered by payroll tax answered ${brief(free)} and stored ${JSON.stringify(freeRow)}`);

      const violations = await checkPayrollInvariants(0);
      if (violations.length) problems.push(`I10: ${JSON.stringify(violations).slice(0, 300)}`);
      assertNoProblems(problems);
      return 'Excess 20,000,000 over the 40,000,000 cap taxed 1,000,000 on 3206, net 59,000,000; tax 0 without a reason 422; a personnel not covered pays no tax; I10 clean.';
    }));
  }

  return results;
}
