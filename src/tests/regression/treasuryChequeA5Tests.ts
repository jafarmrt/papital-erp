import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts, cheques } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { createBank } from './treasuryPartyTests.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Series 10 phase 3 lane L1, package A5 (v10.0.254): cheque steps without a mapped account, cleared cheques in bank
 * statement reconciliation and the bank account's ledger heading after its first movement. Each test is red on the version
 * before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const CHEQUE_BASE = { bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', username: 'inv' };

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
  };
}

const errorCode = (res: request.Response) => String(res.body?.code ?? '');

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

async function bankBalance(id: number): Promise<string> {
  const [row] = await orm.select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return fin(row?.b ?? 0).toString();
}

async function chequeStatus(id: number): Promise<string | null> {
  const [row] = await orm.select({ s: cheques.status }).from(cheques).where(eq(cheques.id, id));
  return row?.s ?? null;
}

/**
 * Takes the cheque notes receivable and in-collection accounts out of posting (level general) for `fn`, mapped and
 * default codes alike, then puts every level back.
 */
async function withoutChequeReceivableAccounts<T>(fn: () => Promise<T>): Promise<T> {
  const hidden = new Map<number, string>();
  try {
    for (let i = 0; i < 4; i++) {
      const found = [await AccountMappingService.getChequeReceivableAccount(), await AccountMappingService.getChequeInCollectionAccount()]
        .filter((a): a is NonNullable<typeof a> => Boolean(a));
      if (found.length === 0) break;
      for (const acc of found) {
        if (hidden.has(acc.id)) continue;
        hidden.set(acc.id, acc.level);
        await orm.update(accounts).set({ level: 'general' }).where(eq(accounts.id, acc.id));
      }
    }
    return await fn();
  } finally {
    for (const [id, level] of hidden) await orm.update(accounts).set({ level }).where(eq(accounts.id, id));
  }
}

