import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, newTask, newWorker, personNet } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * TD-1243 (product-owner decision t33 «الف»): one treasury payment per month to the social security organisation or the
 * tax office, with one debit per person on 3204 / 3206 under that person's detail. Before, such a payment went to 3204 or
 * 3206 without a personnel detail, so each person's statement kept the paid amount as owed. Real Express routes on
 * PostgreSQL in an isolated schema; each case is red on v10.1.34, which has no such route.
 */

type Res = { status: number; body?: unknown };

const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const field = (res: Res, key: string) => (res.body as Record<string, unknown> | undefined)?.[key];

/** Farvardin 1405, a whole Jalali month */
const MONTH = { startDate: '1405/01/01', endDate: '1405/01/31' };
const LOG_DATE = '2026-03-25';
const PAY_DATE = '2026-04-20';

/** employee 7 %, employer 23 %, tax 0 % up to 10,000,000 then 10 %, employee insurance off the tax base */
const RATES_1405 = {
  employeeInsurancePercent: '7',
  employerInsurancePercent: '23',
  insuranceWageCap: '0',
  taxBrackets: [{ from: '0', to: '10000000', rate: '0' }, { from: '10000000', to: null, rate: '10' }],
  deductInsuranceFromTax: true,
};

type OptionRow = { personnelId: number; monthAmount: string; remitted: string; balance: string; suggested: string };

