import request from 'supertest';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, customers, journalVouchers, personnel } from '../../db/schema.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getCustomerAccountCard } from '../../services/customers/customerAccountCard.js';
import { findCustomerDeleteBlockers } from '../../services/customers/customerDeleteGuard.js';
import { findPersonnelDeleteBlockers } from '../../services/personnel/personnelDeleteGuard.js';
import { createBank } from './treasuryPartyTests.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Series 10 phase 3 lane L1, package A6 (v10.0.255, decision t5 option A of the phase 5 review): a party's statement,
 * account card and delete guard count permanent accounts only and show temporary rows apart, and a payslip's other
 * deductions (3205) are remitted by a treasury payment with the personnel detail. Each test is red on the version before
 * its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const DATE = '2026-04-01';

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

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

async function mapped(find: () => Promise<{ id: number } | null>, label: string): Promise<number> {
  const acc = await find();
  if (!acc) throw new Error(`mapped account ${label} is missing`);
  return acc.id;
}

interface Line { accountId: number; debit: number; credit: number; detailedType?: string; detailedId?: number; detailedName?: string }

async function postApproved(description: string, lines: Line[]): Promise<void> {
  await VoucherService.createJournalVoucher({
    date: DATE, voucherType: 'general', status: 'approved', description, referenceModule: 'manual',
    items: lines.map(l => ({ ...l, description })),
  });
}

