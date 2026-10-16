import request from 'supertest';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { bankAccounts, cheques } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { normalizeError, ValidationError } from '../../errors/customErrors.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { createBank } from './treasuryPartyTests.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * v10.1.47 closing sweep, cheques and treasury observations of package 4: each test is red on v10.1.46.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const CHEQUE_BASE = { bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', username: 'inv' };

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return { get: (url: string) => request(app).get(url).set('Cookie', s.cookie) };
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

async function chequeRow(id: number) {
  const [row] = await orm.select({ status: cheques.status, bankAccountId: cheques.bankAccountId }).from(cheques).where(eq(cheques.id, id));
  return row;
}

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run(); return 'accepted'; } catch (err) { return String((err as { code?: unknown }).code ?? 'no code'); }
};

export async function runTreasuryChequeSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const filterId = 'reg_cheque_list_real_status_filter_obs_pr_12';
  if (shouldRun(filterId, 'obs-pr-12', 'cheque', 'filter', 'status')) {
    await runCase(results, filterId, 'v10.1.47: the cheque list filters by the real cheque statuses and refuses the retired ones (OBS-PR-12)', async () => {
      const api = await adminClient();
      const collecting = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWF${tagOf()}`, amount: 150000, partyName: 'Sweep filter customer' });
      await ChequeLifecycleService.updateChequeStatus(collecting.id, { status: 'in_collection', username: 'inv' });
      const real = await api.get('/api/accounting/cheques?status=in_collection');
      const retired = await api.get('/api/accounting/cheques?status=pending');
      const rows = Array.isArray(real.body) ? real.body as Array<{ id: number; status: string }> : [];
      assertNoProblems([
        ...(real.status === 200 ? [] : [`status=in_collection answered ${real.status}`]),
        ...(rows.some(r => r.id === collecting.id) ? [] : ['the cheque in collection is not in the filtered list']),
        ...(rows.every(r => r.status === 'in_collection') ? [] : ['the filtered list holds another status']),
        ...(retired.status === 400 ? [] : [`the retired status=pending answered ${retired.status}, expected 400`]),
      ]);
      return 'status=in_collection lists the cheque, status=pending is 400';
    });
  }

  const paidId = 'reg_paid_cheque_not_sent_to_collection_obs_r1_61';
  if (shouldRun(paidId, 'obs-r1-61', 'cheque', 'collection', 'paid')) {
    await runCase(results, paidId, 'v10.1.47: a paid cheque is never sent to collection, which would post no voucher (OBS-R1-61)', async () => {
      const bank = await createBank('Sweep paid cheque');
      const paid = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: `SWP${tagOf()}`, amount: 90000, partyName: 'Sweep paid supplier', bankAccountId: bank.id });
      const code = await codeOf(() => ChequeLifecycleService.updateChequeStatus(paid.id, { status: 'in_collection', username: 'inv' }));
      const row = await chequeRow(paid.id);
      assertNoProblems([
        ...(code === 'BUSINESS_LOGIC' ? [] : [`sending a paid cheque to collection answered ${code}`]),
        ...(row?.status === 'in_treasury' ? [] : [`the paid cheque moved to ${row?.status}`]),
      ]);
      return 'the paid cheque stayed in treasury';
    });
  }

  const bankId = 'reg_cheque_step_keeps_its_bank_obs_r1_70';
  if (shouldRun(bankId, 'obs-r1-70', 'cheque', 'bank')) {
    await runCase(results, bankId, 'v10.1.47: only sending to collection or clearing changes a cheque\'s bank account (OBS-R1-70)', async () => {
      const first = await createBank('Sweep cheque bank A');
      const other = await createBank('Sweep cheque bank B');
      const cheque = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWB${tagOf()}`, amount: 80000, partyName: 'Sweep bank customer', bankAccountId: first.id });
      await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'in_treasury', bankAccountId: other.id, username: 'inv' });
      const afterTreasury = await chequeRow(cheque.id);
      await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'in_collection', bankAccountId: other.id, username: 'inv' });
      const afterCollection = await chequeRow(cheque.id);
      assertNoProblems([
        ...(afterTreasury?.bankAccountId === first.id ? [] : [`moving to the safe set the bank to ${afterTreasury?.bankAccountId}, expected ${first.id}`]),
        ...(afterCollection?.bankAccountId === other.id ? [] : [`sending to collection left bank ${afterCollection?.bankAccountId}, expected ${other.id}`]),
      ]);
      return 'the safe step kept the bank, collection set it';
    });
  }

  const messageId = 'reg_cheque_sayad_and_bank_balance_messages_obs_r1_57';
  if (shouldRun(messageId, 'obs-r1-57', 'cheque', 'sayad', 'bank', 'balance')) {
    await runCase(results, messageId, 'v10.1.47: a repeated Sayad id and a negative bank balance get their own message and code (OBS-R1-57)', async () => {
      const sayad = `9${String(Date.now()).slice(-9)}${String(++seq).padStart(6, '0')}`.slice(0, 16);
      await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWS${tagOf()}`, amount: 70000, partyName: 'Sweep sayad customer', sayadNumber: sayad });
      const repeatCode = await codeOf(() => ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWS${tagOf()}`, amount: 70000, partyName: 'Sweep sayad customer', sayadNumber: sayad }));
      const bank = await createBank('Sweep negative bank');
      let balanceCode = 'accepted';
      try {
        await orm.update(bankAccounts).set({ currentBalance: money(-1) }).where(eq(bankAccounts.id, bank.id));
      } catch (err) {
        balanceCode = normalizeError(err).code;
      }
      assertNoProblems([
        ...(repeatCode === 'CHEQUE_SAYAD_TAKEN' ? [] : [`a repeated Sayad id answered ${repeatCode}`]),
        ...(balanceCode === 'BANK_BALANCE_NEGATIVE' ? [] : [`a negative bank balance answered ${balanceCode}`]),
      ]);
      return 'CHEQUE_SAYAD_TAKEN and BANK_BALANCE_NEGATIVE';
    });
  }

  const clearingId = 'reg_cheque_clearing_account_rules_t40';
  if (shouldRun(clearingId, 'obs-r1-70', 'cheque', 'bank', 'clearing', 'pos', 'petty')) {
    await runCase(results, clearingId, 'v10.1.47: a cheque clears only into a bank or cash account, and a paid cheque only from its issuing account (decision t40)', async () => {
      const issuing = await createBank('Sweep issuing bank');
      await orm.update(bankAccounts).set({ currentBalance: money(1_000_000) }).where(eq(bankAccounts.id, issuing.id));
      const other = await createBank('Sweep other bank');
      const pos = await createBank('Sweep pos');
      await orm.update(bankAccounts).set({ type: 'pos' }).where(eq(bankAccounts.id, pos.id));
      const petty = await createBank('Sweep petty');
      await orm.update(bankAccounts).set({ type: 'petty_cash' }).where(eq(bankAccounts.id, petty.id));

      const paidOther = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: `SWC${tagOf()}`, amount: 60000, partyName: 'Sweep clearing supplier', bankAccountId: issuing.id });
      const otherBankCode = await codeOf(() => ChequeLifecycleService.updateChequeStatus(paidOther.id, { status: 'passed', bankAccountId: other.id, username: 'inv' }));
      const afterOther = await chequeRow(paidOther.id);

      const paidStored = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'paid', chequeNumber: `SWC${tagOf()}`, amount: 60000, partyName: 'Sweep clearing supplier', bankAccountId: issuing.id });
      const storedCode = await ChequeLifecycleService.updateChequeStatus(paidStored.id, { status: 'passed', username: 'inv' }).then(() => 'accepted', (err: unknown) => `${String((err as { code?: unknown }).code)} ${err instanceof Error ? err.message : ''}`);
      const afterStored = await chequeRow(paidStored.id);

      const noBank = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWC${tagOf()}`, amount: 50000, partyName: 'Sweep clearing customer' });
      let noBankError = 'accepted';
      try {
        await ChequeLifecycleService.updateChequeStatus(noBank.id, { status: 'passed', username: 'inv' });
      } catch (err) {
        noBankError = err instanceof ValidationError ? 'ValidationError' : String((err as { code?: unknown }).code ?? err);
      }

      const toPos = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `SWC${tagOf()}`, amount: 50000, partyName: 'Sweep clearing customer' });
      const posPassCode = await codeOf(() => ChequeLifecycleService.updateChequeStatus(toPos.id, { status: 'passed', bankAccountId: pos.id, username: 'inv' }));
      const pettyCollectCode = await codeOf(() => ChequeLifecycleService.updateChequeStatus(toPos.id, { status: 'in_collection', bankAccountId: petty.id, username: 'inv' }));
      const afterPos = await chequeRow(toPos.id);

      assertNoProblems([
        ...(otherBankCode === 'CHEQUE_PAID_BANK_FIXED' ? [] : [`clearing a paid cheque from another bank answered ${otherBankCode}`]),
        ...(afterOther?.status === 'in_treasury' && afterOther.bankAccountId === issuing.id ? [] : [`the refused paid cheque is ${afterOther?.status} on bank ${afterOther?.bankAccountId}`]),
        ...(storedCode === 'accepted' && afterStored?.status === 'passed' && afterStored.bankAccountId === issuing.id ? [] : [`a paid cheque cleared without a bank answered ${storedCode}, now ${afterStored?.status} on bank ${afterStored?.bankAccountId}`]),
        ...(noBankError === 'ValidationError' ? [] : [`clearing a received cheque with no bank answered ${noBankError}`]),
        ...(posPassCode === 'CHEQUE_CLEARING_ACCOUNT_TYPE' ? [] : [`clearing into a POS account answered ${posPassCode}`]),
        ...(pettyCollectCode === 'CHEQUE_CLEARING_ACCOUNT_TYPE' ? [] : [`sending to collection into petty cash answered ${pettyCollectCode}`]),
        ...(afterPos?.status === 'received' && afterPos.bankAccountId === null ? [] : [`the refused received cheque moved to ${afterPos?.status} on bank ${afterPos?.bankAccountId}`]),
      ]);
      return 'paid cheques clear from their issuing bank, POS and petty cash are refused';
    });
  }

  return results;
}
