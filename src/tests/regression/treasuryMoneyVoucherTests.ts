import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts, treasuryTransactions } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { fin } from '../../lib/financialDecimal.js';

/**
 * Package 4 (treasury and cheques), PR «الف» money and vouchers: real Express routes on PostgreSQL. Each test is red on
 * the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Session = { cookie: string; csrfToken: string };

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function client(session?: Session) {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s: Session = session ?? await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
}

async function sessionWith(permissions: string[]): Promise<Session> {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code, username: `p04_${tagOf()}` });
  return loginTestUserWithSession(await getTestApp(), user.username);
}

/** A ledger account of its own under 1003, so other tests' banks never touch this bank's ledger balance */
async function ownLedgerAccount(title: string): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `${title} (test ledger)`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return ledger.id;
}

async function createBank(title: string, initialBalance = 0): Promise<number> {
  const api = await client();
  const res = await api.post('/api/accounting/bank-accounts', {
    title: `${title} ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount(title), initialBalance,
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`bank create returned ${res.status}: ${JSON.stringify(res.body)}`);
  return Number(res.body.id);
}

async function bankBalance(id: number): Promise<string> {
  const [row] = await orm.select({ current: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return fin(row?.current ?? 0).toString();
}

const errorText = (res: request.Response) => String(res.body?.error ?? res.body?.message ?? '');

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

export async function runTreasuryMoneyVoucherTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const reversalId = 'reg_treasury_reversal_void_refused_td_499';
  if (shouldRun(reversalId, 'td499', 'treasury', 'void', 'package4')) {
    await runCase(results, reversalId, 'v9.0.55: voiding a treasury reversal row is refused with 409, the bank keeps matching its ledger, and a legacy revived row is listed by the health check and the bank invariants (TD-499)', async () => {
      const { checkBankInvariants } = await import('../invariants/bankInvariants.js');
      const { findTreasuryEntriesWithoutVoucher } = await import('../../services/accounting/treasury/noVoucherTreasury.js');
      const problems: string[] = [];
      const bankId = await createBank('Revive bank');
      // a treasurer with accounting.treasury only, not the no-voucher permission (TD-409)
      const treasurer = await client(await sessionWith(['accounting.treasury']));
      const receipt = await treasurer.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 5_000_000, bankAccountId: bankId, partyType: 'other', partyName: 'test deposit',
      });
      if (receipt.status !== 201) throw new Error(`receipt returned ${receipt.status}: ${errorText(receipt)}`);
      const voided = await treasurer.post(`/api/accounting/treasury/${receipt.body.id}/void`, { reason: 'wrong entry' });
      if (voided.status !== 200) throw new Error(`void returned ${voided.status}: ${errorText(voided)}`);
      const revive = await treasurer.post(`/api/accounting/treasury/${voided.body.id}/void`, { reason: 'revive' });
      if (revive.status !== 409) problems.push(`voiding the reversal row returned ${revive.status}, expected 409`);
      else if (!errorText(revive).includes('تراکنش تازه')) problems.push(`409 message does not point to a new transaction: ${errorText(revive)}`);
      if (await bankBalance(bankId) !== '0') problems.push(`bank balance is ${await bankBalance(bankId)} after the refused revive, expected 0`);
      const bankRows = await orm.select({ id: treasuryTransactions.id, status: treasuryTransactions.status }).from(treasuryTransactions)
        .where(eq(treasuryTransactions.bankAccountId, bankId));
      if (bankRows.length !== 2) problems.push(`bank has ${bankRows.length} treasury rows, expected 2 (receipt + reversal)`);
      const clean = await checkBankInvariants([bankId]);
      if (clean.length > 0) problems.push(`bank invariants on a clean bank: ${clean.map(v => v.invariant).join(', ')}`);

      // legacy data written before v9.0.55: the reversal row voided and a revived row without a voucher
      await orm.update(treasuryTransactions).set({ status: 'voided' }).where(eq(treasuryTransactions.id, Number(voided.body.id)));
      const [legacy] = await orm.insert(treasuryTransactions).values({
        transactionNumber: `REC-LEGACY-${tagOf()}`, type: 'receipt', date: '2026-01-10', method: 'bank_transfer', amount: money(5_000_000),
        currency: 'IRR', exchangeRate: money(1), bankAccountId: bankId, partyType: 'other', partyName: 'test deposit',
        voucherId: null, reversalOfId: Number(voided.body.id), description: 'legacy revive', status: 'completed',
      }).returning({ id: treasuryTransactions.id });
      await orm.update(bankAccounts).set({ currentBalance: money(5_000_000) }).where(eq(bankAccounts.id, bankId));
      try {
        const listed = (await findTreasuryEntriesWithoutVoucher()).filter(e => e.kind === 'treasury' && e.id === legacy.id);
        if (listed.length !== 1) problems.push('health check «treasury_without_voucher» does not list the legacy revived row');
        const found = (await checkBankInvariants([bankId])).map(v => v.invariant).sort();
        if (found.join(',') !== 'I15_bank_balance_matches_ledger,I16_no_revived_treasury_without_voucher') {
          problems.push(`bank invariants on the revived bank: [${found.join(', ')}], expected I15 and I16`);
        }
      } finally {
        await orm.update(treasuryTransactions).set({ isDeleted: 1 }).where(eq(treasuryTransactions.id, legacy.id));
        await orm.update(treasuryTransactions).set({ status: 'completed' }).where(eq(treasuryTransactions.id, Number(voided.body.id)));
        await orm.update(bankAccounts).set({ currentBalance: money(0) }).where(eq(bankAccounts.id, bankId));
      }
      assertNoProblems(problems);
      return 'Receipt 5,000,000 voided (bank 0, ledger 0); voiding its reversal row gave 409 and the bank stayed 0; a legacy revived row was listed by the health check and broke I15 and I16';
    });
  }

  return results;
}