export async function runPartyPermanentA6Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const supplierId = 'reg_party_balance_permanent_accounts_td_915';
  if (shouldRun(supplierId, 'td915', 'party', 'ledger', 'a6')) {
    await runCase(results, supplierId, 'v10.0.255: a supplier paid in full has a zero statement, card and delete-guard balance; the donated goods income row is shown apart (TD-915)', async () => {
      const problems: string[] = [];
      const name = `ERP-TEST-MARKER A6 supplier ${tagOf()}`;
      const [supplier] = await orm.insert(customers).values({ name, partyType: 'supplier' }).returning();
      const party = { detailedType: 'supplier', detailedId: supplier.id, detailedName: name };
      const bank = await createBank('A6 supplier');
      const payables = await mapped(() => AccountMappingService.getTradePayablesAccount(), 'trade payables');
      const donated = await mapped(() => AccountMappingService.getDonatedGoodsIncomeAccount(), 'donated goods income');
      const inventory = await mapped(() => AccountMappingService.getInventoryRawMaterialsAccount(), 'raw materials');
      // receipt: 2 free units at WAC 300,000 and 1 unit at 1,000,000; then the 1,000,000 paid
      await postApproved('A6 receipt with free goods', [
        { accountId: inventory, debit: 1_600_000, credit: 0 },
        { accountId: payables, debit: 0, credit: 1_000_000, ...party },
        { accountId: donated, debit: 0, credit: 600_000, ...party },
      ]);
      await postApproved('A6 supplier payment', [
        { accountId: payables, debit: 1_000_000, credit: 0, ...party },
        { accountId: bank.ledgerId, debit: 0, credit: 1_000_000 },
      ]);

      const statement = await AccountingReportService.getDetailedPartyLedger({ partyId: supplier.id, partyType: 'supplier' });
      if (statement.finalBalance !== 0) problems.push(`statement balance is ${statement.finalBalance}, expected 0`);
      if (statement.items.some(r => r.accountCode && r.credit === 600_000)) problems.push('the donated goods row is among the balance rows');
      const tempStatement = statement.temporaryRows?.items ?? [];
      if (tempStatement.length !== 1 || tempStatement[0].credit !== 600_000) {
        problems.push(`statement temporary rows are ${JSON.stringify(tempStatement)}, expected the one 600,000 credit row`);
      }
      const card = await getCustomerAccountCard(supplier.id);
      if (card.finalBalance !== 0) problems.push(`account card balance is ${card.finalBalance}, expected 0`);
      if ((card.temporaryRows?.items ?? []).length !== 1) problems.push(`account card temporary rows are ${JSON.stringify(card.temporaryRows)}`);
      const blockers = await findCustomerDeleteBlockers(supplier, orm);
      if (blockers.balances.length > 0) problems.push(`delete guard sees balances ${JSON.stringify(blockers.balances)}`);
      assertNoProblems(problems);
      return 'statement, card and delete guard read 0 on permanent accounts; the 600,000 donated goods row is listed apart';
    });
  }

  const personnelId = 'reg_personnel_statement_and_deductions_payment_td_924_952';
  if (shouldRun(personnelId, 'td924', 'td952', 'party', 'ledger', 'payroll', 'treasury', 'a6')) {
    await runCase(results, personnelId, 'v10.0.255: a paid payslip leaves only its deductions on the personnel statement, and a «deductions» treasury payment with the personnel detail clears them (TD-924 / TD-952)', async () => {
      const problems: string[] = [];
      const fullName = `ERP-TEST-MARKER A6 worker ${tagOf()}`;
      const [worker] = await orm.insert(personnel).values({ fullName }).returning();
      const person = { detailedType: 'personnel', detailedId: worker.id, detailedName: fullName };
      const bank = await createBank('A6 payroll');
      const expense = await mapped(() => AccountMappingService.getFixedSalaryExpenseAccount(), 'fixed salary expense');
      const wages = await mapped(() => AccountMappingService.getWagesPayableAccount(), 'wages payable');
      const deductions = await mapped(() => AccountMappingService.getEmployeeDeductionsPayableAccount(), 'other deductions payable');
      await postApproved('A6 payslip', [
        { accountId: expense, debit: 2_000_000, credit: 0, ...person },
        { accountId: wages, debit: 0, credit: 1_500_000, ...person },
        { accountId: deductions, debit: 0, credit: 500_000, ...person },
      ]);
      await postApproved('A6 payslip payment', [
        { accountId: wages, debit: 1_500_000, credit: 0, ...person },
        { accountId: bank.ledgerId, debit: 0, credit: 1_500_000 },
      ]);

      const before = await AccountingReportService.getDetailedPartyLedger({ partyId: worker.id, partyType: 'personnel' });
      if (before.finalBalance !== -500_000) problems.push(`statement balance after the payslip payment is ${before.finalBalance}, expected -500000 (the deductions)`);
      if (before.temporaryRows?.totalDebit !== 2_000_000) problems.push(`statement temporary debit is ${before.temporaryRows?.totalDebit}, expected 2000000 (salary expense)`);

      const api = await adminClient();
      const base = { method: 'bank_transfer', bankAccountId: bank.id, date: DATE };
      const funding = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 1_000_000, partyType: 'other', partyName: 'A6 owner deposit', contraAccountId: (await orm.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, '4101')))[0]?.id });
      if (funding.status !== 201) throw new Error(`funding receipt returned ${funding.status}: ${JSON.stringify(funding.body).slice(0, 200)}`);
      const paid = await api.post('/api/accounting/treasury', {
        ...base, type: 'payment', amount: 500_000, partyType: 'personnel', partyId: worker.id, partyName: fullName, purpose: 'deductions',
      });
      if (paid.status !== 201) throw new Error(`deductions payment returned ${paid.status}: ${JSON.stringify(paid.body).slice(0, 200)}`);
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.id, Number(paid.body.voucherId)));

      const after = await AccountingReportService.getDetailedPartyLedger({ partyId: worker.id, partyType: 'personnel' });
      if (after.finalBalance !== 0) problems.push(`statement balance after the deductions payment is ${after.finalBalance}, expected 0`);
      const paidRow = after.items.find(r => r.debit === 500_000);
      const [deductionsAccount] = await orm.select({ code: accounts.code }).from(accounts).where(eq(accounts.id, deductions));
      if (paidRow?.accountCode !== deductionsAccount?.code) problems.push(`deductions payment debited ${paidRow?.accountCode}, expected ${deductionsAccount?.code}`);
      const blockers = await findPersonnelDeleteBlockers(worker, orm);
      if (blockers.balances.length > 0) problems.push(`delete guard sees balances ${JSON.stringify(blockers.balances)}`);
      assertNoProblems(problems);
      return 'the statement shows the 500,000 deductions only, and the deductions payment clears them on 3205 with the personnel detail';
    });
  }

  return results;
}