export async function runTreasuryChequeA5Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const mappingId = 'reg_cheque_step_needs_mapped_account_td_970';
  if (shouldRun(mappingId, 'td970', 'cheque', 'treasury', 'a5')) {
    await runCase(results, mappingId, 'v10.0.254: a cheque step whose voucher has no mapped account is refused and changes neither status nor bank balance (TD-970)', async () => {
      const problems: string[] = [];
      const bank = await createBank('A5 cheque mapping');
      const clearing = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `A5C${tagOf()}`, amount: 500000, partyName: 'A5 mapping customer' });
      const collecting = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `A5K${tagOf()}`, amount: 300000, partyName: 'A5 mapping customer' });
      const before = await bankBalance(bank.id);
      const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
        try { await run(); return 'accepted'; } catch (err) { return String((err as { code?: unknown }).code ?? 'no code'); }
      };
      const [clearCode, collectCode] = await withoutChequeReceivableAccounts(async () => [
        await refusalOf(() => ChequeLifecycleService.updateChequeStatus(clearing.id, { status: 'passed', bankAccountId: bank.id, username: 'inv' })),
        await refusalOf(() => ChequeLifecycleService.updateChequeStatus(collecting.id, { status: 'in_collection', username: 'inv' })),
      ]);
      if (clearCode !== 'CHEQUE_ACCOUNT_MAPPING_MISSING') problems.push(`clearing without a notes receivable account answered ${clearCode}`);
      if (collectCode !== 'CHEQUE_ACCOUNT_MAPPING_MISSING') problems.push(`sending to collection without the accounts answered ${collectCode}`);
      if (await chequeStatus(clearing.id) !== 'received') problems.push(`the refused clearing left status ${await chequeStatus(clearing.id)}`);
      if (await chequeStatus(collecting.id) !== 'received') problems.push(`the refused collection left status ${await chequeStatus(collecting.id)}`);
      const after = await bankBalance(bank.id);
      if (after !== before) problems.push(`bank balance moved from ${before} to ${after} with no voucher`);
      // the accounts back, the same clearing passes
      await ChequeLifecycleService.updateChequeStatus(clearing.id, { status: 'passed', bankAccountId: bank.id, username: 'inv' });
      if (await chequeStatus(clearing.id) !== 'passed') problems.push('clearing with the accounts mapped did not pass');
      assertNoProblems(problems);
      return 'clearing and collection without the mapped accounts were refused with nothing changed; with them the clearing passed';
    });
  }

  const reconcileId = 'reg_cleared_cheque_in_bank_reconciliation_td_971';
  if (shouldRun(reconcileId, 'td971', 'cheque', 'reconcile', 'treasury', 'a5')) {
    await runCase(results, reconcileId, 'v10.0.254: a cleared cheque is a bank statement reconciliation candidate and is marked reconciled like a treasury row (TD-971)', async () => {
      const problems: string[] = [];
      const api = await adminClient();
      const bank = await createBank('A5 reconcile');
      const cleared = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `A5R${tagOf()}`, amount: 700000, partyName: 'A5 reconcile customer' });
      await ChequeLifecycleService.updateChequeStatus(cleared.id, { status: 'passed', bankAccountId: bank.id, actionDate: '2026-04-02', username: 'inv' });
      const open = await ChequeLifecycleService.createCheque({ ...CHEQUE_BASE, type: 'received', chequeNumber: `A5O${tagOf()}`, amount: 200000, partyName: 'A5 reconcile customer', bankAccountId: bank.id });

      const list = await api.get(`/api/accounting/treasury/reconcile-cheques?bankAccountId=${bank.id}`);
      const rows = Array.isArray(list.body) ? list.body as Array<{ id: number; type: string; amount: number; date: string; reconciled: number }> : [];
      if (list.status !== 200) problems.push(`candidate list answered ${list.status}`);
      const row = rows.find(r => r.id === cleared.id);
      if (!row) problems.push('the cleared cheque is not a reconciliation candidate');
      else if (row.type !== 'receipt' || row.amount !== 700000 || row.date !== '2026-04-02' || row.reconciled !== 0) problems.push(`candidate row ${JSON.stringify(row)}`);
      if (rows.some(r => r.id === open.id)) problems.push('a cheque that is not cleared is listed');

      const refused = await api.post('/api/accounting/treasury/reconcile', { bankAccountId: bank.id, chequeIds: [open.id], batch: 'a5', reconciled: true });
      if (refused.status !== 422 || errorCode(refused) !== 'TREASURY_RECONCILE_ROWS_INVALID') problems.push(`reconciling an uncleared cheque answered ${refused.status} ${errorCode(refused)}`);
      const ok = await api.post('/api/accounting/treasury/reconcile', { bankAccountId: bank.id, chequeIds: [cleared.id], batch: 'a5-stmt', reconciled: true });
      if (ok.status !== 200) problems.push(`reconciling the cleared cheque answered ${ok.status} ${JSON.stringify(ok.body)}`);
      const [stored] = await orm.select({ r: cheques.reconciled, batch: cheques.reconciledBatch, at: cheques.reconciledAt }).from(cheques).where(inArray(cheques.id, [cleared.id]));
      if (stored?.r !== 1 || stored.batch !== 'a5-stmt' || !stored.at) problems.push(`stored state ${JSON.stringify(stored)}`);
      assertNoProblems(problems);
      return 'the cleared cheque was listed and reconciled; the open cheque was neither listed nor accepted';
    });
  }

  const ledgerId = 'reg_bank_ledger_locked_after_movement_td_969';
  if (shouldRun(ledgerId, 'td969', 'bank', 'ledger', 'treasury', 'a5')) {
    await runCase(results, ledgerId, 'v10.0.254: a bank account keeps its ledger heading after its first movement; one without movement may change it (TD-969)', async () => {
      const problems: string[] = [];
      const api = await adminClient();
      const used = await createBank('A5 used bank');
      const fresh = await createBank('A5 fresh bank');
      const other = await createBank('A5 other ledger');
      await TreasuryTransactionService.createTreasuryTransaction({
        type: 'receipt', method: 'bank_transfer', amount: 100000, bankAccountId: used.id, partyType: 'customer', partyName: 'A5 ledger customer', username: 'inv',
      });
      const locked = await api.put(`/api/accounting/bank-accounts/${used.id}`, { accountId: other.ledgerId });
      if (locked.status !== 422 || errorCode(locked) !== 'BANK_ACCOUNT_LEDGER_LOCKED') problems.push(`changing the heading of a used account answered ${locked.status} ${errorCode(locked)}`);
      const [usedRow] = await orm.select({ a: bankAccounts.accountId }).from(bankAccounts).where(eq(bankAccounts.id, used.id));
      if (usedRow?.a !== used.ledgerId) problems.push(`the used account's heading became ${usedRow?.a}`);
      const moved = await api.put(`/api/accounting/bank-accounts/${fresh.id}`, { accountId: other.ledgerId });
      if (moved.status !== 200) problems.push(`changing the heading of an account without movement answered ${moved.status} ${JSON.stringify(moved.body)}`);
      assertNoProblems(problems);
      return 'the used account kept its heading with 422; the account without movement took the new one';
    });
  }

  return results;
}