const bankBalance = async (bankId: number) => fin(String((await q('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId]))[0]?.b ?? '0'));

async function setup() {
  const admin = await sandboxAdminClient();
  const saved = await admin.put('/api/piecework/statutory-rates/1405', RATES_1405);
  if (saved.status !== 200) throw new Error(`setup: rates ${brief(saved)}`);
  const task = await newTask();
  const worker = async (name: string, amount: number, covered: boolean) => {
    const id = await newWorker(name);
    if (covered) await orm.update(personnel).set({ isInsuranceCovered: 1, isTaxCovered: 1 }).where(eq(personnel.id, id));
    await addLog(id, task, LOG_DATE, amount);
    const issued = await admin.post('/api/piecework/payrolls/generate', { personnelId: id, ...MONTH });
    const payrollId = Number(field(issued, 'id'));
    if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
    const approved = await admin.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
    if (approved.status !== 200) throw new Error(`setup: approve ${brief(approved)}`);
    return id;
  };
  // 20,000,000 → insurance 1,400,000 + 4,600,000, tax 860,000; 10,000,000 → insurance 700,000 + 2,300,000, tax 0
  const high = await worker('TD-1243 high', 20_000_000, true);
  const low = await worker('TD-1243 low', 10_000_000, true);
  const informal = await worker('TD-1243 informal', 8_000_000, false);
  const bankId = await fundedBank();
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 20_000_000, bankAccountId: bankId, partyType: 'other', contraAccountId: await miscContraAccountId(), partyName: 'TD-1243 funding', date: '2026-04-01', username: 'reg',
  });
  return { admin, high, low, informal, bankId };
}

const rowsOf = (res: Res) => (field(res, 'rows') as OptionRow[] | undefined) ?? [];

export async function runStatutoryRemittanceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const payId = 'reg_statutory_remittance_td_1243';
  if (shouldRun(payId, 'td1243', 'payroll', 'statutory', 'treasury', 'remittance', 'insurance')) {
    await runCase(results, payId, 'v10.1.36: one insurance or payroll tax payment for the month debits 3204 / 3206 per person under that person\'s detail, so each balance is zero; only covered personnel are listed, an amount above a balance is 422, and voiding the payment restores everything (TD-1243)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { admin, high, low, informal, bankId } = await setup();

      const options = await admin.get('/api/accounting/treasury/statutory-remittance/options?kind=insurance&year=1405&month=1');
      const rows = rowsOf(options);
      const byId = new Map(rows.map(r => [r.personnelId, r]));
      if (options.status !== 200 || rows.length !== 2) problems.push(`the insurance list answered ${brief(options)}, expected the two covered workers`);
      if (byId.has(informal)) problems.push('the insurance list shows a worker who is not covered');
      if (!fin(byId.get(high)?.suggested ?? 0).equals(6_000_000) || !fin(byId.get(low)?.suggested ?? 0).equals(3_000_000)) problems.push(`the suggestions are ${JSON.stringify(rows)}, expected 6,000,000 and 3,000,000`);
      const taxOptions = await admin.get('/api/accounting/treasury/statutory-remittance/options?kind=tax&year=1405&month=1');
      const taxRows = rowsOf(taxOptions);
      if (taxOptions.status !== 200 || taxRows.length !== 1 || taxRows[0].personnelId !== high || !fin(taxRows[0].suggested).equals(860_000)) problems.push(`the tax list answered ${brief(taxOptions)}, expected only the high earner at 860,000`);

      const pay = (body: Record<string, unknown>) => admin.post('/api/accounting/treasury/statutory-remittance', { year: 1405, month: 1, bankAccountId: bankId, date: PAY_DATE, ...body });
      const over = await pay({ kind: 'insurance', lines: [{ personnelId: high, amount: '6000001' }] });
      if (over.status !== 422 || codeOf(over) !== 'STATUTORY_REMITTANCE_EXCEEDS_BALANCE') problems.push(`an amount above the balance answered ${brief(over)}, expected 422 STATUTORY_REMITTANCE_EXCEEDS_BALANCE`);
      const notOwed = await pay({ kind: 'insurance', lines: [{ personnelId: informal, amount: '1000' }] });
      if (notOwed.status !== 422 || codeOf(notOwed) !== 'STATUTORY_REMITTANCE_EXCEEDS_BALANCE') problems.push(`a payment for a worker who owes nothing answered ${brief(notOwed)}, expected 422`);
      const twice = await pay({ kind: 'insurance', lines: [{ personnelId: high, amount: '1000' }, { personnelId: high, amount: '1000' }] });
      if (twice.status !== 422 || codeOf(twice) !== 'STATUTORY_REMITTANCE_LINE_INVALID') problems.push(`a person listed twice answered ${brief(twice)}, expected 422 STATUTORY_REMITTANCE_LINE_INVALID`);

      const before = await bankBalance(bankId);
      const { '7009': penaltyAccountId } = await accountIdsByCode('7009');
      const paid = await pay({ kind: 'insurance', trackingNumber: 'TD-1243-INS', lines: [{ personnelId: high, amount: '6000000' }, { personnelId: low, amount: '3000000' }], penalty: { amount: '150000', accountId: penaltyAccountId } });
      const treasuryId = Number(field(paid, 'id'));
      if (paid.status !== 201 || !treasuryId) throw new Error(`the insurance payment answered ${brief(paid)}, expected 201`);
      for (const [name, id] of [['high', high], ['low', low]] as const) {
        const net = await personNet('3204', id);
        if (!fin(net).isZero()) problems.push(`the ${name} worker's 3204 balance is ${net} after the payment, expected 0`);
      }
      if (!before.subtract(await bankBalance(bankId)).equals(9_150_000)) problems.push(`the bank went down by ${before.subtract(await bankBalance(bankId)).toString()}, expected 9,150,000`);
      const [voucherCheck] = await q(`SELECT COUNT(*) FILTER (WHERE a.code = '3204' AND i.detailed_type = 'personnel')::int AS person_rows,
                                             COALESCE(SUM(i.debit) FILTER (WHERE a.code = '7009'), 0)::text AS penalty,
                                             COALESCE(SUM(i.credit), 0)::text AS credit
                                        FROM treasury_transactions t JOIN journal_voucher_items i ON i.voucher_id = t.voucher_id AND i.is_deleted = 0
                                        JOIN accounts a ON a.id = i.account_id WHERE t.id = $1`, [treasuryId]);
      if (Number(voucherCheck?.person_rows) !== 2 || !fin(String(voucherCheck?.penalty)).equals(150_000) || !fin(String(voucherCheck?.credit)).equals(9_150_000)) problems.push(`the voucher has ${JSON.stringify(voucherCheck)}, expected two personnel rows on 3204, 150,000 on 7009 and a credit of 9,150,000`);
      const after = rowsOf(await admin.get('/api/accounting/treasury/statutory-remittance/options?kind=insurance&year=1405&month=1'));
      const highAfter = after.find(r => r.personnelId === high);
      if (!highAfter || !fin(highAfter.remitted).equals(6_000_000) || !fin(highAfter.suggested).isZero()) problems.push(`after the payment the list shows ${JSON.stringify(highAfter ?? null)}, expected 6,000,000 paid and nothing suggested`);

      const taxPaid = await pay({ kind: 'tax', lines: [{ personnelId: high, amount: '860000' }] });
      if (taxPaid.status !== 201 || !fin(await personNet('3206', high)).isZero()) problems.push(`the tax payment answered ${brief(taxPaid)} and left 3206 at ${await personNet('3206', high)}`);

      const voided = await admin.post(`/api/accounting/treasury/${treasuryId}/void`, { reason: 'TD-1243 wrong bank' });
      if (voided.status !== 200) problems.push(`the void answered ${brief(voided)}, expected 200`);
      if (!fin(await personNet('3204', high)).equals(-6_000_000)) problems.push(`after the void the high worker's 3204 balance is ${await personNet('3204', high)}, expected −6,000,000`);
      // only the 860,000 tax payment stays out of the bank
      if (!before.subtract(860_000).equals(await bankBalance(bankId))) problems.push(`after the void the bank is ${(await bankBalance(bankId)).toString()}, expected ${before.subtract(860_000).toString()}`);
      const reopened = rowsOf(await admin.get('/api/accounting/treasury/statutory-remittance/options?kind=insurance&year=1405&month=1')).find(r => r.personnelId === high);
      if (!reopened || !fin(reopened.remitted).isZero() || !fin(reopened.suggested).equals(6_000_000)) problems.push(`after the void the list shows ${JSON.stringify(reopened ?? null)}, expected nothing paid and 6,000,000 suggested`);

      assertNoProblems(problems);
      return 'Lists show the covered workers only (insurance 6,000,000 / 3,000,000, tax 860,000); above balance, not owed and twice 422; one payment of 9,150,000 with a 150,000 penalty leaves 3204 at zero per person; tax payment leaves 3206 at zero; void restores the balances, the bank and the suggestion.';
    }));
  }

  const guardId = 'reg_statutory_remittance_guards_td_1243';
  if (shouldRun(guardId, 'td1243', 'payroll', 'statutory', 'treasury', 'remittance', 'health')) {
    await runCase(results, guardId, 'v10.1.36: the monthly remittance needs accounting.treasury, is rial only, and a legacy insurance payment without personnel detail is listed by the health check (TD-1243)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { admin, high, bankId } = await setup();
      const body = { kind: 'insurance', year: 1405, month: 1, bankAccountId: bankId, date: PAY_DATE, lines: [{ personnelId: high, amount: '1000' }] };

      const payrollOnly = await sandboxClientWith(['piecework.view', 'piecework.payroll']);
      const refusedList = await payrollOnly.get('/api/accounting/treasury/statutory-remittance/options?kind=insurance&year=1405&month=1');
      const refusedPay = await payrollOnly.post('/api/accounting/treasury/statutory-remittance', body);
      if (refusedList.status !== 403 || refusedPay.status !== 403) problems.push(`a payroll issuer answered ${brief(refusedList)} / ${brief(refusedPay)}, expected 403 twice`);

      await q("UPDATE bank_accounts SET currency = 'USD' WHERE id = $1", [bankId]);
      const foreign = await admin.post('/api/accounting/treasury/statutory-remittance', body);
      if (foreign.status !== 422 || codeOf(foreign) !== 'STATUTORY_REMITTANCE_RIAL_ONLY') problems.push(`a foreign bank answered ${brief(foreign)}, expected 422 STATUTORY_REMITTANCE_RIAL_ONLY`);
      await q("UPDATE bank_accounts SET currency = 'IRR' WHERE id = $1", [bankId]);
      const badKind = await admin.post('/api/accounting/treasury/statutory-remittance', { ...body, kind: 'eidi' });
      if (badKind.status !== 400) problems.push(`an unknown kind answered ${brief(badKind)}, expected 400`);

      const health = async () => (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'statutory_payments_without_personnel');
      const clean = await health();
      if (!clean || clean.status !== 'healthy') problems.push(`the health check is ${clean?.status} before any legacy payment`);
      const paid = await admin.post('/api/accounting/treasury/statutory-remittance', body);
      if (paid.status !== 201) problems.push(`a rial payment answered ${brief(paid)}, expected 201`);
      const afterRemittance = await health();
      if (!afterRemittance || afterRemittance.status !== 'healthy') problems.push(`the health check is ${afterRemittance?.status} after a remittance with personnel detail`);

      const { '3204': insuranceAccountId } = await accountIdsByCode('3204');
      const legacy = await admin.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 200_000, bankAccountId: bankId, partyType: 'other', partyName: 'TD-1243 social security', contraAccountId: insuranceAccountId, date: PAY_DATE,
      });
      if (legacy.status !== 201) throw new Error(`setup: legacy payment ${brief(legacy)}`);
      const listed = await health();
      if (!listed || listed.status !== 'warning' || listed.items?.length !== 1) problems.push(`the health check is ${listed?.status} ${JSON.stringify(listed?.items ?? []).slice(0, 200)}, expected the legacy payment`);
      const voided = await admin.post(`/api/accounting/treasury/${Number(field(legacy, 'id'))}/void`, { reason: 'TD-1243 legacy' });
      const cleared = await health();
      if (voided.status !== 200 || !cleared || cleared.status !== 'healthy') problems.push(`after voiding the legacy payment (${brief(voided)}) the health check is ${cleared?.status}`);

      assertNoProblems(problems);
      return 'Payroll issuer 403 on list and payment; foreign bank 422; unknown kind 400; health check clean after a remittance, warns on a legacy 3204 payment without detail and clears after its void.';
    }));
  }

  return results;
}
